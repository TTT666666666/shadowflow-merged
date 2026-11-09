/**
 * migrate-cli.ts — 迁移防呆入口。
 *
 *   npx tsx src/storage/migrate-cli.ts             # dry-run：只列出待执行迁移
 *   npx tsx src/storage/migrate-cli.ts --apply     # 真正执行（等价于启动时自动跑）
 *
 * 默认 dry-run，避免手滑改生产库。执行失败退出码非 0，可直接串进 CI。
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { dbPaths } from './sqlite';
import { runMigrations, MigrationError } from './migrate';

const apply = process.argv.includes('--apply');
const { dir, file, migrations } = dbPaths();

if (!fs.existsSync(migrations)) {
  console.error(`[migrate-cli] 迁移目录不存在：${migrations}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

try {
  const result = runMigrations(db, { dir: migrations, dryRun: !apply });
  if (!apply) {
    console.log(`[migrate-cli] dry-run 完成（库：${file}）。加 --apply 才会写入。`);
  } else {
    console.log(
      `[migrate-cli] 完成：执行 ${result.executed.length} 个，跳过 ${result.skipped.length} 个（库：${file}）`,
    );
  }
} catch (err) {
  if (err instanceof MigrationError) {
    console.error(`[migrate-cli] 失败：${err.message}`);
  } else {
    console.error('[migrate-cli] 未预期错误：', err);
  }
  db.close();
  process.exit(1);
}
db.close();
