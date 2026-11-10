#!/usr/bin/env node
/**
 * scripts/dedupe-agents.mjs — 合并同名 Agent（2026-11-10）
 *
 * ## 为什么会有重名
 * `backend/node/src/storage/craft-team-setup.ts` 早期版本对 6 个岗位无条件
 * `POST /api/agents`，而 Python 侧早已播种了 6 个同名 agent（`seed-ai-marketing-org`）。
 * 结果同一岗位在 `.shadowflow/agents/` 里躺了两份，各自挂在「AI 营销公司」
 * 与「手工艺品代卖团队」下 —— 界面上就是同名两行、描述还各不相同。
 * 根因已在 setup 里改成「按名字复用」，本脚本负责清理存量。
 *
 * ## 合并规则（确定性，可复现）
 * 1. 分组键：`name` + `workspace_id`（缺省按 default），避免跨工作区误并；
 * 2. **保留** `created_at` 最早的那条 —— 那是种子/稳定 ID（`agent-market-analyst`
 *    这类），被 `.agent.yaml` 模板、文档与测试引用；随手建的 `agent-<hex>` 不稳；
 * 3. 保留条的 soul 取组内**最长**的一条 —— 话术只会越迭代越长（新增输出协议等），
 *    最长即最新；
 * 4. 其余条目的引用全部重映射到保留 ID：`teams/*.json` 的 `agent_ids` 与
 *    `workflow.nodes[].data.agentId`、`groups/*.json` 的 `agent_ids`、
 *    `team_workflow_versions/*.json` 的历史快照；
 * 5. 重映射后删掉重复的 agent 记录。
 *
 * ## 安全
 * - 动手前整目录备份到 `.workbuddy/backup/dedupe-<时间戳>/`（agents / teams /
 *   groups / team_workflow_versions），回滚就是拷回去；
 * - `--dry` 只打印计划，不写盘；
 * - 幂等：没有重名时什么都不做（第二次跑输出「无重名」）。
 *
 * 用法：
 *   node scripts/dedupe-agents.mjs --dry     # 看要删什么
 *   node scripts/dedupe-agents.mjs           # 真删（先自动备份）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SF = path.join(ROOT, '.shadowflow');
const AGENTS = path.join(SF, 'agents');
const TEAMS = path.join(SF, 'teams');
const GROUPS = path.join(SF, 'groups');
const WF_VERSIONS = path.join(SF, 'team_workflow_versions');

const DRY = process.argv.includes('--dry');

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

/** 备份四个目录（只拷 json，量小）。 */
function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(ROOT, '.workbuddy', 'backup', `dedupe-${stamp}`);
  for (const [name, dir] of [
    ['agents', AGENTS],
    ['teams', TEAMS],
    ['groups', GROUPS],
    ['team_workflow_versions', WF_VERSIONS],
  ]) {
    if (!existsSync(dir)) continue;
    const out = path.join(dest, name);
    mkdirSync(out, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      copyFileSync(path.join(dir, f), path.join(out, f));
    }
  }
  return dest;
}

// ── 1. 分组找重名 ───────────────────────────────────────────────────────────
const agentFiles = listJson(AGENTS);
const records = [];
for (const file of agentFiles) {
  const rec = readJson(file);
  if (!rec?.agent_id) continue;
  records.push({ file, rec });
}

