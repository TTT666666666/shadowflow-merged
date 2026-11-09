"""版本化迁移框架（shadowflow.migrations）的行为测试。

覆盖三类必测场景 + 防呆：
  1. 全新库：一次跑完整条链，表/索引/加列齐全
  2. 旧库（有表无版本号）：自动基线化，001 记 baseline=1，存量数据不丢
  3. 幂等：连跑两遍，第二遍零执行、记账表不增行
  4. 防呆：迁移报错抛 MigrationError 且该版本不记账（回滚）
  5. dry-run：只读，不建记账表
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from shadowflow.migrations import MigrationError, applied_migrations, list_migrations, run_migrations


def _conn(tmp_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(str(tmp_path / "test.sqlite"), check_same_thread=False)


def _tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def test_runtime_chain_fresh_database(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    result = run_migrations(conn, "runtime", log=None, baseline_tables=("run_events", "checkpoints"))

    assert result["executed"] == ["001", "002"]
    assert result["baselined"] is False
    assert {"run_events", "run_snapshots", "checkpoints", "request_contexts"} <= _tables(conn)
    # 002 的 @add-column 指令
    assert {"request_id", "started_at"} <= _columns(conn, "run_snapshots")
    assert [r["version"] for r in applied_migrations(conn)] == ["001", "002"]
    assert all(r["checksum"] for r in applied_migrations(conn))
    conn.close()


def test_opc_chain_fresh_database(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    run_migrations(conn, "opc", log=None, baseline_tables=("companies",))

    expected = {
        "companies", "departments", "employees", "opc_projects", "tasks",
        "approvals", "ledger", "products", "orders", "order_events",
    }
    assert expected <= _tables(conn)
    indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    assert "idx_task_project" in indexes
    conn.close()


def test_legacy_database_baselined_without_data_loss(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    # 迁移框架上线前的老库：001 的表已存在且有数据，没有 schema_migrations
    conn.executescript(
        """
        CREATE TABLE run_events (
            run_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL,
            node_id TEXT, iteration_index INTEGER, payload TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY (run_id, seq)
        );
        INSERT INTO run_events VALUES ('r1', 1, 'node_started', NULL, NULL, '{}', '2026-01-01T00:00:00Z');
        """
    )
    conn.commit()

    result = run_migrations(conn, "runtime", log=None, baseline_tables=("run_events", "checkpoints"))

    assert result["baselined"] is True
    rows = {r["version"]: r for r in applied_migrations(conn)}
    assert rows["001"]["baseline"] == 1
    assert "002" in rows and rows["002"]["baseline"] == 0
    assert _columns(conn, "run_snapshots") >= {"request_id", "started_at"}
    kept = conn.execute("SELECT COUNT(*) FROM run_events").fetchone()[0]
    assert kept == 1
    conn.close()


def test_idempotent_second_run(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    run_migrations(conn, "runtime", log=None, baseline_tables=("run_events",))
    first = applied_migrations(conn)
    cols_before = _columns(conn, "run_snapshots")

    second = run_migrations(conn, "runtime", log=None, baseline_tables=("run_events",))

    assert second["executed"] == []
    assert len(applied_migrations(conn)) == len(first)
    assert _columns(conn, "run_snapshots") == cols_before
    conn.close()


def test_failure_rolls_back_and_does_not_record(tmp_path: Path) -> None:
    chain_root = tmp_path / "chains"
    bad = chain_root / "bad"
    bad.mkdir(parents=True)
    (bad / "001-ok.sql").write_text("CREATE TABLE t (id TEXT);\n", encoding="utf-8")
    (bad / "002-bad.sql").write_text(
        "-- @add-column missing_table x TEXT\nCREATE TABLE should_not_exist (id TEXT);\n",
        encoding="utf-8",
    )

    conn = _conn(tmp_path)
    with pytest.raises(MigrationError) as exc:
        run_migrations(conn, "bad", log=None, root=chain_root)

    assert exc.value.version == "002"
    assert [r["version"] for r in applied_migrations(conn)] == ["001"]
    assert "should_not_exist" not in _tables(conn)
    conn.close()


def test_dry_run_is_read_only(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    result = run_migrations(conn, "runtime", dry_run=True, log=None)

    assert result["executed"] == []
    assert "schema_migrations" not in _tables(conn)
    conn.close()


def test_list_migrations_is_sorted_and_complete() -> None:
    files = list_migrations("runtime")
    versions = [v for v, _n, _p in files]
    assert versions == sorted(versions)
    assert versions[0] == "001"
    assert len(files) >= 2
