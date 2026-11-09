/**
 * groups-mode.ts — 群存储后端开关的唯一判定点。
 *
 * `SF_GROUPS_BACKEND` 三个取值：
 *   - 未设 / 'python'（**默认，唯一受支持的生产路径**）→ 群数据留在 Python 的
 *     `.shadowflow/groups/*.json`，Node 只做 HTTP 代理与回复生成。
 *   - 'node'（**实验分支，自 2026-11-09 起不再维护**）→ 群数据落 Node 的
 *     SQLite `groups` / `group_messages` 两表。代码保留以便回滚，但请不要在新环境启用。
 *   - 'dual'（**实验分支，不再维护**）→ 双写校验。它违反「单一写者」原则，只在
 *     历史迁移期用过。
 *
 * 为什么保留而不删：留回滚余地（任务书方向锁 2）。启用 experimental 模式时会在
 * 首次判定处打一条醒目告警，避免有人不知情地跑在实验分支上。
 */

export type GroupsBackendMode = 'python' | 'node' | 'dual';

let _warned = false;

/** 当前模式（每次读 env，不缓存——测试可在用例间切换）。 */
export function currentGroupsBackendMode(): GroupsBackendMode {
  const mode = process.env.SF_GROUPS_BACKEND;
  if (mode === 'node') return 'node';
  if (mode === 'dual') return 'dual';
  return 'python';
}

/** 读取模式并在首次进入实验分支时告警（进程内只告警一次）。 */
export function assertGroupsBackendMode(): GroupsBackendMode {
  const mode = currentGroupsBackendMode();
  if (mode !== 'python' && !_warned) {
    _warned = true;
    console.warn(
      `[groups] ⚠ SF_GROUPS_BACKEND=${mode} 属实验分支，自 2026-11-09 起不再维护；` +
        '生产请使用默认的 python 后端（.shadowflow/groups/*.json 为权威存储）。' +
        '详见 docs/群存储归属.md',
    );
  }
  return mode;
}

/** 测试用：重置告警去重标记。 */
export function _resetGroupsModeWarningForTests(): void {
  _warned = false;
}
