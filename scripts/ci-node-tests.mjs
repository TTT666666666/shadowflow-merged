#!/usr/bin/env node
/**
 * ci-node-tests.mjs — 网关（backend/node）测试门，CI 与本地 `npm run gate` 共用同一判定。
 *
 * 为什么需要它：`npm test` 直接跑 vitest 时，只要有一个历史基线失败就返回非零，
 * CI 必红；而本地交付门用的是「允许 N 个失败」的宽松判定 —— 两套口径会导致
 * 「本地绿、CI 红」。这里把判定收敛成一处：**按用例全名白名单**，而不是数个数。
 *
 * 判定规则：
 *   1. 失败用例全在白名单内         → PASS（打印基线提示，提示何时可以删除条目）
 *   2. 出现白名单之外的失败         → FAIL（打印用例全名 + 断言摘要）
 *   3. 测试文件级失败（收集/编译/超时） → FAIL（这类不算用例失败，必须显式拦截）
 *   4. 白名单用例反而通过了         → PASS，但提示「基线已修复，请从白名单删除」
 *
 * 用法：
 *   node scripts/ci-node-tests.mjs            # 全量
 *   node scripts/ci-node-tests.mjs --verbose  # 额外透出 vitest 原始输出
 *
 * 白名单维护：修好一个就从 KNOWN_FAILURES 删掉对应条目；条目为空字符串时等于强门。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const NODE_DIR = path.join(ROOT, 'backend', 'node');
const VERBOSE = process.argv.includes('--verbose');
const IS_WIN = process.platform === 'win32';

/**
 * 已知基线失败（vitest 报告的用例全名，ancestorTitles + title 以空格连接）。
 *
 * 现存 2 条：craft-posts「发布即冻结」——publish 时 [post] 标记未落库，
 * 属 craft 域历史问题，与架构治理无关（见 docs/新架构蓝图-v2.md §4.2 已知基线）。
 * 修好后请删除对应条目；本脚本会自动提示哪些条目可以删。
 */
const KNOWN_FAILURES = [
  '发布即冻结（published 后内容不可改） published 后同值幂等 no-op 放行：不写库、不落标记',
  '发布即冻结（published 后内容不可改） 标准序列不受影响：publish 前挂 product_id，发布后关联保留',
].filter(Boolean);

const REPORT = path.join(os.tmpdir(), `sf-vitest-${process.pid}.json`);

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(NODE_DIR)) fail(`找不到网关目录：${NODE_DIR}`);

console.log(`网关测试门：${NODE_DIR}`);
console.log(`已知基线白名单：${KNOWN_FAILURES.length} 条\n`);

const npx = IS_WIN ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['vitest', 'run', '--reporter=json', `--outputFile=${REPORT}`], {
  cwd: NODE_DIR,
  encoding: 'utf-8',
  shell: /\.(cmd|bat)$/i.test(npx),
  env: { ...process.env, CI: '1' },
});

if (VERBOSE) {
  process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

if (!fs.existsSync(REPORT)) {
  process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  fail('vitest 未产出 JSON 报告（进程可能直接崩了，看上面的原始输出）');
}

let report;
try {
  report = JSON.parse(fs.readFileSync(REPORT, 'utf-8'));
} catch (err) {
  fail(`JSON 报告解析失败：${err.message}`);
} finally {
  fs.rmSync(REPORT, { force: true });
}

/** 收集用例级失败与文件级（suite）失败。 */
const failedCases = [];
const brokenSuites = [];
for (const suite of report.testResults ?? []) {
  const assertions = suite.assertionResults ?? [];
  const failed = assertions.filter((a) => a.status === 'failed');
  for (const a of failed) {
    const fullName = a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ');
    failedCases.push({
      fullName: String(fullName).replace(/\s+/g, ' ').trim(),
      file: suite.name ? path.relative(ROOT, suite.name) : '(unknown)',
      message: (a.failureMessages ?? []).join('\n'),
    });
  }
  // 文件级失败：suite 红但没有任何用例失败 → 收集/编译/钩子出错，不能算进白名单。
  if (suite.status === 'failed' && failed.length === 0) {
    brokenSuites.push({
      file: suite.name ? path.relative(ROOT, suite.name) : '(unknown)',
      message: suite.message ?? '(无错误信息)',
    });
  }
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failedCount = report.numFailedTests ?? failedCases.length;
const suiteTotal = report.numTotalTestSuites ?? 0;
const suiteFailed = report.numFailedTestSuites ?? 0;
console.log(
  `文件：${suiteTotal - suiteFailed}/${suiteTotal} 通过　用例：${passed}/${total} 通过（失败 ${failedCount}）`,
);

const knownSet = new Set(KNOWN_FAILURES);
const unexpected = failedCases.filter((c) => !knownSet.has(c.fullName));
const suppressed = failedCases.filter((c) => knownSet.has(c.fullName));
const fixed = KNOWN_FAILURES.filter((k) => !failedCases.some((c) => c.fullName === k));

if (suppressed.length) {
  console.log(`\n⚠ 命中已知基线 ${suppressed.length} 例（不阻断）：`);
  for (const c of suppressed) console.log(`  · ${c.fullName}\n    ${c.file}`);
}
if (fixed.length) {
  console.log('\nℹ 以下白名单条目本次通过 —— 基线已修复，请从 KNOWN_FAILURES 删除：');
  for (const k of fixed) console.log(`  · ${k}`);
}

if (brokenSuites.length) {
  console.error(`\n✗ ${brokenSuites.length} 个测试文件整体失败（非用例级，必须修）：`);
  for (const s of brokenSuites) {
    console.error(`  · ${s.file}\n    ${String(s.message).split('\n').slice(0, 6).join('\n    ')}`);
  }
}

if (unexpected.length) {
  console.error(`\n✗ ${unexpected.length} 个白名单之外的失败：`);
  for (const c of unexpected) {
    console.error(`  · ${c.fullName}\n    ${c.file}`);
    const brief = String(c.message).split('\n').slice(0, 8).join('\n    ');
    if (brief) console.error(`    ${brief}`);
  }
  console.error('\n新增失败必须修复，或（若确属已知基线）加入 KNOWN_FAILURES 并说明原因。');
  process.exit(1);
}

if (brokenSuites.length) process.exit(1);

console.log('\n✓ 网关测试通过（无白名单之外的失败）');
