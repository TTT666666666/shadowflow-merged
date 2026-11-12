"""商品页诊断引擎与 API 测试（规则引擎，无 mock、无模型依赖）。"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from shadowflow.services.listing_doctor import analyze

from shadowflow.server import app

client = TestClient(app)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _chdir_to_repo_root(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)


GOOD = {
    "title": "手工钩织小兔｜18cm 树脂填充｜送礼不掉毛",
    "points": [
        "手工钩织工艺，柔软不扎手，适合送生日礼物",
        "填充饱满不掉毛，水洗后不变形，耐用",
        "约 18cm 巴掌大小，桌上不占地方，方便",
    ],
    "detail": (
        "材质：牛奶棉线 + 环保树脂。工艺：全手工钩织，每只约 3 小时。"
        "已做质检并可提供检测报告。7 天无理由退换，破损包补发。"
        "当天 16 点前下单当天发货，顺丰包邮。原价 59，到手价 39。"
        "买两件送贺卡。微信联系客服可定制颜色。"
    ),
    "price_cents": 3900,
}

BAD = {
    "title": "小兔子",
    "points": ["很好看"],
    "detail": "全网最低价，赶紧买",
    "price_cents": 1990,
}


# --------------------------------------------------------------------------- 引擎


def test_good_listing_scores_high_and_is_listable():
    report = analyze(GOOD)
    assert report["engine"] == "rules"
    assert report["score"]["total"] >= 85
    assert report["score"]["grade"] == "excellent"
    assert report["gates"]["can_list"] is True
    assert report["counts"]["high"] == 0


def test_bad_listing_flags_structure_trust_and_compliance():
    report = analyze(BAD)
    ids = {item["id"] for item in report["issues"]}
    assert "title.too_short" in ids
    assert "points.few" in ids
    assert "trust.no_proof" in ids
    assert "compliance.absolute" in ids


def test_compliance_hit_caps_score_and_blocks_listing():
    report = analyze(BAD)
    assert report["gates"]["can_list"] is False
    assert report["gates"]["blocked_by"] == ["compliance.absolute"]
    assert report["gates"]["score_cap"] == 59
    # 封顶是硬门禁：即便其他维度满分也不许越过 59
    assert report["score"]["total"] <= 59
    assert report["score"]["grade"] in ("needs_work", "risky")


def test_flags_override_auto_detection():
    """用户勾了「已有检测报告」，就不该再判 trust.no_proof —— 勾选优先于词表。"""
    payload = dict(BAD, flags={"proof": True})
    ids = {item["id"] for item in analyze(payload)["issues"]}
    assert "trust.no_proof" not in ids


def test_flags_false_also_wins():
    """反过来：文案里提到了「包邮」，但用户说没有发货信息 → 以用户为准。"""
    payload = dict(GOOD, flags={"shipping": False})
    ids = {item["id"] for item in analyze(payload)["issues"]}
    assert "trust.no_shipping" in ids


def test_title_plan_is_fill_in_the_blank_not_ghostwriting():
    report = analyze({"title": "手工钩织小兔", "points": []})
    plans = report["titles"]
    assert len(plans) == 3
    # 只拼用户自己写过的词：品名进来，规格/信任状没写过就报 missing
    assert any("手工钩织小兔" in p["text"] for p in plans)
    missing = {m for p in plans for m in p["missing"]}
    assert "spec" in missing
    assert "trust" in missing
    # 空位在 parts 里是 value="" 的段，界面上渲染成占位块；三种骨架因此不会撞成一句
    assert all(len(p["parts"]) == 3 or len(p["parts"]) == 4 for p in plans)
    empties = [[part["slot"] for part in p["parts"] if not part["value"]] for p in plans]
    assert all(empties), "骨架里应当至少有一个待填空位"
    assert len({tuple(e) for e in empties}) > 1, "三种骨架的空位组合不能完全相同"


def test_plan_lists_what_to_fill_for_weak_points():
    report = analyze({"title": "手工钩织小兔 18cm 送礼", "points": ["纯棉线", "18cm"]})
    needs = {item["needs"] for item in report["plan"]["bullets"]}
    assert needs == {"benefit"}
    assert "proof" in report["plan"]["faq"]


def test_analysis_is_deterministic():
    assert analyze(GOOD) == analyze(GOOD)


def test_points_accept_newline_text():
    report = analyze(
        {
            "title": "手工钩织小兔 18cm 送礼",
            "points": "1. 手工钩织，适合送礼\n2. 不掉毛，耐用\n3. 18cm，方便摆桌面",
        }
    )
    assert report["plan"]["bullets"] == []
    assert "points.few" not in {i["id"] for i in report["issues"]}


def test_enhance_failure_does_not_break_rules():
    def boom(_payload, _report):
        raise RuntimeError("model down")

    report = analyze(GOOD, enhance=boom)
    assert report["engine"] == "rules"  # 增强失败回落纯规则
    assert "model down" in report["enhance_error"]
    assert report["score"]["total"] >= 85


# --------------------------------------------------------------------------- API


@pytest.fixture()
def reports_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SHADOWFLOW_TEARDOWN_DIR", str(tmp_path / "teardown"))
    return tmp_path / "teardown"


def test_api_analyze_persists_and_lists(reports_dir):
    res = client.post("/api/teardown/analyze", json=GOOD)
    assert res.status_code == 200
    body = res.json()
    report_id = body["report_id"]
    assert report_id.startswith("td-")
    assert body["report"]["score"]["total"] >= 85

    saved = json.loads((reports_dir / f"{report_id}.json").read_text(encoding="utf-8"))
    assert saved["input"]["title"] == GOOD["title"]

    listed = client.get("/api/teardown/reports").json()
    assert listed["total"] == 1
    assert listed["items"][0]["report_id"] == report_id

    detail = client.get(f"/api/teardown/reports/{report_id}").json()
    assert detail["report"]["version"] == 1


def test_api_rejects_empty_payload(reports_dir):
    res = client.post("/api/teardown/analyze", json={"title": "", "points": []})
    assert res.status_code == 422


def test_api_rejects_negative_price(reports_dir):
    res = client.post("/api/teardown/analyze", json=dict(GOOD, price_cents=-1))
    assert res.status_code == 422


def test_api_unknown_report_404(reports_dir):
    assert client.get("/api/teardown/reports/td-doesnotexist").status_code == 404


def test_api_rules_endpoint_exposes_thresholds(reports_dir):
    body = client.get("/api/teardown/rules").json()
    assert body["score_cap"] == 59
    assert [d["key"] for d in body["dimensions"]] == [
        "title",
        "points",
        "trust",
        "pricing",
        "conversion",
        "compliance",
    ]
    assert body["thresholds"]["title"] == [12, 60]
