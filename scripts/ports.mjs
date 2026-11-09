/**
 * ports.mjs — config/ports.json 的 Node 侧 loader（dev.mjs / py-serve.mjs 共用）。
 *
 * 单一配置源语义（docs/新架构蓝图-v2.md §1.2）：
 *   env（SF_WEB_PORT / SF_GW_PORT / SF_PY_PORT）> config/ports.json > 内置兜底
 *
 * 注意与「进程自身 PORT」的区别：PORT 是单个服务进程自己的覆盖口（部署场景），
 * 由各服务内部的 loader 处理；本 loader 面向启动器，负责让整个服务簇口径一致。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FALLBACK = { web: 8443, gateway: 8002, python: 8000 };

export function loadPorts() {
  let fileValues = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, "config", "ports.json"), "utf8");
    const parsed = JSON.parse(raw);
    fileValues = {
      web: parsed.web,
      gateway: parsed.gateway,
      python: parsed.python,
    };
  } catch {
    /* ports.json 缺失/损坏 → 走内置兜底，不阻塞启动 */
  }
  const envNum = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    web: envNum(process.env.SF_WEB_PORT) ?? fileValues.web ?? FALLBACK.web,
    gateway: envNum(process.env.SF_GW_PORT) ?? fileValues.gateway ?? FALLBACK.gateway,
    python: envNum(process.env.SF_PY_PORT) ?? fileValues.python ?? FALLBACK.python,
  };
}
