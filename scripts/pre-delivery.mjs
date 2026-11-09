#!/usr/bin/env node
/**
 * pre-delivery.mjs — 本地交付门（npm run gate）。
 *
 * 顺序跑 6 步，全部跑完再汇总（不 fail-fast，这样一次就能看到所有问题）：
 *   1. 端口配置校验      config/ports.json 三键齐全 / 正整数 / 互不冲突
 *   2. 契约校验          python scripts/check_contracts.py（漂移 + 前端密钥扫描）
 *   3. Python 测试       pytest（backend/python）
 *   4. Node 类型检查     tsc --noEmit（craft 域有已知基线错误 → 只报告不拦截）
 *   5. Node 测试         vitest run
 *   6. 前端 类型+测试+构建 tsc --noEmit → vitest run → vite build
 *
 * 任一步失败 → 退出码 1。用法：
 *   npm run gate            全量
 *   npm run gate -- --fast  跳过构建（只跑校验 + 测试）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const FAST = process.argv.includes('--fast');
const IS_WIN = process.platform === 'win32';

/** Python 解释器：优先仓库 .venv，其次 PATH 里的 python。 */
function pythonBin() {
  const candidates = IS_WIN
    ? [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), 'python']
    : [path.join(ROOT, '.venv', 'bin', 'python'), 'python3'];
  for (const c of candidates) {
    if (!c.includes(path.sep) || fs.existsSync(c)) return c;
  }
  return 'python';
}

const results = [];
let stepNo = 0;

/**
 * 网关测试判定已收敛到 scripts/ci-node-tests.mjs（CI 与本地同一份白名单），
 * 这里不再保留「允许 N 个失败」的数字口径 —— 数字口径无法区分「旧的 2 个」
 * 和「新的 2 个」，会把新引入的失败一起放过去。
 */

function run(name, cmd, args, opts = {}) {
  stepNo += 1;
  const label = `[${stepNo}] ${name}`;
  console.log(`\n${'─'.repeat(64)}\n${label}\n  $ ${cmd} ${args.join(' ')}`);
  const started = Date.now();
  // 只有 .cmd/.bat 需要 shell（Windows 下 npm/npx 是批处理外壳）。
  // 绝对路径（Python 解释器）若带空格，走 shell 会被截断 → 必须 shell:false。
  const needsShell = /\.(cmd|bat)$/i.test(cmd);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: 'inherit',
    shell: needsShell,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = r.status === 0;
  results.push({ name, ok, seconds, blocking: opts.blocking !== false, note: opts.note });
  if (!ok && opts.blocking === false) {
    console.warn(`  ⚠ 非阻断步骤失败（${seconds}s）—— ${opts.note ?? '已知基线'}`);
  }
  return ok;
}

/**
 * 捕获输出的运行：用于需要「按失败数量比对基线」的步骤。
 * allowFailures = 允许的失败用例数（超出即失败）。
 */
function runCaptured(name, cmd, args, opts = {}) {
  stepNo += 1;
  const label = `[${stepNo}] ${name}`;
  console.log(`\n${'─'.repeat(64)}\n${label}\n  $ ${cmd} ${args.join(' ')}`);
  const started = Date.now();
  const needsShell = /\.(cmd|bat)$/i.test(cmd);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf-8',
    shell: needsShell,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const clean = r.status === 0;
  let ok = clean;
  let note = opts.note;
  if (!clean && typeof opts.allowFailures === 'number') {
    // vitest 汇总行带 ANSI 颜色，先剥掉再匹配（Tests  \x1b[31m2 failed\x1b[39m）。
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
    const m = /Tests\s+(\d+) failed/.exec(plain);
    const failedCount = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
    if (failedCount <= opts.allowFailures) {
      ok = true;
      note = `基线内 ${failedCount} 个已知失败（允许 ${opts.allowFailures}）`;
    }
  }
  results.push({ name, ok, seconds, blocking: opts.blocking !== false, note });
  return ok;
}

