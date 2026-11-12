"""类目专属合规词库测试：食品/美妆/母婴/器械，以及「不误判」的边界。"""

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


def _analyze(**payload):
    body = {
        "title": payload.pop("title", "坚果礼盒 500g 独立小包装"),
        "points": payload.pop("points", ["每日一袋，独立包装，办公室常备"]),
        "detail": payload.pop("detail", "配料：核桃仁、腰果。净含量 500g。"),
    }
    body.update(payload)
    res = client.post("/api/teardown/analyze", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(report):
    return [i["id"] for i in report["report"]["issues"]]


# ── 正向：类目词必须抓到，并且是硬门禁 ─────────────────────────────────────


def test_food_efficacy_blocks_listing(reports_dir):
    rep = _analyze(category="food", detail="常吃可以降血糖、降血脂，无副作用。")
    ids = _ids(rep)
    assert "compliance.food.efficacy" in ids
    assert rep["report"]["gates"]["can_list"] is False
    assert rep["report"]["score"]["total"] <= engine.COMPLIANCE_SCORE_CAP


def test_food_cert_claim_blocks_listing(reports_dir):
    rep = _analyze(category="food", detail="零添加、纯天然，孕妇可用。")
    assert "compliance.food.cert" in _ids(rep)
    assert rep["report"]["gates"]["can_list"] is False


def test_beauty_drug_wording_blocks_listing(reports_dir):
    rep = _analyze(
        category="beauty",
        title="修护面霜 50g",
        points=["医美后可用，医院同款"],
        detail="药妆级配方，敏感肌也能用。",
    )
    assert "compliance.beauty.drug" in _ids(rep)
    assert rep["report"]["gates"]["can_list"] is False


def test_beauty_whitening_needs_special_cert(reports_dir):
    rep = _analyze(category="beauty", title="美白精华 30ml", detail="七天祛斑，白一个度。")
    assert "compliance.beauty.whiten" in _ids(rep)


def test_baby_claim_blocks_listing(reports_dir):
    rep = _analyze(
        category="baby",
        title="婴儿积木玩具",
        points=["益智拼装，促进大脑发育"],
        detail="食品级材质，宝宝可以咬。",
    )
    assert "compliance.baby.claim" in _ids(rep)
    assert rep["report"]["gates"]["can_list"] is False


def test_medical_claim_blocks_listing(reports_dir):
    rep = _analyze(
        category="medical",
        title="家用血压计",
        detail="械字号产品，可辅助治疗高血压，替代药物。",
    )
    ids = _ids(rep)
    assert "compliance.medical.claim" in ids
    assert "compliance.medical.cert" in ids


# ── 边界：不误判、不重复、别名可用 ──────────────────────────────────────────


def test_general_word_not_duplicated_under_category(reports_dir):
    """「治疗」属通用功效词，食品类目下不应再出一张 food 卡。"""
    rep = _analyze(category="food", detail="可治疗失眠。")
    ids = _ids(rep)
    assert ids.count("compliance.efficacy") == 1
    assert "compliance.food.efficacy" not in ids


def test_category_rules_do_not_apply_without_category(reports_dir):
    """类目规则不能靠猜：玩具页写「降血糖」不该判成食品违规。"""
    rep = _analyze(
        category="baby",
        title="儿童积木",
        points=["大颗粒，适合三岁"],
        detail="降血糖的说法只是抄错了模板。",
    )
    assert "compliance.food.efficacy" not in _ids(rep)


def test_auto_detect_from_hints(reports_dir):
    """不指定类目时，出现明确品类词才自动启用（并标记 detected）。"""
    rep = _analyze(title="每日坚果礼盒", points=["独立小包装"], detail="常吃能降三高。")
    cat = rep["report"]["category"]
    assert cat["key"] == "food"
    assert cat["detected"] is True
    assert "compliance.food.efficacy" in _ids(rep)


def test_auto_detect_returns_none_for_unknown_listing(reports_dir):
    rep = _analyze(
        title="手工钩织小兔 18cm",
        points=["柔软不扎手"],
        detail="牛奶棉线，顺丰包邮。",
        category="",
    )
    assert rep["report"]["category"]["key"] is None


def test_chinese_category_alias_accepted(reports_dir):
    rep = _analyze(category="食品", detail="降血糖。")
    assert rep["report"]["category"]["key"] == "food"


def test_unknown_category_falls_back_to_auto(reports_dir):
    rep = _analyze(category="随便什么类目", title="手工钩织小兔")
    assert rep["report"]["category"]["key"] is None


# ── 批量：批次级类目要能下沉到每一行 ────────────────────────────────────────


def test_batch_inherits_batch_level_category(reports_dir):
    res = client.post(
        "/api/teardown/batch",
        json={
            "category": "food",
            "csv": "标题,详情\n坚果礼盒,常吃可以降血糖\n每日坚果,独立小包装\n",
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert [i["category"] for i in data["items"]] == ["food", "food"]
    assert data["items"][0]["can_list"] is False


def test_batch_row_category_overrides_batch_default(reports_dir):
    res = client.post(
        "/api/teardown/batch",
        json={
            "category": "food",
            "csv": "标题,详情,类目\n修护面霜,药妆级配方,美妆\n坚果礼盒,独立小包装,食品\n",
        },
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert items[0]["category"] == "beauty"
    assert items[1]["category"] == "food"


def test_rules_endpoint_exposes_categories():
    data = client.get("/api/teardown/rules").json()
    keys = [c["key"] for c in data["categories"]]
    assert keys == list(engine.CATEGORY_LABELS.keys())
    assert all(c["rules"] for c in data["categories"])
