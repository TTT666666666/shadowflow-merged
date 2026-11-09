/**
 * migrate.test.ts — 版本化迁移框架的三类必测场景 + 防呆。
 *
 *   1. 全新库：一次跑完全部迁移，表/列齐全，记账表逐条登记
 *   2. 旧库（有表无版本号）：自动基线化，001 标记 baseline=1，存量数据不丢
 *   3. 幂等：连跑两遍，第二遍 0 执行、记账表不增行、列不重复
 *   4. 防呆：迁移报错 → MigrationError 且该版本不记账（事务回滚）
 *   5. dry-run：只读，不建记账表
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { appliedMigrations, listMigrations, MigrationError, runMigrations } from './migrate';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');
const silent = () => {};

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];
function tmpDb(): { db: Database.Database; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mig-'));
  tmpDirs.push(dir);
  const db = new Database(path.join(dir, 'app.sqlite'));
  openDbs.push(db);
  return { db, dir };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>)
    .map((r) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

describe('runMigrations', () => {
  it('全新库：按序跑完迁移链，表与列齐全', () => {
    const { db } = tmpDb();
    const result = runMigrations(db, { dir: MIGRATIONS_DIR, log: silent });

    expect(result.executed).toEqual(['001', '002', '003']);
    expect(result.baselined).toBe(false);

    const tables = tableNames(db);
    for (const t of [
      'projects', 'conversations', 'messages', 'runs', // 001
      'run_index', 'groups', 'group_messages', 'memory_lessons', 'memory_handoffs',
      'memory_profile_events', 'users', 'resource_owners', 'run_artifacts', // 002
    ]) {
      expect(tables, `缺少表 ${t}`).toContain(t);
    }
    // 003 的 @add-column 指令
    expect(columnNames(db, 'messages')).toContain('timeline_message_id');
    expect(columnNames(db, 'messages')).toContain('edited_at');
    expect(columnNames(db, 'conversations')).toContain('group_id');
    expect(columnNames(db, 'group_messages')).toContain('attachments');

    const rows = appliedMigrations(db);
    expect(rows.map((r) => r.version)).toEqual(['001', '002', '003']);
    expect(rows.every((r) => r.checksum.length > 0)).toBe(true);
  });

  it('旧库（有表无版本号）：自动基线化且不丢数据', () => {
    const { db } = tmpDb();
    // 模拟迁移框架上线前的老库：001 的表已存在（且已有数据），没有 schema_migrations。
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
             INSERT INTO projects (id, name, created_at) VALUES ('p1', '老项目', '2026-01-01');`);

    const result = runMigrations(db, { dir: MIGRATIONS_DIR, log: silent });

    expect(result.baselined).toBe(true);
    const rows = appliedMigrations(db);
    const v001 = rows.find((r) => r.version === '001');
    expect(v001?.baseline).toBe(1);
    // 002/003 仍然真跑（老库没有这些表/列）
    expect(rows.map((r) => r.version)).toEqual(['001', '002', '003']);
    expect(tableNames(db)).toContain('memory_lessons');
    expect(columnNames(db, 'messages')).toContain('edited_at');
    // 存量数据不丢
    const p = db.prepare(`SELECT name FROM projects WHERE id='p1'`).get() as { name: string };
    expect(p.name).toBe('老项目');
  });

  it('幂等：连跑两遍，第二遍零执行、不重复登记、不重复加列', () => {
    const { db } = tmpDb();
    runMigrations(db, { dir: MIGRATIONS_DIR, log: silent });
    const first = appliedMigrations(db);
    const colsBefore = columnNames(db, 'messages');

    const second = runMigrations(db, { dir: MIGRATIONS_DIR, log: silent });

    expect(second.executed).toEqual([]);
    expect(second.baselined).toBe(false);
    expect(appliedMigrations(db)).toHaveLength(first.length);
    expect(columnNames(db, 'messages')).toEqual(colsBefore);
  });

  it('防呆：迁移报错抛 MigrationError，失败版本不记账', () => {
    const { db, dir } = tmpDb();
    const chain = path.join(dir, 'chain');
    fs.mkdirSync(chain);
    fs.writeFileSync(path.join(chain, '001-ok.sql'), 'CREATE TABLE t (id TEXT);');
    fs.writeFileSync(path.join(chain, '002-bad.sql'), '-- @add-column missing_table x TEXT\n');

    expect(() => runMigrations(db, { dir: chain, log: silent })).toThrow(MigrationError);
    // 001 已提交，002 回滚 ⇒ 记账表只有 001
    expect(appliedMigrations(db).map((r) => r.version)).toEqual(['001']);
  });

  it('dry-run：纯读，不创建记账表', () => {
    const { db } = tmpDb();
    const result = runMigrations(db, { dir: MIGRATIONS_DIR, dryRun: true, log: silent });

    expect(result.executed).toEqual([]);
    expect(tableNames(db)).not.toContain('schema_migrations');
  });

  it('listMigrations：按序号升序且识别全部文件', () => {
    const files = listMigrations(MIGRATIONS_DIR);
    const versions = files.map((f) => f.version);
    expect(versions).toEqual([...versions].sort());
    expect(versions).toContain('001');
  });
});
