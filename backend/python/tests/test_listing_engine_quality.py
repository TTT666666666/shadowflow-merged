# -*- coding: utf-8 -*-
"""引擎质量回归：锁住已修的 bug，并把「现在还做不到」的写在明面上。

为什么要有 known defects
------------------------
规则引擎的天花板不在「能不能写规则」，在「规则写得多细」。每一条规则背后
都应该有一个真实踩坑案例。把还没覆盖的情况用 xfail 标出来，而不是假装不存在：
- 它不会让 CI 变红；
- 它会出现在 pytest 的 xfail 计数里，谁都能看到还剩几条；
- 哪天补上了，XPASS 会提示把标记删掉。
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from shadowflow.services.listing_doctor import _as_list, analyze


def _codes(payload: Dict[str, Any]) -> set:
    return {issue["id"] for issue in analyze(payload)["issues"]}


# ── 已修 bug 的回归锁 ────────────────────────────────────────────────────────


def test_points_keep_leading_digits() -> None:
    """卖点开头的数字是内容，不是列表序号。

    旧实现用 ``lstrip("-•·*0123456789.、)） ")`` 逐字符剥离，把「100%纯棉面料」
    变成「%纯棉面料」、「500ml」变成「ml」，导致材质/规格/发货三类规则全部失明。
    """
    assert _as_list(["100%纯棉面料"]) == ["100%纯棉面料"]
    assert _as_list(["500ml 容量"]) == ["500ml 容量"]
    assert _as_list(["32支精梳棉"]) == ["32支精梳棉"]
    assert _as_list(["12.5cm 厚度"]) == ["12.5cm 厚度"]


def test_points_strip_list_markers_only() -> None:
    """真正的列表符号仍要被剥掉。"""
    assert _as_list(["1. 纯棉面料"]) == ["纯棉面料"]
    assert _as_list(["- 包邮"]) == ["包邮"]
    assert _as_list(["• 7天无理由"]) == ["7天无理由"]
    assert _as_list(["1、食品级硅胶"]) == ["食品级硅胶"]


@pytest.mark.parametrize(
    "text,expect_flag",
    [
        ("100%纯棉面料", False),
        ("100% cotton, 180gsm", False),
        ("100%桑蚕丝", False),
        ("100%果汁，不加水", False),
        ("100%有效", True),
        ("百分百有效", True),
        ("100% 无添加", True),
    ],
)
def test_percent_depends_on_context(text: str, expect_flag: bool) -> None:
    """「100%」写成分是标注，写效果是承诺——同一个词，两种结论。"""
    flagged = "compliance.absolute" in _codes({"title": "商品标题测试一下", "points": [text]})
    assert flagged is expect_flag, f"{text} 判定为 {flagged}，期望 {expect_flag}"


@pytest.mark.parametrize(
    "category,text,code",
    [
        ("beauty", "烟酰胺美白精华液", "compliance.beauty.special"),
        ("baby", "食品级硅胶水杯", None),
        ("food", "有机认证茶叶", "compliance.food.cert_required"),
    ],
)
def test_category_terms_are_not_all_banned(
    category: str, text: str, code: Any
) -> None:
    """美白 / 食品级 / 有机 都是有条件合规，不能一刀切判违规。"""
    issues = analyze(
        {"title": text + " 详情页", "points": ["规格齐全，包邮发货"], "category": category}
    )["issues"]
    ids = {issue["id"] for issue in issues}
    high = [i for i in issues if i["dim"] == "compliance" and i["severity"] == "high"]
    assert not high, f"{text} 被判了高危合规问题：{[i['id'] for i in high]}"
    if code:
        assert code in ids, f"{text} 应提示 {code}，实际 {sorted(ids)}"


# ── 已知缺陷：现在的规则做不到，如实记录 ─────────────────────────────────────


@pytest.mark.xfail(strict=False, reason="否定语境未处理：『不是全网最低价』仍会命中极限词")
def test_negated_absolute_claim_should_pass() -> None:
    codes = _codes(
        {
            "title": "纯棉短袖T恤 夏季薄款 32支精梳棉",
            "points": ["我们不是全网最低价，但性价比最高", "100%纯棉面料", "7天无理由退换"],
        }
    )
    assert "compliance.absolute" not in codes


@pytest.mark.xfail(strict=False, reason="词表外漏报：『性价比最高』不含词表里的任何极限词")
def test_implicit_superlative_should_flag() -> None:
    codes = _codes({"title": "纯棉T恤 性价比最高 买到就是赚到", "points": ["包邮发货"]})
    assert "compliance.absolute" in codes


@pytest.mark.xfail(strict=False, reason="暗示性功效漏报：不含功效词，但整体在暗示疗效")
def test_implied_efficacy_should_flag() -> None:
    codes = _codes(
        {
            "title": "灵芝孢子粉 帮助身体回到平衡状态",
            "points": ["每天两勺，让你慢慢好起来", "包装 200g，密封罐装"],
            "category": "food",
        }
    )
    assert "compliance.food.efficacy" in codes


@pytest.mark.xfail(strict=False, reason="医疗器械『缓解』类宣称不在词表：需按品类扩充，属漏报")
def test_medical_relief_claim_should_flag() -> None:
    codes = _codes(
        {"title": "颈椎按摩仪 缓解酸痛 热敷", "points": ["模拟人手揉捏"], "category": "medical"}
    )
    assert "compliance.medical.claim" in codes


@pytest.mark.xfail(strict=False, reason="拆字规避未处理：『最~好』『zui hao』这类变体检不出")
def test_obfuscated_superlative_should_flag() -> None:
    codes = _codes({"title": "全网zui低价 最~好用的保温杯", "points": ["包邮发货"]})
    assert "compliance.absolute" in codes
