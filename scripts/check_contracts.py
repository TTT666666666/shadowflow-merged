#!/usr/bin/env python3
"""
Check that generated TS contracts are in sync with their single sources.

契约两家族（docs/新架构蓝图-v2.md §2）：
  ① 运行时契约（Python 源）：shadowflow/runtime/contracts.py
     → backend/node/src/generated/sf-contracts.ts
     → frontend/src/generated/sf-contracts.ts     （字节级比对）
  ② 时间线契约（Node 源）：backend/node/src/lib/contracts.ts
     → frontend/src/chat-api.ts 子集               （名称级比对）

Exits with code 0 if in sync, 1 if drift is detected.
Run by CI in the lint-backend job, or locally via `npm run contracts:check`.

Usage:
    python scripts/check_contracts.py
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
GENERATED_OUTPUTS = [
    PROJECT_ROOT / "backend" / "node" / "src" / "generated" / "sf-contracts.ts",
    PROJECT_ROOT / "frontend" / "src" / "generated" / "sf-contracts.ts",
]
TIMELINE_SOURCE = PROJECT_ROOT / "backend" / "node" / "src" / "lib" / "contracts.ts"
TIMELINE_SUBSET = PROJECT_ROOT / "frontend" / "src" / "chat-api.ts"

# chat-api.ts「基础类型（contracts.ts 子集）」应与 Node lib/contracts.ts 同名的类型。
# 任一侧新增/改名未同步 → 名称级漂移。
TIMELINE_SUBSET_NAMES = [
    "MessageKind",
    "TimelineMessageBase",
    "StepRow",
    "DiffLine",
    "PlanTaskRow",
    "CommitFileEntry",
    "IntentAssignment",
    "UserAttachment",
    "TimelineMessage",
    "MessagePatch",
]

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
import generate_ts_types  # noqa: E402


def _field_lines(text: str) -> set[str]:
    """Extract non-comment, non-empty lines from a TypeScript file for diffing."""
    result: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("//"):
            result.add(stripped)
    return result


def check_generated() -> int:
    """① 运行时契约：两份生成产物与 contracts.py 字节级同步。"""
    rc = 0
    with tempfile.NamedTemporaryFile(suffix=".ts", delete=False, mode="w", encoding="utf-8") as f:
        tmp = Path(f.name)

    try:
        generate_ts_types.generate(tmp)
        generated = tmp.read_text(encoding="utf-8")

        for target in GENERATED_OUTPUTS:
            try:
                rel: Path | str = target.relative_to(PROJECT_ROOT)
            except ValueError:
                rel = target  # 测试可注入项目外的临时路径
            if not target.exists():
                print(f"schema drift detected: {rel} not found — "
                      "run `python scripts/generate_ts_types.py` and commit the result")
                rc = 1
                continue

            current = target.read_text(encoding="utf-8")
            if current == generated:
                print(f"OK: {rel} is up-to-date with contracts.py")
                continue

            curr_lines = _field_lines(current)
            gen_lines = _field_lines(generated)
            added = sorted(gen_lines - curr_lines)
            removed = sorted(curr_lines - gen_lines)

            changes: list[str] = []
            for line in added[:8]:
                changes.append(f"+{line}")
            for line in removed[:8]:
                changes.append(f"-{line}")
            drift_str = ", ".join(changes) if changes else "file content differs"
            print(f"schema drift detected in {rel}: {drift_str}")
            print("Fix: run `python scripts/generate_ts_types.py` and commit both outputs")
            rc = 1
    finally:
        tmp.unlink(missing_ok=True)
    return rc


def check_timeline_subset() -> int:
    """② 时间线契约：chat-api.ts 子集名称与 lib/contracts.ts 同步。"""
    if not TIMELINE_SOURCE.exists() or not TIMELINE_SUBSET.exists():
        print("timeline contracts missing — expected both lib/contracts.ts and chat-api.ts")
        return 1

    def exported_names(path: Path) -> set[str]:
        text = path.read_text(encoding="utf-8")
        return set(re.findall(r"export\s+(?:interface|type)\s+([A-Za-z0-9_]+)", text))

    src_names = exported_names(TIMELINE_SOURCE)
    subset_names = exported_names(TIMELINE_SUBSET)

    missing_in_src = [n for n in TIMELINE_SUBSET_NAMES if n not in src_names]
    missing_in_subset = [n for n in TIMELINE_SUBSET_NAMES if n not in subset_names]

    rc = 0
    if missing_in_src:
        print(f"timeline drift: lib/contracts.ts 缺少 {missing_in_src}")
        rc = 1
    if missing_in_subset:
        print(f"timeline drift: chat-api.ts 缺少 {missing_in_subset}")
        rc = 1
    if rc == 0:
        print(f"OK: timeline contract subset in sync ({len(TIMELINE_SUBSET_NAMES)} names)")
    else:
        print("Fix: 在唯一源头（lib/contracts.ts）改型后同步 chat-api.ts 子集，"
              "或更新 scripts/check_contracts.py 的 TIMELINE_SUBSET_NAMES")
    return rc


def scan_frontend_secrets() -> int:
    """Scan frontend + gateway source for hardcoded private keys or API secrets (AR4)."""
    patterns = [
        re.compile(r"0x[0-9a-fA-F]{64}"),
        re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    ]

    scan_roots = [
        PROJECT_ROOT / "frontend" / "src",
        PROJECT_ROOT / "frontend" / "ProductApp.tsx",
        PROJECT_ROOT / "backend" / "node" / "src",
    ]

    violations: list[str] = []
    for root in scan_roots:
        files = [root] if root.is_file() else list(root.rglob("*.ts")) + list(root.rglob("*.tsx"))
        for f in files:
            if "generated" in f.parts:  # 生成产物不扫（源头扫描覆盖）
                continue
            if f.name.endswith(".test.ts") or f.name.endswith(".test.tsx") or "__tests__" in f.parts:
                continue  # 测试夹具里的假 key（sk-attacker-key-* 等）不计泄漏
            rel = f.relative_to(PROJECT_ROOT)
            try:
                content = f.read_text(encoding="utf-8")
            except Exception:
                continue
            for pat in patterns:
                for match in pat.finditer(content):
                    # Skip test assertions using repeat patterns like 'ab'.repeat(32)
                    context = content[max(0, match.start() - 20):match.end() + 20]
                    if "repeat(" in context or "REDACTED" in context:
                        continue
                    violations.append(f"  {rel}: {match.group()[:16]}...")

    if violations:
        print(f"secret leak detected in {len(violations)} location(s):")
        for v in violations:
            print(v)
        return 1

    print("OK: no hardcoded secrets found in frontend/gateway source")
    return 0


if __name__ == "__main__":
    rc = check_generated() or check_timeline_subset()
    rc2 = scan_frontend_secrets()
    sys.exit(rc or rc2)
