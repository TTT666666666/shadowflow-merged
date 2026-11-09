/**
 * migrate.ts — 版本化 SQLite 迁移执行器（S5 数据治理）。
 *
 * 设计要点
 * --------
 * 1. **真源 = migrations/*.sql**，文件名 `NNN-name.sql` 序号递增。启动时按序应用
 *    未执行过的迁移，全部事务化（每个文件一个事务，失败整体回滚并抛错）。
 * 2. **记账表 schema_migrations**（version PK / name / checksum / applied_at /
 *    baseline），已应用的版本不会重跑 —— 这是与旧 `db.exec(001-init.sql)`
 *    「每次启动都全量跑」的根本区别。
 * 3. **旧库自动基线化**：检测到「库里有表但没有 schema_migrations」时，说明这是
 *    迁移框架上线前生成的库。此时照常执行 001（全是 IF NOT EXISTS，等价 no-op），
 *    但把该行标记 `baseline=1`，便于日后审计「这行不是真跑出来的」。
 * 4. **幂等加列**：SQLite 没有 ADD COLUMN IF NOT EXISTS，历史代码用
 *    addColumnIfMissing() 在运行时补列。迁移文件里改用指令：
 *        -- @add-column messages timeline_message_id TEXT
 *    执行器先 PRAGMA table_info 检查，缺列才 ALTER，已有列直接跳过 —— 所以同一份
 *    迁移对「全新库」和「已在跑的老库」都安全。
 * 5. **防呆**：任何迁移抛错都包装成 MigrationError 向上抛，调用方（getDb）不吞异常，
 *    服务直接启动失败并给出行号级报错。禁止静默继续。
 *
 * 注意：本模块只依赖 better-sqlite3 的同步 API，不 import 业务模块，避免循环依赖。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

/** 迁移文件名：NNN-name.sql（三位数字序号 + 短横线 + 名字）。 */
const FILE_RE = /^(\d{3})-(.+)\.sql$/;

/** @add-column 指令：`-- @add-column <table> <column> <TYPE ...>` */
const ADD_COLUMN_RE = /^\s*--\s*@add-column\s+([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)\s+(.+?)\s*$/;

export interface MigrationFile {
  /** 三位序号，如 "001"。 */
  version: string;
  /** 文件名去掉序号后的部分，如 "init"。 */
  name: string;
  /** 绝对路径。 */
  file: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: number;
  baseline: number;
}

export interface RunOptions {
  /** 迁移目录，默认 backend/node/migrations。 */
  dir?: string;
  /** 只算不跑：返回将要执行的迁移列表，不做任何写入。 */
  dryRun?: boolean;
  /** 日志出口，默认 console.log；测试可传空函数。 */
  log?: (msg: string) => void;
}

export interface RunResult {
  /** 本次执行（或 dryRun 下将执行）的版本号。 */
  executed: string[];
  /** 已应用过的版本号。 */
  skipped: string[];
  /** 是否识别为「迁移框架前生成的老库」。 */
  baselined: boolean;
}

export class MigrationError extends Error {
  constructor(message: string, readonly version?: string, readonly cause?: unknown) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** 迁移目录：src/storage/ → ../../migrations（编译后 dist/storage/ → ../../migrations 同样成立）。 */
export function migrationsDir(): string {
  return path.join(__dirname, '..', '..', 'migrations');
}

/** 列出迁移文件并按序号排序；序号重复或为空直接抛错（防拼写事故）。 */
export function listMigrations(dir: string = migrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    throw new MigrationError(`迁移目录不存在：${dir}`);
  }
  const out: MigrationFile[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(entry);
    if (!m) continue;
    out.push({ version: m[1], name: m[2], file: path.join(dir, entry) });
  }
  out.sort((a, b) => a.version.localeCompare(b.version));
  for (let i = 1; i < out.length; i++) {
    if (out[i].version === out[i - 1].version) {
      throw new MigrationError(
        `迁移序号重复：${out[i].version}（${path.basename(out[i].file)} 与 ${path.basename(out[i - 1].file)}）`,
      );
    }
  }
  return out;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name?: string } | undefined;
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((c) => c.name === column);
}