const byKey = new Map();
for (const item of records) {
  const name = String(item.rec.name ?? '').trim();
  if (!name) continue; // 无名记录不参与合并
  const ws = String(item.rec.workspace_id ?? 'default');
  const key = `${ws}\u0000${name}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(item);
}

const dups = [...byKey.entries()].filter(([, list]) => list.length > 1);
if (dups.length === 0) {
  console.log('✅ 没有重名 agent，无需处理。');
  process.exit(0);
}

// ── 2. 定保留条 + 合并 soul ──────────────────────────────────────────────────
const remap = new Map(); // dupId -> keeperId
const plan = [];
for (const [, list] of dups) {
  const sorted = [...list].sort((a, b) => {
    const ta = String(a.rec.created_at ?? '');
    const tb = String(b.rec.created_at ?? '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.rec.agent_id) < String(b.rec.agent_id) ? -1 : 1;
  });
  const keeper = sorted[0];
  const victimIds = sorted.slice(1).map((x) => x.rec.agent_id);
  const bestSoul = sorted
    .map((x) => String(x.rec.soul ?? ''))
    .reduce((a, b) => (b.length > a.length ? b : a), '');
  for (const vid of victimIds) remap.set(vid, keeper.rec.agent_id);
  plan.push({
    name: keeper.rec.name,
    keeperId: keeper.rec.agent_id,
    keeperFile: keeper.file,
    keeperSoul: String(keeper.rec.soul ?? ''),
    bestSoul,
    victims: victimIds,
    victimFiles: sorted.slice(1).map((x) => x.file),
  });
}

console.log(`发现 ${plan.length} 组重名 agent：`);
for (const p of plan) {
  console.log(
    `  · ${p.name}\n      保留 ${p.keeperId}（soul ${p.keeperSoul.length} 字）` +
      `\n      合并 ${p.victims.join(', ')}（最长 soul ${p.bestSoul.length} 字）`,
  );
}

if (DRY) {
  console.log('\n--dry：未写盘。');
  process.exit(0);
}

const backupDir = backup();
console.log(`\n已备份到 ${path.relative(ROOT, backupDir)}`);

// ── 3. 写入合并后的保留条 ───────────────────────────────────────────────────
for (const p of plan) {
  const rec = readJson(p.keeperFile);
  if (!rec) continue;
  if (p.bestSoul && p.bestSoul.length > p.keeperSoul.length) rec.soul = p.bestSoul;
  rec.updated_at = new Date().toISOString();
  writeJson(p.keeperFile, rec);
}

/** 把 id 数组里的重复项映射到保留 ID 并去重（保序）。 */
function remapIds(ids) {
  if (!Array.isArray(ids)) return ids;
  const out = [];
  for (const raw of ids) {
    const id = remap.get(String(raw)) ?? String(raw);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

let touchedTeams = 0;
let touchedVersions = 0;

// ── 4. 重映射 teams（成员 + workflow 节点）───────────────────────────────────
for (const file of listJson(TEAMS)) {
  const team = readJson(file);
  if (!team) continue;
  let changed = false;
  if (Array.isArray(team.agent_ids)) {
    const next = remapIds(team.agent_ids);
    if (JSON.stringify(next) !== JSON.stringify(team.agent_ids)) {
      team.agent_ids = next;
      changed = true;
    }
  }
  const nodes = team.workflow?.nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const id = n?.data?.agentId;
      if (id && remap.has(String(id))) {
        n.data.agentId = remap.get(String(id));
        changed = true;
      }
    }
  }
  if (changed) {
    team.updated_at = new Date().toISOString();
    writeJson(file, team);
    touchedTeams += 1;
    console.log(`  重映射 team ${team.team_id ?? path.basename(file)}`);
  }
}

// ── 5. 重映射 groups ────────────────────────────────────────────────────────
for (const file of listJson(GROUPS)) {
  const group = readJson(file);
  if (!group || !Array.isArray(group.agent_ids)) continue;
  const next = remapIds(group.agent_ids);
  if (JSON.stringify(next) !== JSON.stringify(group.agent_ids)) {
    group.agent_ids = next;
    writeJson(file, group);
    console.log(`  重映射 group ${group.group_id ?? path.basename(file)}`);
  }
}

// ── 6. 重映射 workflow 版本快照 ─────────────────────────────────────────────
for (const file of listJson(WF_VERSIONS)) {
  const rec = readJson(file);
  if (!rec) continue;
  const nodes = rec.workflow?.nodes ?? rec.nodes;
  if (!Array.isArray(nodes)) continue;
  let changed = false;
  for (const n of nodes) {
    const id = n?.data?.agentId;
    if (id && remap.has(String(id))) {
      n.data.agentId = remap.get(String(id));
      changed = true;
    }
  }
  if (changed) {
    writeJson(file, rec);
    touchedVersions += 1;
  }
}

// ── 7. 删重复记录 ───────────────────────────────────────────────────────────
let deleted = 0;
for (const p of plan) {
  for (const file of p.victimFiles) {
    if (!existsSync(file)) continue;
    unlinkSync(file);
    deleted += 1;
  }
}

console.log(
  `\n✅ 合并完成：${plan.length} 组 / 删除 ${deleted} 条重复 agent / ` +
    `重映射 ${touchedTeams} 个团队、${touchedVersions} 个 workflow 快照。\n` +
    `   回滚：把 ${path.relative(ROOT, backupDir)} 下四个目录拷回 .shadowflow/ 即可。`,
);
