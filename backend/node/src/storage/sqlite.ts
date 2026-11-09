/**
 * sqlite.ts — Story 15.16 — single sqlite connection for the server.
 *
 * Why singleton:
 *   better-sqlite3 is sync; opening multiple connections to the same WAL db
 *   is supported but pointless for our single-process server. One handle,
 *   reused across routes.
 *
 * Boot sequence:
 *   1. mkdir .shadowflow/ (cwd-relative — matches existing JSON storage).
 *   2. Open / create app.sqlite.
 *   3. journal_mode = WAL (better crash safety + reader/writer parallelism).
 *   4. foreign_keys = ON (off by default in sqlite, must opt in).
 *   5. busy_timeout = 5s (avoid SQLITE_BUSY on concurrent route handlers).
 *   6. runMigrations() — 版本化迁移链（migrations/NNN-*.sql），记账表
 *      schema_migrations 保证每个迁移只跑一次；失败即抛错、启动失败。
 *
 * 2026-11-09（S5 数据治理）：此前这里是「每次启动全量 exec 001-init.sql + 一堆
 * 内联 CREATE TABLE + addColumnIfMissing()」。内联 DDL 已收编进
 * migrations/002-core-tables.sql 与 003-additive-columns.sql，本文件只负责连接
 * 与迁移调度。addColumnIfMissing 仍导出——外接 storage 模块（craft/merchant 等）
 * 用它保证「模块自建表」的兜底加列，正式演进请写进迁移文件。
 *
 * Test isolation: _resetForTests() closes the handle so tests can chdir to
 * an isolated tmp dir and call getDb() again — the next getDb() call reads
 * the fresh cwd.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrate';

let _db: Database.Database | null = null;
let _initialized = false;

export interface DbPaths {
  dir: string;
  file: string;
  /** 迁移目录（backend/node/migrations）。 */
  migrations: string;
}

/** 当前 cwd 对应的库路径 —— 供 migrate-cli 与测试复用，避免两处拼路径。 */
export function dbPaths(): DbPaths {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.shadowflow');
  const file = path.join(dir, 'app.sqlite');
  // migrations live next to the compiled / source tree at server/migrations/.
  // __dirname when run via tsx points into server/src/storage, so go up two.
  const migrations = path.join(__dirname, '..', '..', 'migrations');
  return { dir, file, migrations };
}

/**
 * Add a column to a table if it isn't already present. Idempotent: reads
 * PRAGMA table_info and only issues ALTER TABLE when the column is missing.
 * `colDef` is the SQLite type/affinity (e.g. 'TEXT') — keep it nullable with
 * no NOT NULL/UNIQUE so the ALTER can never fail on an existing populated table.
 *
 * 导出给外接 storage 模块复用（2026-11-08 craft 域扩展）：模块自建表必须有
 * CREATE TABLE IF NOT EXISTS 兜底（兼容全新库），随后的加列走这里或迁移文件。
 */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  colDef: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const { dir, file, migrations } = dbPaths();
  const dbExisted = fs.existsSync(file);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // 版本化迁移：新库建全套表，老库自动基线化后只跑未应用的部分。
  // 失败会抛 MigrationError —— 这里绝不 try/catch，宁可启动失败也不要半残 schema。
  runMigrations(db, { dir: migrations, log: (m) => console.log(m) });

  _db = db;
  _initialized = true;
  console.log(`[sqlite] db ${dbExisted ? 'loaded' : 'initialized'} at ${file}`);
  return db;
}

/** Idempotent boot wrapper — call once from index.ts at startup. */
export function initSqlite(): Database.Database {
  return getDb();
}

/** Test helper: close handle so the next getDb() picks up a new cwd. */
export function _resetForTests(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
    _initialized = false;
  }
}

export function isInitialized(): boolean {
  return _initialized;
}
