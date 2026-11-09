-- 001-runtime-state.sql — runtime.sqlite 初始 schema（收编自内联建表）。
--
-- 来源：
--   runtime/run_event_log.py  SqliteRunEventLog / SqliteRunSnapshotStore / SqliteRequestContextStore
--   runtime/checkpoint_store.py SqliteCheckpointStore
-- 三个类此前各自在 __init__ 里 CREATE TABLE IF NOT EXISTS，同一个库文件。
-- 现在统一由迁移链建表；类里只调 run_migrations(conn, "runtime")。

CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  node_id TEXT,
  iteration_index INTEGER,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);

CREATE TABLE IF NOT EXISTS run_snapshots (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  workflow_id TEXT,
  updated_at TEXT NOT NULL,
  result_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  record_json TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id);

CREATE TABLE IF NOT EXISTS request_contexts (
  run_id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
