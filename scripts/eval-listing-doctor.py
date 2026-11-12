# -*- coding: utf-8 -*-
"""诊断引擎评测：用固定回归集跑出可复跑的指标。

用法
----
    python scripts/eval-listing-doctor.py            # 打印报告
    python scripts/eval-listing-doctor.py --md       # 输出 Markdown（写文档用）

指标口径
--------
- 放行准确率：pass 组里 ``can_list=True`` 的比例。低 = 误杀合规商品。
- 拦截准确率：block 组里 ``can_list=False`` 的比例。低 = 放过违规文案。
- 关键码召回：block 组声明的 must_ids 实际命中比例。低 = 知道该拦，但没抓到。
- 误杀码：pass 组声明 must_not_ids 却命中的次数。这是最伤信任的一类错误。

为什么不用 precision/recall 的常规定义：回归集只标注了「关键码」和「禁出码」，
没有标注每条的全部应报问题。用全套 P/R 会算出一个看着专业、实际无意义的数。
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend", "python"))

from shadowflow.services.listing_doctor import analyze  # noqa: E402

FIXTURE = os.path.join(ROOT, "backend", "python", "tests", "fixtures", "listing_golden.json")


def load_cases() -> List[Dict[str, Any]]:
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["cases"]


def run_case(case: Dict[str, Any]) -> Dict[str, Any]:
    report = analyze(
        {
            "title": case["title"],
            "points": case["points"],
            "price_cents": case.get("price_cents"),
            "category": case.get("category") or "auto",
            "platform": case.get("platform") or "generic",
        }
    )
    hit = {issue["id"] for issue in report["issues"]}
    expect_list = case["group"] == "pass"
    return {
        "id": case["id"],
        "group": case["group"],
        "note": case.get("note", ""),
        "score": report["score"]["total"],
        "can_list": report["gates"]["can_list"],
        "verdict_ok": report["gates"]["can_list"] is expect_list,
        "hit": hit,
        "missing": [c for c in case.get("must_ids", []) if c not in hit],
        "false_alarm": [c for c in case.get("must_not_ids", []) if c in hit],
        "n_issues": len(report["issues"]),
    }


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    pass_rows = [r for r in rows if r["group"] == "pass"]
    block_rows = [r for r in rows if r["group"] == "block"]
    total_must = sum(len(c) for c in [r["missing"] for r in block_rows])  # placeholder
    must_total = 0
    must_hit = 0
    with open(FIXTURE, encoding="utf-8") as fh:
        cases = {c["id"]: c for c in json.load(fh)["cases"]}
    for row in block_rows:
        for code in cases[row["id"]].get("must_ids", []):
            must_total += 1
            if code in row["hit"]:
                must_hit += 1

    return {
        "pass_total": len(pass_rows),
        "pass_ok": sum(1 for r in pass_rows if r["verdict_ok"]),
        "block_total": len(block_rows),
        "block_ok": sum(1 for r in block_rows if r["verdict_ok"]),
        "must_total": must_total,
        "must_hit": must_hit,
        "false_alarm_total": sum(len(r["false_alarm"]) for r in pass_rows),
        "verdict_ok": sum(1 for r in rows if r["verdict_ok"]),
        "total": len(rows),
        "_unused": total_must,
    }


def pct(num: int, den: int) -> str:
    return f"{num}/{den} = {num / den * 100:.0f}%" if den else "n/a"


def main() -> int:
    rows = [run_case(c) for c in load_cases()]
    s = summarize(rows)

    print("=" * 62)
    print("诊断引擎回归评测")
    print("=" * 62)
    print(f"放行准确率  {pct(s['pass_ok'], s['pass_total'])}   （合规商品没被误拦）")
    print(f"拦截准确率  {pct(s['block_ok'], s['block_total'])}   （违规文案没被放过）")
    print(f"关键码召回  {pct(s['must_hit'], s['must_total'])}   （该抓的关键词抓到了）")
    print(f"判定总准确  {pct(s['verdict_ok'], s['total'])}")
    print(f"误杀码次数  {s['false_alarm_total']}")
    print()

    bad = [r for r in rows if not r["verdict_ok"] or r["missing"] or r["false_alarm"]]
    if bad:
        print("-" * 62)
        print("需要处理的条目")
        print("-" * 62)
        for r in bad:
            flags = []
            if not r["verdict_ok"]:
                flags.append(f"判定错(score={r['score']}, can_list={r['can_list']})")
            if r["missing"]:
                flags.append("漏报 " + ",".join(r["missing"]))
            if r["false_alarm"]:
                flags.append("误杀 " + ",".join(r["false_alarm"]))
            print(f"{r['id']}  {' | '.join(flags)}")
            print(f"      {r['note']}")
        print()

    if "--md" in sys.argv:
        print()
        print("| 指标 | 结果 | 含义 |")
        print("|---|---|---|")
        print(f"| 放行准确率 | {pct(s['pass_ok'], s['pass_total'])} | 合规商品没被误拦 |")
        print(f"| 拦截准确率 | {pct(s['block_ok'], s['block_total'])} | 违规文案没被放过 |")
        print(f"| 关键码召回 | {pct(s['must_hit'], s['must_total'])} | 该抓的关键词抓到了 |")
        print(f"| 判定总准确 | {pct(s['verdict_ok'], s['total'])} | 24 条里判对多少 |")

    failed = bool(bad)
    return 1 if failed and "--strict" in sys.argv else 0


if __name__ == "__main__":
    raise SystemExit(main())