/** 建记账表；返回「本次是否新建」（新建且库里有业务表 ⇒ 老库基线化场景）。 */
function ensureMigrationTable(db: Database.Database): boolean {
  const existed = tableExists(db, 'schema_migrations');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL DEFAULT '',
    applied_at INTEGER NOT NULL,
    baseline   INTEGER NOT NULL DEFAULT 0
  );`);
  return !existed;
}

export function appliedMigrations(db: Database.Database): AppliedMigration[] {
  if (!tableExists(db, 'schema_migrations')) return [];
  return db
    .prepare(`SELECT version, name, checksum, applied_at, baseline FROM schema_migrations ORDER BY version`)
    .all() as AppliedMigration[];
}

function checksum(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

/** 执行一个 .sql 迁移体：先展开 @add-column 指令，再执行剩余 SQL。 */
function execMigrationBody(
  db: Database.Database,
  sql: string,
  version: string,
  log: (msg: string) => void,
): void {
  const kept: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const m = ADD_COLUMN_RE.exec(line);
    if (!m) {
      kept.push(line);
      continue;
    }
    const [, table, column, colDef] = m;
    if (!tableExists(db, table)) {
      throw new MigrationError(
        `迁移 ${version}: @add-column 目标表 ${table} 不存在（加列迁移必须排在建表迁移之后）`,
        version,
      );
    }
    if (columnExists(db, table, column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
    log(`[migrate]   + column ${table}.${column} ${colDef}`);
  }
  const body = kept.join('\n').trim();
  if (body) db.exec(body);
}

/**
 * 按序应用未执行的迁移。事务化 + 幂等；失败抛 MigrationError（调用方不得吞掉）。
 */
export function runMigrations(db: Database.Database, opts: RunOptions = {}): RunResult {
  const dir = opts.dir ?? migrationsDir();
  const log = opts.log ?? ((m: string) => console.log(m));
  const files = listMigrations(dir);

  // dry-run 是纯读：不建记账表、不写任何东西。
  if (opts.dryRun) {
    const applied = appliedMigrations(db);
    const done = new Set(applied.map((r) => r.version));
    const waiting = files.filter((f) => !done.has(f.version));
    log(`[migrate] dry-run：共 ${files.length} 个迁移，已应用 ${applied.length}，待执行 ${waiting.length}`);
    for (const f of waiting) log(`[migrate]   pending ${f.version}-${f.name}`);
    return { executed: [], skipped: applied.map((r) => r.version), baselined: false };
  }

  const freshTable = ensureMigrationTable(db);
  const already = appliedMigrations(db);
  const appliedMap = new Map(already.map((r) => [r.version, r]));

  // 老库识别：记账表刚建 + 库里已经有业务表 ⇒ 迁移框架上线前的老库。
  const legacy = freshTable && tableExists(db, 'projects');
  if (legacy) {
    log('[migrate] 检测到未版本化的旧库，执行自动基线化（001 记为 baseline=1）');
  }

  const pending = files.filter((f) => !appliedMap.has(f.version));

  const executed: string[] = [];
  for (const f of pending) {
    const sql = fs.readFileSync(f.file, 'utf-8');
    const sum = checksum(sql);
    db.exec('BEGIN');
    try {
      execMigrationBody(db, sql, f.version, log);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at, baseline) VALUES (?,?,?,?,?)`,
      ).run(f.version, f.name, sum, Date.now(), legacy && f.version === '001' ? 1 : 0);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 事务可能已自动回滚 */
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new MigrationError(
        `迁移 ${f.version}-${f.name} 执行失败，已回滚：${detail}`,
        f.version,
        err,
      );
    }
    executed.push(f.version);
    log(`[migrate] applied ${f.version}-${f.name}`);
  }

  // 校验和漂移只告警不阻断（改了已上线的迁移属于流程违规，但不该让服务起不来）。
  for (const f of files) {
    const rec = appliedMap.get(f.version);
    if (!rec || !rec.checksum) continue;
    const now = checksum(fs.readFileSync(f.file, 'utf-8'));
    if (now !== rec.checksum) {
      log(
        `[migrate] WARN 迁移 ${f.version}-${f.name} 的 checksum 与已应用记录不一致（应用后被人改过？）`,
      );
    }
  }

  if (executed.length === 0 && !legacy) {
    log(`[migrate] schema up to date (${files.length} migrations)`);
  }
  return { executed, skipped: already.map((r) => r.version), baselined: legacy };
}
