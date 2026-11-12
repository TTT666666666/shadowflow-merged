# -*- coding: utf-8 -*-
"""回归集：把「哪些该放行、哪些该拦」钉死。

这套集的用途不是证明准确率，而是**防止退化**——任何一次词表改动，只要让
P01（100% 纯棉）重新被判违规，或让 B01（全网最低价）不再被拦，这里就会红。
真实准召需要第三方标注的真实 listing，见 docs/诊断引擎评测-2026-11.md。
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

import pytest

from shadowflow.services.listing_doctor import analyze

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "listing_golden.json")

with open(FIXTURE, encoding="utf-8") as _fh:
    CASES: List[Dict[str, Any]] = json.load(_fh)["cases"]
IDS = [case["id"] for case in CASES]


def _run(case: Dict[str, Any]) -> Dict[str, Any]:
    return analyze(
        {
            "title": case["title"],
            "points": case["points"],
            "price_cents": case.get("price_cents"),
            "category": case.get("category") or "auto",
            "platform": case.get("platform") or "generic",
        }
    )


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_verdict_matches_expectation(case: Dict[str, Any]) -> None:
    """pass 组必须放行，block 组必须拦下。"""
    report = _run(case)
    expect_list = case["group"] == "pass"
    assert report["gates"]["can_list"] is expect_list, (
        f'{case["id"]} 判定错了：can_list={report["gates"]["can_list"]}，'
        f'期望 {expect_list}，得分 {report["score"]["total"]}。{case.get("note", "")}'
    )


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_required_and_forbidden_codes(case: Dict[str, Any]) -> None:
    """must_ids 必须命中；must_not_ids 一个都不能出现。"""
    report = _run(case)
    hit = {issue["id"] for issue in report["issues"]}

    missing = [code for code in case.get("must_ids", []) if code not in hit]
    assert not missing, f'{case["id"]} 漏报 {missing}；实际命中 {sorted(hit)}'

    false_alarm = [code for code in case.get("must_not_ids", []) if code in hit]
    assert not false_alarm, f'{case["id"]} 误杀 {false_alarm}；{case.get("note", "")}'
