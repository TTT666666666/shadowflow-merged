"""版本化 SQLite 迁移（Python 侧）。

两个库各一条迁移链：
  * ``chains/runtime`` → .shadowflow/runtime.sqlite（run_events / run_snapshots /
    request_contexts / checkpoints）
  * ``chains/opc``     → .shadowflow/opc.sqlite（OPC 公司域 10 表）

用法::

    from shadowflow.migrations import run_migrations
    run_migrations(conn, "runtime", baseline_tables=("run_events", "checkpoints"))

memory_bank 的 per-pack 库不在此链内 —— pack 数量动态、每个 pack 一个 sqlite，
不适合版本链；其 schema 集中在 shadowflow/memory/memory_bank.py 的建表函数里。
"""

from .runner import (
    CHAINS_DIR,
    MigrationError,
    applied_migrations,
    list_migrations,
    run_migrations,
)

__all__ = [
    "CHAINS_DIR",
    "MigrationError",
    "applied_migrations",
    "list_migrations",
    "run_migrations",
]
