#!/usr/bin/env node
/**
 * py-serve.mjs — 分步启动 Python 编排核心（替代 npm script 里硬编码 --port 8000）。
 *
 *   npm run dev:python
 *
 * 端口从 config/ports.json 读取（env SF_PY_PORT 可覆盖），与 dev.mjs 同一口径。
 * 额外参数透传，如：node scripts/py-serve.mjs --reload
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadPorts } from "./ports.mjs";

const IS_WIN = process.platform === "win32";

function resolvePython() {
  if (process.env.SF_PYTHON) return process.env.SF_PYTHON;
  const venvPy = IS_WIN
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
  return fs.existsSync(venvPy) ? venvPy : "python";
}

const ports = loadPorts();
const pyBin = resolvePython();
const child = spawn(
  pyBin,
  [
    "-m", "uvicorn", "shadowflow.server:app",
    "--app-dir", path.join(ROOT, "backend", "python"),
    "--host", "127.0.0.1", "--port", String(ports.python),
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
