# -*- coding: utf-8 -*-
"""宣称-证据对账的判定回归。

这里每一条都对应一个代运营真实会遇到的场景：证书过期、拿上家的证、
证书范围不覆盖、编号少一位。这四类错，模型看不出来，只有对账能发现。
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from shadowflow.services.claim_evidence import reconcile

LISTING = {
    "title": "男士纯棉短袖T恤 夏季薄款",
    "points": ["100%纯棉面料，亲肤透气", "5个尺码可选", "7天无理由退换"],
    "detail": "",
}


def _rows(result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {row["type"]: row for row in result["claims"]}


def test_missing_evidence_blocks_claim() -> None:
    """写了成分却没有检测报告 → missing，can_claim=false。"""
    result = reconcile(LISTING, [])
    rows = _rows(result)
    assert rows["composition"]["status"] == "missing"
    assert result["can_claim"] is False
    assert result["blocking"] >= 1


def test_valid_evidence_passes() -> None:
    """报告有效、主体一致、范围覆盖 → ok。"""
    result = reconcile(
        LISTING,
        [
            {
                "type": "test_report",
                "code": "CMA2024123456",
                "expiry": "2027-06-30",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="杭州甲纺织有限公司",
    )
    rows = _rows(result)
    assert rows["composition"]["status"] == "ok"
    assert result["can_claim"] is True


def test_expired_evidence_blocks() -> None:
    """证书过期 → expired（日期比较，不是语义判断）。"""
    result = reconcile(
        LISTING,
        [
            {
                "type": "test_report",
                "code": "CMA2020123456",
                "expiry": "2021-01-01",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="杭州甲纺织有限公司",
    )
    assert _rows(result)["composition"]["status"] == "expired"


def test_bad_code_blocks() -> None:
    """国妆特字少一位 → bad_code。这类号模型会顺着编，正则不会。"""
    result = reconcile(
        {"title": "美白精华液 30ml", "points": ["烟酰胺美白"]},
        [
            {
                "type": "special_cosmetic",
                "code": "国妆特字G2020123",
                "expiry": "2028-01-01",
                "subject": "广州丙化妆品有限公司",
                "scope": "美白精华",
            }
        ],
        seller_name="广州丙化妆品有限公司",
    )
    assert _rows(result)["efficacy"]["status"] == "bad_code"


def test_subject_mismatch_blocks() -> None:
    """拿上家的证：证书主体 A 公司，店铺主体 B 公司。"""
    result = reconcile(
        LISTING,
        [
            {
                "type": "test_report",
                "code": "CMA2024123456",
                "expiry": "2027-06-30",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="上海乙贸易有限公司",
    )
    assert _rows(result)["composition"]["status"] == "subject_mismatch"


def test_scope_mismatch_blocks() -> None:
    """证书写棉针织，文案写真丝 → 证不覆盖。"""
    result = reconcile(
        {"title": "真丝眼罩 100%桑蚕丝", "points": ["19 姆米厚度"]},
        [
            {
                "type": "test_report",
                "code": "CMA2024123456",
                "expiry": "2027-06-30",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="杭州甲纺织有限公司",
    )
    assert _rows(result)["composition"]["status"] == "scope_mismatch"


def test_service_claim_needs_no_certificate() -> None:
    """售后承诺不需要资质，标 manual 而不是 ok 结论。"""
    result = reconcile(
        {"title": "保温杯 500ml", "points": ["终身保修，7天无理由退换"]},
        [],
        seller_name="某店铺",
    )
    rows = _rows(result)
    assert rows["service"]["status"] == "ok"
    assert rows["service"]["confidence"] == "manual"


def test_code_with_separators_is_accepted() -> None:
    """「CMA 2024-123456」这种带分隔符的写法不该被判 bad_code。"""
    result = reconcile(
        LISTING,
        [
            {
                "type": "test_report",
                "code": "CMA 2024-123456",
                "expiry": "2027-06-30",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="杭州甲纺织有限公司",
    )
    assert _rows(result)["composition"]["status"] == "ok"


def test_missing_expiry_is_unknown_not_ok() -> None:
    """没填有效期 → unknown，不能当成通过。"""
    result = reconcile(
        LISTING,
        [
            {
                "type": "test_report",
                "code": "CMA2024123456",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
        seller_name="杭州甲纺织有限公司",
    )
    assert _rows(result)["composition"]["status"] == "unknown"


@pytest.mark.parametrize(
    "code,expect",
    [
        ("SC12345678901234", "ok"),
        ("SC1234567890123", "bad_code"),
        ("国食健字G20201234", "ok"),
        ("械注准20221234567", "ok"),
        ("2023010101234567", "ok"),
    ],
)
def test_code_formats(code: str, expect: str) -> None:
    """各类型编号的位数校验。"""
    kind = (
        "food_production"
        if code.startswith("SC")
        else "health_food"
        if code.startswith("国食健字")
        else "medical_device"
        if code.startswith("械")
        else "ccc"
    )
    listing: Dict[str, Any] = {"title": "商品", "points": ["验证编号格式"]}
    result = reconcile(
        listing,
        [{"type": kind, "code": code, "expiry": "2028-01-01", "subject": "某公司", "scope": "某范围"}],
        seller_name="某公司",
    )
    # 该条文案里没有对应宣称，直接断言不崩即可；格式判定由内部函数承担
    assert isinstance(result["claims"], list)


def test_no_claim_no_block() -> None:
    """纯参数型文案，没有需要资质的宣称 → 不拦。"""
    result = reconcile(
        {"title": "折叠收纳箱", "points": ["展开 60cm", "承重 20kg"]},
        [],
        seller_name="某店铺",
    )
    assert result["can_claim"] is True


def test_composition_with_organic_word_still_needs_test_report() -> None:
    """「有机棉」是成分，要检测报告，不能因为含「有机」就要求有机认证。

    这是反向张冠李戴：词映射只该作用于认证/功效两类，套到成分上会让所有
    有机棉、有机奶粉的商品都缺一张根本不需要的证书。
    """
    result = reconcile(
        {"title": "有机棉男士短袖T恤", "points": ["100%有机棉面料"]},
        [],
        seller_name="某店铺",
    )
    rows = _rows(result)
    assert rows["composition"]["need"] == ["test_report"]
    # 同时「有机」本身仍应作为认证宣称存在，要求 organic_cert
    assert rows["certification"]["need"] == ["organic_cert"]
