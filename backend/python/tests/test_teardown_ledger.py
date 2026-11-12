# -*- coding: utf-8 -*-
"""宣称-证据对账 API 测试：入参校验、字段容错、响应契约。"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from shadowflow.server import app

client = TestClient(app)
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]

LEDGER = "/api/teardown/ledger"


@pytest.fixture(autouse=True)
def _chdir_to_repo_root(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)


LISTING = {
    "title": "男士纯棉短袖T恤 夏季薄款",
    "points": ["100%纯棉面料，亲肤透气", "7天无理由退换"],
    "seller_name": "杭州甲纺织有限公司",
}


def test_no_evidence_marks_missing() -> None:
    resp = client.post(LEDGER, json=LISTING)
    assert resp.status_code == 200
    data = resp.json()
    assert data["can_claim"] is False
    assert data["counts"]["missing"] >= 1
    assert data["evidence_types"], "响应必须带证据类型清单，前端下拉不能硬编码"


def test_valid_evidence_passes() -> None:
    body = {
        **LISTING,
        "evidences": [
            {
                "type": "test_report",
                "code": "CMA2024123456",
                "expiry": "2027-06-30",
                "subject": "杭州甲纺织有限公司",
                "scope": "棉针织面料",
            }
        ],
    }
    resp = client.post(LEDGER, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["can_claim"] is True
    assert data["counts"]["ok"] >= 1


def test_unknown_evidence_type_rejected() -> None:
    body = {**LISTING, "evidences": [{"type": "made_up", "code": "X"}]}
    resp = client.post(LEDGER, json=body)
    assert resp.status_code == 422
    assert "unknown" not in resp.text or "类型未知" in resp.text


def test_too_many_evidences_rejected() -> None:
    body = {
        **LISTING,
        "evidences": [{"type": "authorization", "code": f"A{i}"} for i in range(201)],
    }
    resp = client.post(LEDGER, json=body)
    assert resp.status_code == 422


def test_points_accepts_plain_string() -> None:
    """卖点传成字符串（分号/换行分隔）也要能解析，不能只认数组。"""
    body = {
        "title": "男士纯棉短袖T恤 夏季薄款",
        "points": "100%纯棉面料；7天无理由退换",
        "seller_name": "杭州甲纺织有限公司",
    }
    resp = client.post(LEDGER, json=body)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1


def test_response_has_no_chinese_sentences() -> None:
    """契约：判定结果只回码，中文句子在前端。"""
    resp = client.post(LEDGER, json=LISTING)
    data = resp.json()
    for row in data["claims"]:
        assert row["status"] in {
            "ok",
            "missing",
            "expired",
            "bad_code",
            "subject_mismatch",
            "scope_mismatch",
            "unknown",
        }
