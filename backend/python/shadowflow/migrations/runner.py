"""版本化 SQLite 迁移执行器 — 与 backend/node/src/storage/migrate.ts 同构。

设计要点
--------
1. 真源 = ``migrations/chains/<chain>/NNN-name.sql``，序号递增，按序应用未执行者。
2. 记账表 ``schema_migrations``（version PK / name / checksum / applied_at / baseline）。
3. 旧库自动基线化：记账表刚建 + 库中已有业务表 ⇒ 迁移框架上线前的老库，001 行
   标记 ``baseline=1``（照常执行，DDL 全 IF NOT EXISTS，等价 no-op）。
4. 幂等加列：SQLite 无 ADD COLUMN IF NOT EXISTS，迁移文件里用指令
   ``-- @add-column <table> <column> <TYPE ...>``，执行器先做存在性检查。
5. 防呆：任何迁移失败抛 :class:`MigrationError`，调用方不得吞掉 —— 服务启动直接失败，
   避免半残 schema 跑起来。
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

CHAINS_DIR = Path(__file__).resolve().parent / "chains"

_FILE_RE = re.compile(r"^(\d{3})-(.+)\.sql$")
_ADD_COLUMN_RE = re.compile(
    r"^\s*--\s*@add-column\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s+(.+?)\s*$"
)


class MigrationError(RuntimeError):
    """迁移执行失败（已回滚）。"""

    def __init__(self, message: str, version: Optional[str] = None) -> None:
        super().__init__(message)
        self.version = version


def list_migrations(chain: str, root: Optional[Path] = None) -> List[Tuple[str, str, Path]]:
    """返回 [(version, name, path)]，按版本升序；序号重复直接抛错。"""
    base = (root or CHAINS_DIR) / chain
    if not base.is_dir():
        raise MigrationError(f"迁移链目录不存在：{base}")
    out: List[Tuple[str, str, Path]] = []
    for entry in sorted(base.iterdir()):
        m = _FILE_RE.match(entry.name)
        if m:
            out.append((m.group(1), m.group(2), entry))
    out.sort(key=lambda item: item[0])
    for prev, cur in zip(out, out[1:]):
        if prev[0] == cur[0]:
            raise MigrationError(f"迁移序号重复：{cur[0]}（{cur[2].name} 与 {prev[2].name}）")
    return out


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def _split_statements(sql: str) -> List[str]:
    """按 ';' 切分语句，丢弃纯注释行。仅支持普通 DDL（不支持 BEGIN…END 触发器块）。"""
    kept = [line for line in sql.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(kept).split(";") if stmt.strip()]


def _ensure_migration_table(conn: sqlite3.Connection) -> bool:
    """建记账表；返回是否本次新建。"""
    existed = _table_exists(conn, "schema_migrations")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            version    TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            checksum   TEXT NOT NULL DEFAULT '',
            applied_at INTEGER NOT NULL,
            baseline   INTEGER NOT NULL DEFAULT 0
        )"""
    )
    conn.commit()
    return not existed


def applied_migrations(conn: sqlite3.Connection) -> List[Dict[str, object]]:
    if not _table_exists(conn, "schema_migrations"):
        return []
    rows = conn.execute(
        "SELECT version, name, checksum, applied_at, baseline FROM schema_migrations ORDER BY version"
    ).fetchall()
    return [
        {
            "version": r[0],
            "name": r[1],
            "checksum": r[2],
            "applied_at": r[3],
            "baseline": r[4],
        }
        for r in rows
    ]


def _checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def run_migrations(
    conn: sqlite3.Connection,
    chain: str,
    *,
    dry_run: bool = False,
    log: Optional[Callable[[str], None]] = print,
    baseline_tables: Sequence[str] = (),
    root: Optional[Path] = None,
) -> Dict[str, object]:
    """按序应用未执行的迁移。返回 {'executed': [...], 'skipped': [...], 'baselined': bool}。"""
    say = log or (lambda _m: None)
    files = list_migrations(chain, root)

    if dry_run:
        applied = {r["version"] for r in applied_migrations(conn)}
        waiting = [v for v, _n, _p in files if v not in applied]
        say(f"[migrate:{chain}] dry-run：共 {len(files)} 个，已应用 {len(applied)}，待执行 {len(waiting)}")
        for v in waiting:
            say(f"[migrate:{chain}]   pending {v}")
        return {"executed": [], "skipped": sorted(applied), "baselined": False}

    fresh = _ensure_migration_table(conn)
    applied = applied_migrations(conn)
    applied_versions = {str(r["version"]) for r in applied}

    legacy = fresh and any(_table_exists(conn, t) for t in baseline_tables)
    if legacy:
        say(f"[migrate:{chain}] 检测到未版本化的旧库，执行自动基线化（001 记为 baseline=1）")

    executed: List[str] = []
    for version, name, path in files:
        if version in applied_versions:
            continue
        sql = path.read_text(encoding="utf-8")
        statements: List[str] = []
        for line in sql.splitlines():
            m = _ADD_COLUMN_RE.match(line)
            if not m:
                continue
            table, column, col_def = m.group(1), m.group(2), m.group(3)
            if not _table_exists(conn, table):
                raise MigrationError(
                    f"迁移 {version}: @add-column 目标表 {table} 不存在（加列迁移必须排在建表迁移之后）",
                    version,
                )
            if _column_exists(conn, table, column):
                continue
            statements.append(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")

        try:
            conn.commit()  # 冲掉可能挂起的隐式事务，避免 "transaction within a transaction"
            conn.execute("BEGIN")
            for stmt in _split_statements(sql):
                conn.execute(stmt)
            for stmt in statements:
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at, baseline) "
                "VALUES (?,?,?,?,?)",
                (version, name, _checksum(sql), int(time.time() * 1000), 1 if legacy and version == "001" else 0),
            )
            conn.commit()
        except Exception as exc:  # noqa: BLE001 — 统一包装成 MigrationError
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            raise MigrationError(f"迁移 {version}-{name} 执行失败，已回滚：{exc}", version) from exc
        executed.append(version)
        say(f"[migrate:{chain}] applied {version}-{name}")

    if not executed and not legacy:
        say(f"[migrate:{chain}] schema up to date ({len(files)} migrations)")
    return {
        "executed": executed,
        "skipped": sorted(applied_versions),
        "baselined": legacy,
    }