// ── 1. 端口配置校验（不依赖任何服务，纯 JSON 校验） ──────────────────────────
function checkPorts() {
  stepNo += 1;
  const started = Date.now();
  const label = `[${stepNo}] 端口配置校验`;
  console.log(`\n${'─'.repeat(64)}\n${label}`);
  const file = path.join(ROOT, 'config', 'ports.json');
  const errors = [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const cfg = JSON.parse(raw);
    for (const key of ['web', 'gateway', 'python']) {
      const v = cfg[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 65535) {
        errors.push(`${key} 必须是 1-65535 的整数，实际 ${JSON.stringify(v)}`);
      }
    }
    const seen = new Map();
    for (const key of ['web', 'gateway', 'python']) {
      const v = cfg[key];
      if (typeof v !== 'number') continue;
      if (seen.has(v)) errors.push(`端口冲突：${seen.get(v)} 与 ${key} 都是 ${v}`);
      seen.set(v, key);
    }
    const extra = Object.keys(cfg).filter((k) => !['web', 'gateway', 'python'].includes(k));
    if (extra.length) console.log(`  ℹ 额外键（忽略）：${extra.join(', ')}`);
  } catch (err) {
    errors.push(`读取/解析失败：${err.message}`);
  }
  const ok = errors.length === 0;
  if (ok) console.log('  ✓ config/ports.json 合法（web / gateway / python 三键，端口互不冲突）');
  else errors.forEach((e) => console.error(`  ✗ ${e}`));
  results.push({ name: '端口配置校验', ok, seconds: ((Date.now() - started) / 1000).toFixed(1), blocking: true });
  return ok;
}

// ── 执行 ────────────────────────────────────────────────────────────────────
const py = pythonBin();
console.log(`仓库：${ROOT}\nPython：${py}\n模式：${FAST ? '快速（跳过前端构建）' : '全量'}`);

checkPorts();
run('契约校验', py, ['scripts/check_contracts.py']);
runCaptured('Python 测试', py, ['-m', 'pytest', '-q', '--tb=short'], {
  cwd: path.join(ROOT, 'backend', 'python'),
});
run('Node 类型检查', IS_WIN ? 'npx.cmd' : 'npx', ['tsc', '--noEmit'], {
  cwd: path.join(ROOT, 'backend', 'node'),
  blocking: false,
  note: 'craft-profit 域存在既有基线 TS 错误，逐批修复中；新增错误请人工比对',
});
run('Node 测试', process.execPath, ['scripts/ci-node-tests.mjs'], {
  note: '与 CI 同一判定：已知基线按用例白名单放行（craft-posts 2 例），新增失败阻断',
});
run('前端类型检查', IS_WIN ? 'npx.cmd' : 'npx', ['tsc', '--noEmit'], {
  cwd: path.join(ROOT, 'frontend'),
});
run('前端测试', IS_WIN ? 'npx.cmd' : 'npx', ['vitest', 'run'], {
  cwd: path.join(ROOT, 'frontend'),
});
if (!FAST) {
  run('前端构建', IS_WIN ? 'npx.cmd' : 'npx', ['vite', 'build'], {
    cwd: path.join(ROOT, 'frontend'),
  });
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}\n交付门汇总\n${'═'.repeat(64)}`);
let failed = 0;
for (const r of results) {
  const mark = r.ok ? '✓' : r.blocking ? '✗' : '⚠';
  if (!r.ok && r.blocking) failed += 1;
  console.log(`  ${mark} ${r.name.padEnd(16, ' ')} ${String(r.seconds).padStart(6)}s${r.note ? `  (${r.note})` : ''}`);
}
if (failed > 0) {
  console.error(`\n交付门未通过：${failed} 个阻断步骤失败。\n`);
  process.exit(1);
}
console.log('\n交付门通过（⚠ 为非阻断基线项，请人工确认无新增）。\n');
