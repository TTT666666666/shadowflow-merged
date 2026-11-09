#!/usr/bin/env node
/**
 * ci-node-tests.mjs — 网关（backend/node）测试门，CI 与本地 `npm run gate` 共用同一判定。
 *
 * 为什么需要它：`npm test` 直接跑 vitest 时，只要有一个历史基线失败就返回非零，
 * CI 必红；而本地交付门用的是「允许 N 个失败」的宽松判定 —— 两套口径会导致
 * 「本地绿、CI 红」。这里把判定收敛成一处：**按用例全名白名单**，而不是数个数。
 *
 * 两轮执行（2026-11-09 起）：
 *   ① 主集：全部 *.test.ts，但排除 E2E 冒烟文件；
 *   ② E2E 冒烟：clawhub-e2e.smoke.test.ts 单独串行跑。
 * 原因：该文件真实 spawn 22 个 CLI 探测子进程，与主集并发时 CPU 打满，
 * 单文件耗时从 1.5s 涨到 123s 直接撞 120s 超时（已复现），CI 的 2 核 runner 只会更糟。
 * 串行跑则稳定在 1.5s。排除是用 CLI 的 --exclude 做的，不改 vitest.config，
 * 直接 `npx vitest run <file>` 仍可单跑。
 *
 * 判定规则：
 *   1. 失败用例全在白名单内         → PASS（打印基线提示，提示何时可以删除条目）
 *   2. 出现白名单之外的失败         → FAIL（打印用例全名 + 断言摘要）
 *   3. 测试文件级失败（收集/编译/超时） → FAIL（这类不算用例失败，必须显式拦截）
 *   4. 白名单用例反而通过了         → PASS，但提示「基线已修复，请从白名单删除」
 *
 * 用法：
 *   node scripts/ci-node-tests.mjs            # 全量（主集 + E2E）
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
const NPX = IS_WIN ? 'npx.cmd' : 'npx';

/**
 * 需要脱离主集并发、单独串行跑的 E2E 文件（相对 backend/node）。
 * 它们 spawn 真实子进程 / chdir / 起本地服务，并发时会互相拖爆。
 */
const SERIAL_E2E_FILES = ['src/__tests__/clawhub-e2e.smoke.test.ts'];

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

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(NODE_DIR)) fail(`找不到网关目录：${NODE_DIR}`);

/** 跑一轮 vitest，返回解析后的 JSON 报告。args 追加在 run 之后。 */
function runVitest(label, args) {
  const report = path.join(os.tmpdir(), `sf-vitest-${process.pid}-${label}.json`);
  const r = spawnSync(NPX, ['vitest', 'run', ...args, '--reporter=json', `--outputFile=${report}`], {
    cwd: NODE_DIR,
    encoding: 'utf-8',
    shell: /\.(cmd|bat)$/i.test(NPX),
    env: { ...process.env, CI: '1' },
  });
  if (VERBOSE) process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  if (!fs.existsSync(report)) {
    process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    fail(`vitest(${label}) 未产出 JSON 报告 —— 进程可能直接崩了，看上面的原始输出`);
  }
  try {
    return JSON.parse(fs.readFileSync(report, 'utf-8'));
  } catch (err) {
    fail(`vitest(${label}) JSON 报告解析失败：${err.message}`);
  } finally {
    fs.rmSync(report, { force: true });
  }
}

/** 把一份报告拆成「用例级失败」与「文件级失败」。 */
function collect(report, pass) {
  const cases = [];
  const suites = [];
  for (const suite of report.testResults ?? []) {
    const file = suite.name ? path.relative(ROOT, suite.name) : '(unknown)';
    const assertions = suite.assertionResults ?? [];
    const failed = assertions.filter((a) => a.status === 'failed');
    for (const a of failed) {
      const fullName = a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ');
      cases.push({
        fullName: String(fullName).replace(/\s+/g, ' ').trim(),
        file,
        pass,
        message: (a.failureMessages ?? []).join('\n'),
      });
    }
    // 文件级失败：suite 红但没有任何用例失败 → 收集/编译/钩子出错，不能算进白名单。
    if (suite.status === 'failed' && failed.length === 0) {
      suites.push({ file, pass, message: suite.message ?? '(无错误信息)' });
    }
  }
  return { cases, suites, total: report.numTotalTests ?? 0, passed: report.numPassedTests ?? 0 };
}

