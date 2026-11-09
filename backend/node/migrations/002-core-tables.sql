-- 002-core-tables.sql — 把 sqlite.ts 里内联建的表收编为正式迁移。
--
-- 来源：原 storage/sqlite.ts getDb() 中的 db.exec(...) 建表块（2026-06-11 ~ 2026-11-07
-- 期间陆续追加）。全部 IF NOT EXISTS，对老库是 no-op，对全新库是建表。
--
-- 这些表此前「每次启动都建一遍」，现在改为「只由迁移链建一次」，schema 真相
-- 收敛到本目录。

-- 持久 run 索引（storage/run-index.ts）— session↔conversation 映射不再依赖内存
-- sessionStore 的 TTL 生命周期。
CREATE TABLE IF NOT EXISTS run_index (
  session_id TEXT PRIMARY KEY,
  conversation_id TEXT,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_index_conversation ON run_index(conversation_id);

-- Node 侧群存储（storage/groups-store.ts，SF_GROUPS_BACKEND=node 实验分支使用）—
-- 与 Python groups.py 的 JSON-file 群记录逐字段等价。
--   groups：群/DM 会话头（kind='group'|'dm'）。archived INTEGER(0/1)；
--           agent_ids/member_emails/policy_matrix/user_settings 存 JSON 文本。
--   group_messages：每条消息一行；reactions 存 JSON 文本，pinned INTEGER(0/1)。
CREATE TABLE IF NOT EXISTS groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL DEFAULT '',
  group_template_id TEXT NOT NULL DEFAULT '',
  agent_ids TEXT NOT NULL DEFAULT '[]',
  member_emails TEXT NOT NULL DEFAULT '[]',
  policy_matrix TEXT NOT NULL DEFAULT '{}',
  workspace_id TEXT,
  workspace_dir TEXT,
  team_id TEXT,
  kind TEXT NOT NULL DEFAULT 'group',
  conversation_id TEXT,
  announcement TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  user_settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_groups_workspace ON groups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_groups_kind ON groups(kind);

CREATE TABLE IF NOT EXISTS group_messages (
  message_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT 'user',
  sender_kind TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL,
  reply_to TEXT,
  reactions TEXT NOT NULL DEFAULT '{}',
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, timestamp);

-- 经验记忆（storage/memory-lessons.ts）— 跨任务长期记忆，零 LLM 调用提炼。
-- scope_key/task_type 分域召回（空=通用）；同域上限 8 条软归档；重复内容只加权。
CREATE TABLE IF NOT EXISTS memory_lessons (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'lesson',
  scope_key TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0.6,
  hits INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_lessons_scope
  ON memory_lessons(scope_key, task_type, archived);

-- Agent 间任务交接（storage/memory-handoff.ts 的 hop 模型）— 每次 DAG 边遍历落一行，
-- status 全生命周期可审计：pending → running → done|failed|timeout|empty|denied|aborted。
CREATE TABLE IF NOT EXISTS agent_hops (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output_chars INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_hops_group_turn ON agent_hops(group_id, turn_seq);
CREATE INDEX IF NOT EXISTS idx_agent_hops_open ON agent_hops(status) WHERE settled_at IS NULL;

-- Token 用量流水 — llm.ts 每次调用有 usage 时落一条，看板按天/模型聚合现算。
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_est_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(ts);
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);

-- 记忆交接 + 长期画像写回 — 交接副本单独存 memory_handoff_items（不写回经验记忆表，
-- 避免挤占每域 8 条上限）；画像用「当前值表 + append-only 事件流水」双表。
CREATE TABLE IF NOT EXISTS memory_handoffs (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  scope_key TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  UNIQUE(shift_id, from_agent, to_agent)
);
CREATE INDEX IF NOT EXISTS idx_memory_handoffs_to ON memory_handoffs(to_agent, status);

CREATE TABLE IF NOT EXISTS memory_handoff_items (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lesson',
  scope_key TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0.6,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_handoff_items_ref ON memory_handoff_items(handoff_id);

CREATE TABLE IF NOT EXISTS memory_profile_values (
  subject_type TEXT NOT NULL DEFAULT 'customer',
  subject_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  source TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(subject_type, subject_id, key)
);

CREATE TABLE IF NOT EXISTS memory_profile_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  old_confidence REAL,
  confidence REAL NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_profile_events
  ON memory_profile_events(subject_id, key, id);

-- 真实用户 + 资源归属（登录信息隔离批）— resource_owners 是归属唯一真源，
-- 不给业务表加列，对 Python JSON 存储的资源同样生效。
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  auth_type TEXT NOT NULL DEFAULT 'email',
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS resource_owners (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_resource_owners_owner ON resource_owners(owner_user_id);

-- 多产物登记（2026-11-07）— 一 run 多产物的独立登记表，runs 表三字段保留为主产物。
-- 不挂 FOREIGN KEY：saveRun 用 INSERT OR REPLACE，挂 FK 会级联清掉子行。
CREATE TABLE IF NOT EXISTS run_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  artifact_type TEXT,
  artifact_filename TEXT,
  artifact_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run ON run_artifacts(run_id, seq);
