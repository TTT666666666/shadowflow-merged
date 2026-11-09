/**
 * config/ports.ts — 网关侧端口 loader（唯一）。
 *
 * 单一配置源 config/ports.json（docs/新架构蓝图-v2.md §1.2）：
 *   进程自身 env（PORT / PYTHON_BACKEND_URL / FRONTEND_ORIGIN）
 *     > config/ports.json > 内置兜底
 *
 * 各模块禁止再写字面量端口/默认 URL，一律从本模块取：
 *   - GATEWAY_PORT      网关自身监听端口
 *   - PYTHON_BACKEND_URL Python 编排核心基准 URL（也由 python-backend.ts 再导出）
 *   - FRONTEND_ORIGIN   前端来源（CORS 默认放行）
 *   - selfBaseUrl()     网关自身基准 URL（内部回调用）
 */
import fs from 'fs';
import path from 'path';

const FALLBACK = { web: 8443, gateway: 8002, python: 8000 };

function findPortsJson(): string | null {
  // __dirname = backend/node/src/config（tsx 直跑 src）或 backend/node/dist/config（编译产物）
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'config', 'ports.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function loadFilePorts(): { web: number; gateway: number; python: number } {
  try {
    const fp = findPortsJson();
    if (!fp) return { ...FALLBACK };
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return {
      web: Number(parsed.web) || FALLBACK.web,
      gateway: Number(parsed.gateway) || FALLBACK.gateway,
      python: Number(parsed.python) || FALLBACK.python,
    };
  } catch {
    return { ...FALLBACK };
  }
}

const FILE_PORTS = loadFilePorts();

export const PORTS = FILE_PORTS;

export const GATEWAY_PORT = Number(process.env.PORT ?? FILE_PORTS.gateway);

export const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ?? `http://localhost:${FILE_PORTS.python}`;

export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ?? `http://localhost:${FILE_PORTS.web}`;

/** 网关自身基准 URL（内部自回调，如 craft-post-pipeline）。 */
export function selfBaseUrl(): string {
  return `http://127.0.0.1:${GATEWAY_PORT}`;
}