console.log(`网关测试门：${NODE_DIR}`);
console.log(`已知基线白名单：${KNOWN_FAILURES.length} 条`);
console.log(`串行 E2E（脱离主集并发）：${SERIAL_E2E_FILES.length} 个\n`);

let allCases = [];
let allSuites = [];
let total = 0;
let passed = 0;

// ① 主集：排除会 spawn 子进程的 E2E 文件（用 CLI --exclude，不动 vitest.config）。
const excludeArgs = SERIAL_E2E_FILES.map((f) => `--exclude=**/${path.basename(f)}`);
console.log('[1/2] 主集');
const main = runVitest('main', excludeArgs);
{
  const c = collect(main, 'main');
  allCases = allCases.concat(c.cases);
  allSuites = allSuites.concat(c.suites);
  total += c.total;
  passed += c.passed;
  console.log(`      ${c.passed}/${c.total} 通过`);
}

// ② 串行 E2E：逐个文件单独跑（每轮独立进程，互不争抢 CPU）。
for (const [i, file] of SERIAL_E2E_FILES.entries()) {
  console.log(`[2/2] E2E ${i + 1}/${SERIAL_E2E_FILES.length}：${file}`);
  const one = runVitest(`e2e-${i}`, [file]);
  const c = collect(one, `e2e:${file}`);
  allCases = allCases.concat(c.cases);
  allSuites = allSuites.concat(c.suites);
  total += c.total;
  passed += c.passed;
  console.log(`      ${c.passed}/${c.total} 通过`);
}

console.log(`\n合计用例：${passed}/${total} 通过（失败 ${allCases.length}）`);

const knownSet = new Set(KNOWN_FAILURES);
const unexpected = allCases.filter((c) => !knownSet.has(c.fullName));
const suppressed = allCases.filter((c) => knownSet.has(c.fullName));
const fixed = KNOWN_FAILURES.filter((k) => !allCases.some((c) => c.fullName === k));

if (suppressed.length) {
  console.log(`\n⚠ 命中已知基线 ${suppressed.length} 例（不阻断）：`);
  for (const c of suppressed) console.log(`  · ${c.fullName}\n    ${c.file}`);
}
if (fixed.length) {
  console.log('\nℹ 以下白名单条目本次通过 —— 基线已修复，请从 KNOWN_FAILURES 删除：');
  for (const k of fixed) console.log(`  · ${k}`);
}
if (allSuites.length) {
  console.error(`\n✗ ${allSuites.length} 个测试文件整体失败（非用例级，必须修）：`);
  for (const s of allSuites) {
    console.error(`  · ${s.file}　[${s.pass}]`);
    console.error(`    ${String(s.message).split('\n').slice(0, 6).join('\n    ')}`);
  }
}
if (unexpected.length) {
  console.error(`\n✗ ${unexpected.length} 个白名单之外的失败：`);
  for (const c of unexpected) {
    console.error(`  · ${c.fullName}\n    ${c.file}　[${c.pass}]`);
    const brief = String(c.message).split('\n').slice(0, 8).join('\n    ');
    if (brief) console.error(`    ${brief}`);
  }
  console.error('\n新增失败必须修复，或（若确属已知基线）加入 KNOWN_FAILURES 并说明原因。');
  process.exit(1);
}
if (allSuites.length) process.exit(1);

console.log('\n✓ 网关测试通过（无白名单之外的失败）');
