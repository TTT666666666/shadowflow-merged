# migrations/ — 版本化 SQLite 迁移链

`app.sqlite` 的 schema 真源。启动时由 `src/storage/migrate.ts` 按序应用未执行的迁移，
记账表 `schema_migrations` 保证每个版本只跑一次。

## 命名

```
NNN-短横线小写名.sql     例：001-init.sql / 002-core-tables.sql
```

- 三位序号，全局唯一且递增；**已合入的迁移不要再改**（改了 checksum 会告警）。
- 新表/索引直接写 SQL（一律 `IF NOT EXISTS`，兼容老库）。

## 加列：用 @add-column 指令

SQLite 没有 `ADD COLUMN IF NOT EXISTS`，直接 `ALTER` 在老库上会炸。迁移文件里写：

```sql
-- @add-column group_messages attachments TEXT
```

执行器先 `PRAGMA table_info` 检查，缺列才 ALTER。注意加列迁移必须排在「建该表」的
迁移之后（执行器会校验表是否存在并给出明确报错）。

## 运维

```bash
npm run db:migrate          # dry-run：只列出待执行迁移（默认，只读）
npm run db:migrate:apply    # 真正执行
```

迁移失败会抛 `MigrationError` 并让服务启动失败——**不要通过 try/catch 兜住它**，
半残 schema 跑起来比启动失败更难排查。

## 现有链

| 版本 | 文件 | 内容 |
|---|---|---|
| 001 | `001-init.sql` | 初始 5 表：projects / conversations / messages / agents / runs + 认证表 |
| 002 | `002-core-tables.sql` | 收编 sqlite.ts 内联建表（run_index / groups / group_messages / memory_* / agent_hops / token_usage / users / resource_owners / run_artifacts） |
| 003 | `003-additive-columns.sql` | 收编历史 addColumnIfMissing（messages 两列、conversations.group_id、group_messages.attachments） |

## 与 Python 侧的关系

Python 侧有同构实现（`backend/python/shadowflow/migrations/`），库不同、约定相同：
序号化 SQL + `schema_migrations` + `-- @add-column` 指令。改动时两边保持同一套语义。

## 不在链内的表

各 storage 模块（craft-posts / craft-profit / merchant-board / ops-shipping /
social-publish / memory-handoff）仍保留 `CREATE TABLE IF NOT EXISTS` 兜底，保证模块
被单独引入（如测试）时能自建表。它们的**正式演进**请写进本目录的新迁移文件。
