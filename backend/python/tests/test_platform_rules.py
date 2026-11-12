"""平台规则测试：亚马逊 / TikTok Shop 的硬限制与政策违规。

核心断言不是「能抓到词」，而是三件事：
1. 不选平台（generic）时**一个平台问题都不该出现**——否则老报告口径会漂移；
2. 联系方式、无授权宣称属于会下架的政策违规，必须进合规门禁（can_list=False）；
3. 促销语言只扣分不拦——平台会抑制，但没到「不能卖」的程度。
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from shadowflow.server import app
from shadowflow.services import listing_doctor as engine

client = TestClient(app)
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _chdir_to_repo_root(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)


@pytest.fixture()
def reports_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SHADOWFLOW_TEARDOWN_DIR", str(tmp_path / "teardown"))
    return tmp_path / "teardown"


GOOD_TITLE = "Stainless Steel Insulated Bottle 500ml Leak Proof"


def _analyze(**payload):
    body = {
        "title": payload.pop("title", GOOD_TITLE),
        "points": payload.pop(
            "points",
            [
                "Keeps drinks cold for 24 hours",
                "18/8 stainless steel, BPA free",
                "Leak proof lid with carry loop",
            ],
        ),
        "detail": payload.pop("detail", "Material: 18/8 stainless steel. 500ml capacity."),
        "price_cents": payload.pop("price_cents", 2999),
    }
    body.update(payload)
    res = client.post("/api/teardown/analyze", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(report):
    return [i["id"] for i in report["report"]["issues"]]


# ── 默认不跑平台规则：口径不能漂移 ─────────────────────────────────────────


def test_generic_platform_adds_no_platform_issue():
    rep = _analyze(title="Best Seller Insulated Bottle 500ml", detail="www.myshop.com")
    assert rep["report"]["platform"]["key"] == "generic"
    assert not [i for i in _ids(rep) if i.startswith("platform.")]


def test_unknown_platform_falls_back_to_generic():
    rep = _analyze(platform="alibaba")
    assert rep["report"]["platform"]["key"] == "generic"


def test_platform_aliases_accepted(reports_dir):
    for raw in ("亚马逊", "Amazon", "amazon.com"):
        rep = _analyze(platform=raw)
        assert rep["report"]["platform"]["key"] == "amazon", raw
    assert _analyze(platform="TikTok Shop")["report"]["platform"]["key"] == "tiktok"


def test_platform_limits_exposed():
    rep = _analyze(platform="amazon")
    plat = rep["report"]["platform"]
    assert plat["title_max"] == 200
    assert plat["points_max"] == 5
    assert plat["bullet_max"] == 500


# ── 标题：长度 / emoji / 全大写 / 特殊符号 ─────────────────────────────────


def test_amazon_title_over_200_chars():
    long_title = "InsulatedBottle500mlStainless " * 8  # ~240 字符（去空格后仍超 200）
    rep = _analyze(title=long_title, platform="amazon")
    issue = next(i for i in rep["report"]["issues"] if i["id"] == "platform.title.too_long")
    assert issue["params"]["max"] == 200
    assert issue["params"]["length"] > 200
    assert issue["dim"] == "title"


def test_tiktok_title_limit_is_looser_than_amazon():
    # ~240 字符：亚马逊超（200），TikTok 不超（255）
    title = "InsulatedBottle500mlStainless " * 8
    assert "platform.title.too_long" in _ids(_analyze(title=title, platform="amazon"))
    assert "platform.title.too_long" not in _ids(_analyze(title=title, platform="tiktok"))


def test_emoji_in_title_flagged_on_both_platforms():
    for plat in ("amazon", "tiktok"):
        rep = _analyze(title="Insulated Bottle 500ml 🔥 Hot", platform=plat)
        assert "platform.title.emoji" in _ids(rep), plat


def test_all_caps_only_checked_on_amazon():
    rep = _analyze(title="STAINLESS Bottle 500ml", platform="amazon")
    assert "platform.title.caps" in _ids(rep)
    # TikTok 不查全大写（规则里没有这条），避免误判
    assert "platform.title.caps" not in _ids(_analyze(title="STAINLESS Bottle 500ml", platform="tiktok"))


def test_amazon_special_symbols():
    rep = _analyze(title="Insulated Bottle 500ml ~ Best^Deal|", platform="amazon")
    assert "platform.title.symbols" in _ids(rep)


# ── 卖点：条数与单条长度 ───────────────────────────────────────────────────


def test_amazon_six_bullets_is_too_many():
    points = [f"Feature number {n} keeps drinks cold" for n in range(1, 7)]
    rep = _analyze(points=points, platform="amazon")
    issue = next(i for i in rep["report"]["issues"] if i["id"] == "platform.bullets.too_many")
    assert issue["params"]["count"] == 6
    assert issue["params"]["max"] == 5
    # 国内口径允许 8 条，不该报
    assert "platform.bullets.too_many" not in _ids(_analyze(points=points, platform="generic"))


def test_amazon_bullet_over_500_chars():
    long_point = "Keeps drinks cold for 24 hours " * 20
    rep = _analyze(points=[long_point, "BPA free", "Leak proof lid"], platform="amazon")
    issue = next(i for i in rep["report"]["issues"] if i["id"] == "platform.bullets.too_long")
    assert issue["params"]["max"] == 500
    assert issue["params"]["row"] == 1


# ── 政策违规：进合规门禁 ───────────────────────────────────────────────────


def test_contact_info_blocks_listing():
    rep = _analyze(platform="amazon", detail="Material: steel. Contact shop@example.com")
    issue = next(i for i in rep["report"]["issues"] if i["id"] == "platform.contact")
    assert issue["params"]["kind"] == "email"
    assert issue["severity"] == "high"
    assert rep["report"]["gates"]["can_list"] is False
    assert "platform.contact" in rep["report"]["gates"]["blocked_by"]


def test_url_and_phone_detected_as_contact():
    url_rep = _analyze(platform="amazon", detail="See www.example.com for size chart.")
    assert next(i for i in url_rep["report"]["issues"] if i["id"] == "platform.contact")["params"]["kind"] == "url"

    phone_rep = _analyze(platform="tiktok", detail="客服电话 13812345678")
    assert next(i for i in phone_rep["report"]["issues"] if i["id"] == "platform.contact")["params"]["kind"] == "phone"


def test_unauthorized_claim_blocks_listing():
    rep = _analyze(platform="amazon", detail="FDA approved material, clinically proven to prevent mold.")
    ids = _ids(rep)
    assert "platform.claim" in ids
    assert rep["report"]["gates"]["can_list"] is False


def test_promo_word_only_deducts_without_blocking():
    rep = _analyze(platform="amazon", title="Insulated Bottle 500ml Best Seller", points=[
        "Keeps drinks cold 24h", "18/8 steel", "Leak proof lid",
    ])
    issue = next(i for i in rep["report"]["issues"] if i["id"] == "platform.promo")
    assert issue["severity"] == "medium"
    assert issue["dim"] == "compliance"
    # 卖点/售后齐全时不该仅因促销词被拦
    assert rep["report"]["gates"]["can_list"] is True


def test_promo_word_boundary_avoids_false_positive():
    """wholesale 里含 sale，不该被判促销语言。"""
    rep = _analyze(platform="amazon", detail="Wholesale enquiries welcome. Material: steel.")
    assert "platform.promo" not in _ids(rep)


def test_english_listing_elements_are_recognised():
    """英文写了材质/检测/售后/发货/CTA，不能因为词表只有中文就判「没写」。

    这是实测出来的坑：第一版只补了平台规则，结果一份完全合格的英文 listing
    被判「信任状致命 ×2、转化路径致命 ×1」，分数掉到 60 以下——报告立刻不可信。
    """
    rep = _analyze(
        platform="amazon",
        title="Stainless Steel Insulated Bottle 500ml Leak Proof",
        points=[
            "Keeps drinks cold for 24 hours with double wall vacuum insulation",
            "18/8 stainless steel material, BPA free and food grade safe",
            "Leak proof lid with carry loop for gym and office",
        ],
        detail="Tested and certified by SGS. 30-day return and refund. Ships within 24 hours. Add to cart today.",
    )
    ids = _ids(rep)
    for code in ("trust.no_material", "trust.no_proof", "trust.no_after_sale", "trust.no_shipping"):
        assert code not in ids, code
    assert "cta.missing" not in ids
    assert rep["report"]["score"]["total"] >= 85


def test_platform_rules_do_not_contradict_conversion_rules():
    """跨境平台禁止联系方式时，不该同时提示「补联系方式」。"""
    rep = _analyze(platform="amazon", detail="Material: steel. 500ml.")
    assert "cta.no_contact" not in _ids(rep)
    # 国内口径仍然要求联系方式，证明这条只对平台生效
    assert "cta.no_contact" in _ids(_analyze(platform="generic", detail="材质：不锈钢。500ml。"))


def test_clean_amazon_listing_has_no_platform_issue():
    rep = _analyze(platform="amazon")
    assert not [i for i in _ids(rep) if i.startswith("platform.")]


# ── 批量：批次级平台下沉，CSV 列优先 ───────────────────────────────────────


BATCH_CSV = """标题,卖点,详情,价格,平台,类目
Insulated Bottle 500ml Steel,Keeps cold 24h|18/8 steel|Leak proof lid,Material: steel. 500ml.,29.99,amazon,
Insulated Bottle 500ml Steel,Keeps cold 24h|18/8 steel|Leak proof lid,Contact: a@b.com,29.99,,
"""


def test_batch_platform_from_csv_column_and_default(reports_dir):
    res = client.post("/api/teardown/batch", json={"csv": BATCH_CSV, "platform": "tiktok"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert [i["platform"] for i in data["items"]] == ["amazon", "tiktok"]
    assert data["items"][0]["ok"] and data["items"][1]["ok"]


def test_batch_platform_export_has_column(reports_dir):
    batch = client.post("/api/teardown/batch", json={"csv": BATCH_CSV}).json()
    res = client.get(f"/api/teardown/batches/{batch['batch_id']}/export?format=csv&lang=en")
    assert res.status_code == 200
    assert "Platform" in res.text.splitlines()[0]


# ── 自证：规则接口暴露平台与限制值 ─────────────────────────────────────────


def test_rules_endpoint_lists_platforms():
    data = client.get("/api/teardown/rules").json()
    keys = [p["key"] for p in data["platforms"]]
    assert keys == ["generic", "amazon", "tiktok"]
    amazon = next(p for p in data["platforms"] if p["key"] == "amazon")
    assert (amazon["title_max"], amazon["points_max"], amazon["bullet_max"]) == (200, 5, 500)
