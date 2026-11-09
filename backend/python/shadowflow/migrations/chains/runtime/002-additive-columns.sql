-- 002-additive-columns.sql — 收编 run_snapshots 的运行时加列（2026-08-15 RunSummary）。
--
-- 原逻辑：SqliteRunSnapshotStore.__init__ 里对 ("request_id TEXT", "started_at TEXT")
-- 逐个 try ALTER，靠 "duplicate column" 异常当存在性判断。改为迁移链的
-- @add-column 指令后，只按版本执行一次，且天然幂等。

-- @add-column run_snapshots request_id TEXT
-- @add-column run_snapshots started_at TEXT
