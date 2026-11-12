"""批量诊断 API 测试：CSV 导入、逐条口径一致、脏行隔离、白标导出。"""

from __future__ import annotations

import json
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

WEAK = {"title": "小兔子", "points": ["很好看"], "detail": "", "price_cents": 1990}

CSV_TWO = (
    "标题,卖点,详情,价格,已有素材\n"
    "手工钩织小兔｜18cm 树脂填充｜送礼不掉毛,"
    "手工钩织工艺，柔软不扎手，适合送生日礼物|填充饱满不掉毛，水洗后不变形，耐用,"
    "材质：牛奶棉线。已做质检并可提供检测报告。7 天无理由退换。顺丰包邮。,39,material|proof\n"
    "小兔子,很好看,,19.9,\n"
)


# --------------------------------------------------------------------------- 批量主流程


def test_batch_csv_creates_one_report_per_row(reports_dir):
    res = client.post(
        "/api/teardown/batch",
        json={"csv": CSV_TWO, "label": "双十一上架前自检", "brand": "某某代运营"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["batch_id"].startswith("tb-")
    assert body["label"] == "双十一上架前自检"
    assert body["summary"] == {
        "total": 2,
        "ok": 2,
        "failed": 0,
        "avg_total": body["summary"]["avg_total"],
        "blocked": body["summary"]["blocked"],
        "high": body["summary"]["high"],
    }
    assert isinstance(body["summary"]["avg_total"], (int, float))
    assert len(body["items"]) == 2
    assert all(item["ok"] for item in body["items"])
    assert all(item["report_id"].startswith("td-") for item in body["items"])

    # 每条都落了独立报告，且带批次归属 —— 前端可以复用单条详情接口
    for item in body["items"]:
        saved = json.loads((reports_dir / f"{item['report_id']}.json").read_text(encoding="utf-8"))
        assert saved["batch_id"] == body["batch_id"]
        assert saved["source"] == "batch"
        assert saved["report"]["score"]["total"] == item["total"]

    batch_file = reports_dir / "batches" / f"{body['batch_id']}.json"
    assert batch_file.exists()


def test_batch_uses_exactly_the_same_verdict_as_single_analysis(reports_dir):
    """批量不能长出口径分叉：同一份输入，单条和批量必须给同一个分。"""
    single = client.post("/api/teardown/analyze", json=GOOD).json()["report"]
    batch = client.post("/api/teardown/batch", json={"items": [GOOD]}).json()
    item = batch["items"][0]
    detail = client.get(f"/api/teardown/reports/{item['report_id']}").json()["report"]
    assert detail["score"]["total"] == single["score"]["total"]
    assert [i["id"] for i in detail["issues"]] == [i["id"] for i in single["issues"]]
    assert detail["gates"] == single["gates"]


def test_csv_aliases_price_conversion_and_cell_splitting(reports_dir):
    body = client.post("/api/teardown/batch", json={"csv": CSV_TWO}).json()
    first = client.get(f"/api/teardown/reports/{body['items'][0]['report_id']}").json()
    assert first["input"]["price_cents"] == 3900  # 39 元 → 3900 分
    assert first["input"]["points"] == [
        "手工钩织工艺，柔软不扎手，适合送生日礼物",
        "填充饱满不掉毛，水洗后不变形，耐用",
    ]
    assert first["input"]["flags"] == {"material": True, "proof": True}
    second = client.get(f"/api/teardown/reports/{body['items'][1]['report_id']}").json()
    assert second["input"]["price_cents"] == 1990  # 19.9 元


def test_csv_bom_and_english_headers(reports_dir):
    csv_text = (
        "\ufefftitle,points,detail,price,flags\n"
        "手工钩织小兔 18cm 送礼,柔软不掉毛|适合送礼,,39.9,material\n"
    )
    body = client.post("/api/teardown/batch", json={"csv": csv_text}).json()
    assert body["summary"]["ok"] == 1
    first = client.get(f"/api/teardown/reports/{body['items'][0]['report_id']}").json()
    assert first["input"]["price_cents"] == 3990


# --------------------------------------------------------------------------- 脏数据与边界


def test_bad_row_is_recorded_but_other_rows_survive(reports_dir):
    body = client.post(
        "/api/teardown/batch",
        json={
            "items": [
                GOOD,
                {"title": "x" * 400, "points": []},  # 标题超长 → 422
                {"title": "", "points": []},  # 空 → 422
            ]
        },
    ).json()
    assert body["summary"]["total"] == 3
    assert body["summary"]["ok"] == 1
    assert body["summary"]["failed"] == 2
    assert body["items"][0]["ok"] is True
    assert all("error" in body["items"][i] for i in (1, 2))


def test_batch_rejects_empty_and_oversized(reports_dir):
    assert client.post("/api/teardown/batch", json={"csv": "标题,卖点\n"}).status_code == 422
    assert client.post("/api/teardown/batch", json={"items": []}).status_code == 422
    too_many = [{"title": f"商品 {i}", "points": ["好用"]} for i in range(51)]
    assert client.post("/api/teardown/batch", json={"items": too_many}).status_code == 422
    assert client.post("/api/teardown/batch", json={}).status_code == 422


def test_csv_requires_title_column(reports_dir):
    res = client.post("/api/teardown/batch", json={"csv": "卖点,详情\n好用,不错\n"})
    assert res.status_code == 422


def test_invalid_price_cell_is_ignored_not_fatal(reports_dir):
    body = client.post(
        "/api/teardown/batch", json={"csv": "标题,卖点,价格\n小兔子 18cm,很好看,面议\n"}
    ).json()
    assert body["summary"]["ok"] == 1
    first = client.get(f"/api/teardown/reports/{body['items'][0]['report_id']}").json()
    assert first["input"]["price_cents"] is None


# --------------------------------------------------------------------------- 历史与导出


def test_batches_list_get_and_404(reports_dir):
    created = client.post("/api/teardown/batch", json={"csv": CSV_TWO, "label": "批次 A"}).json()
    listed = client.get("/api/teardown/batches").json()
    assert listed["total"] == 1
    assert listed["items"][0]["batch_id"] == created["batch_id"]
    assert listed["items"][0]["label"] == "批次 A"
    got = client.get(f"/api/teardown/batches/{created['batch_id']}").json()
    assert got["items"] == created["items"]
    assert client.get("/api/teardown/batches/tb-nope").status_code == 404
    assert client.get("/api/teardown/batches/tb-nope/export").status_code == 404


def test_export_csv_has_brand_header_bom_and_rows(reports_dir):
    created = client.post(
        "/api/teardown/batch", json={"csv": CSV_TWO, "brand": "星火工作室"}
    ).json()
    res = client.get(f"/api/teardown/batches/{created['batch_id']}/export?format=csv")
    assert res.status_code == 200
    assert res.content.startswith(b"\xef\xbb\xbf")
    text = res.content.decode("utf-8-sig")
    lines = text.splitlines()
    assert lines[0] == "# 星火工作室 · Listing Doctor"
    assert "商品标题" in lines[1]
    assert "能否上架" in lines[1]
    assert len(lines) == 4  # 品牌抬头 + 表头 + 2 行数据


def test_export_en_header_is_english(reports_dir):
    created = client.post("/api/teardown/batch", json={"csv": CSV_TWO}).json()
    text = client.get(
        f"/api/teardown/batches/{created['batch_id']}/export?format=csv&lang=en"
    ).content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Row,Title,Platform,Score")
    assert "商品标题" not in text


def test_export_json_returns_full_record(reports_dir):
    created = client.post("/api/teardown/batch", json={"csv": CSV_TWO}).json()
    got = client.get(f"/api/teardown/batches/{created['batch_id']}/export?format=json").json()
    assert got["batch_id"] == created["batch_id"]
    assert got["items"] == created["items"]


def test_reports_list_is_not_broken_by_batch_subdir(reports_dir):
    """batches/ 子目录不能混进 /reports 的 glob 结果。"""
    client.post("/api/teardown/batch", json={"csv": CSV_TWO})
    listed = client.get("/api/teardown/reports").json()
    assert listed["total"] == 2
    assert all(item["report_id"].startswith("td-") for item in listed["items"])
