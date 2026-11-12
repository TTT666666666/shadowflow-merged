"""改前 / 改后对比测试。

单次诊断回答「现在怎么样」，对比回答「你改完之后好了多少」——后者才是
代运营拿去给甲方交差的证据，也是唯一的复购钩子。所以这里锁三件事：

1. 改善必须算对：分数涨、问题被划进 resolved、门禁从不可上架变可上架；
2. 改坏了也要如实说：新增问题进 regressed，不能只报喜；
3. 两份文案都没改时，delta 必须为 0（否则这套数字没人信）。
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from shadowflow.server import app

client = TestClient(app)
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _chdir_to_repo_root(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)


@pytest.fixture()
def reports_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SHADOWFLOW_TEARDOWN_DIR", str(tmp_path / "teardown"))
    return tmp_path / "teardown"


BAD = {
    "title": "小兔子玩偶",
    "points": ["很可爱的兔子", "纯手工做的好东西", "买就送"],
    "detail": "自己做的，质量很好，全网最低价，错过就没了。",
    "price_cents": 3900,
}

GOOD = {
    "title": "手工钩织小兔 18cm 牛奶棉线 送礼盒装",
    "points": [
        "钩织工艺，柔软不扎手，抱着睡也不硌人",
        "填充饱满不掉毛，水洗后不变形",
        "附赠礼盒与贺卡，送人不用再包装",
        "已做质检，可提供检测报告",
    ],
    "detail": "材质：牛奶棉线 + 树脂填充。附检测报告与实拍图。7 天无理由退换，破损补发。顺丰包邮。",
    "price_cents": 3900,
}


def _ids(items):
    return [i["id"] for i in items]


def _compare(before, after):
    res = client.post("/api/teardown/compare", json={"before": before, "after": after})
    assert res.status_code == 200, res.text
    return res.json()


# ── 改善 ──────────────────────────────────────────────────────────────────


def test_improvement_reports_positive_delta(reports_dir):
    data = _compare(BAD, GOOD)
    delta = data["delta"]
    assert delta["total"]["delta"] > 0
    assert delta["total"]["after"] > delta["total"]["before"]
    assert delta["grade"]["before"] != delta["grade"]["after"]
    assert data["before"]["report"]["gates"]["can_list"] is False


def test_resolved_and_remaining_are_disjoint(reports_dir):
    delta = _compare(BAD, GOOD)["delta"]
    resolved, remaining = _ids(delta["resolved"]), _ids(delta["remaining"])
    assert resolved, "改好了却没算出任何已解决问题"
    assert set(resolved) & set(remaining) == set()
    # 改进版不该凭空多出问题
    assert delta["regressed"] == []


def test_quality_fix_flips_the_gate(reports_dir):
    """合规红线被清掉后，门禁必须从 False 变 True。"""
    bad = dict(BAD, detail="自己做的，质量很好，全网最低价。")
    fixed = dict(
        BAD,
        title="手工钩织小兔 18cm 牛奶棉线",
        points=["钩织工艺，柔软不扎手", "填充饱满不掉毛", "附赠礼盒与贺卡", "已做质检"],
        detail="材质：牛奶棉线。附检测报告与实拍图。7 天无理由退换，破损补发。顺丰包邮。",
    )
    delta = _compare(bad, fixed)["delta"]
    assert delta["can_list"] == {"before": False, "after": True}
    assert "compliance.absolute" in _ids(delta["resolved"])


def test_dimension_deltas_are_present_for_every_dimension(reports_dir):
    delta = _compare(BAD, GOOD)["delta"]
    keys = [d["key"] for d in delta["dimensions"]]
    assert keys == ["title", "points", "trust", "pricing", "conversion", "compliance"]
    for item in delta["dimensions"]:
        assert isinstance(item["after"], int)
        assert item["delta"] == item["after"] - item["before"]


# ── 没改 / 改坏 ────────────────────────────────────────────────────────────


def test_same_input_yields_zero_delta(reports_dir):
    delta = _compare(BAD, BAD)["delta"]
    assert delta["total"]["delta"] == 0
    assert delta["resolved"] == []
    assert delta["regressed"] == []
    assert delta["remaining"]  # 原样不动时，问题全部遗留


def test_regression_is_reported_not_hidden(reports_dir):
    """把合规文案加回去，必须进 regressed——只报喜的报告没人敢用。"""
    worse = dict(
        GOOD,
        detail=GOOD["detail"] + "全网最低价，国家级认证，100% 有效。",
    )
    delta = _compare(GOOD, worse)["delta"]
    assert delta["total"]["delta"] < 0
    assert "compliance.absolute" in _ids(delta["regressed"])
    assert delta["can_list"] == {"before": True, "after": False}


# ── 参数校验 ───────────────────────────────────────────────────────────────


def test_missing_side_is_rejected(reports_dir):
    assert client.post("/api/teardown/compare", json={"before": BAD}).status_code == 422
    assert client.post("/api/teardown/compare", json={"after": BAD}).status_code == 422
    assert client.post("/api/teardown/compare", json={"before": "x", "after": BAD}).status_code == 422


def test_compare_saved_reports_by_id(reports_dir):
    b = client.post("/api/teardown/analyze", json=BAD).json()["report_id"]
    a = client.post("/api/teardown/analyze", json=GOOD).json()["report_id"]
    res = client.get(f"/api/teardown/compare?before={b}&after={a}")
    assert res.status_code == 200, res.text
    delta = res.json()["delta"]
    assert delta["total"]["delta"] > 0
    assert delta["resolved"]


def test_compare_saved_unknown_id_is_404(reports_dir):
    b = client.post("/api/teardown/analyze", json=BAD).json()["report_id"]
    assert client.get(f"/api/teardown/compare?before={b}&after=td-nope").status_code == 404


def test_saved_input_keeps_deciding_params(reports_dir):
    """落盘要留下判定口径，否则「按上次参数重跑」会跑成另一套规则。"""
    rid = client.post(
        "/api/teardown/analyze", json=dict(GOOD, category="food", platform="amazon")
    ).json()["report_id"]
    saved = client.get(f"/api/teardown/reports/{rid}").json()
    assert saved["input"]["category"] == "food"
    assert saved["input"]["platform"] == "amazon"
