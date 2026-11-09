/**
 * groups-persistence.ts — 群持久化的**唯一出口**（Node → Python）。
 *
 * 为什么需要它
 * ------------
 * 群消息的权威存储在 Python（`.shadowflow/groups/*.json`，单写者语义写在
 * `shadowflow/api/groups/groups.py` 的注释里）。Node 侧原先有三处以不同方式打这个
 * API：`storage/groups-backend.ts`（网关读写）、`middleware/group-access.ts`（归属
 * 校验），各自拼 URL、各自决定超时与错误处理，且靠一个隐式头 `X-SF-No-Dispatch`
 * 表达「别让 Python 也回一条」。
 *
 * 收敛后：
 *   1. **所有** Node → Python 的群持久化请求都走本模块的 `pythonGroupsFetch`；
 *   2. 「内部来源」从隐式头改为**显式 query 语义** `?source=gateway`；
 *   3. 旧头 `X-SF-No-Dispatch` 仍同时发送（兼容一个版本周期，Python 侧收到会打
 *      弃用日志），下个版本删掉。
 *
 * 不做的事：本模块不关心「后端开关」（python/node/dual），那是
 * `storage/groups-backend.ts` 的职责；这里只负责「怎么和 Python 说话」。
 */

import { PYTHON_BACKEND_URL } from '../python-backend';
import { assertGroupsBackendMode } from './groups-mode';

/** 内部调用来源标记：Node 网关自己写消息（抑制 Python 自带的回复桥）。 */
export const INTERNAL_SOURCE = 'gateway';

/** 群 API 基址（统一拼法，避免各调用点自己拼错）。 */
export function pythonGroupsBase(): string {
  return `${PYTHON_BACKEND_URL}/api/groups`;
}

/** 群 API 完整 URL；internal=true 时附 `?source=gateway`。 */
export function pythonGroupsUrl(path: string, opts: { internal?: boolean } = {}): string {
  const base = `${pythonGroupsBase()}${path.startsWith('/') ? path : `/${path}`}`;
  if (!opts.internal) return base;
  return `${base}${base.includes('?') ? '&' : '?'}source=${INTERNAL_SOURCE}`;
}

export interface GroupsFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 内部来源（网关代写）：附 `?source=gateway` + 兼容头 X-SF-No-Dispatch。 */
  internal?: boolean;
  /** 毫秒；默认 15s（群读写在聊天热路径上，不能无限等）。 */
  timeoutMs?: number;
}

/**
 * 打一个 Python 群 API。非 2xx 抛错（调用方决定是降级还是冒泡）；
 * 返回体按 JSON 解析，解析失败返回 null。
 */
export async function pythonGroupsFetch<T = unknown>(
  path: string,
  opts: GroupsFetchOptions = {},
): Promise<T | null> {
  assertGroupsBackendMode();
  const { method = 'GET', body, internal = false, timeoutMs = 15_000 } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (internal) {
    // 兼容一个版本周期：Python 侧仍认这个头（会打弃用日志），新语义是 query。
    headers['X-SF-No-Dispatch'] = '1';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(pythonGroupsUrl(path, { internal }), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`python groups ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json().catch(() => null)) as T | null;
  } finally {
    clearTimeout(timer);
  }
}
