"""商品页诊断 API（/api/teardown）。

职责边界：只做「收参数 → 调引擎 → 落盘 → 回读」，判定逻辑全在
``shadowflow.services.listing_doctor`` 里（纯函数、可单测）。
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from fastapi import APIRouter, Body, HTTPException, Query

from shadowflow.services.listing_doctor import analyze

router = APIRouter(prefix="/api/teardown", tags=["teardown"])

# 与 .shadowflow 下其他运行期数据同源；目录在调用时解析（环境变量可覆盖），
# 这样测试能在 import 之后把落盘位置指到临时目录，不污染仓库。
_REPORTS_DIR_ENV = "SHADOWFLOW_TEARDOWN_DIR"
_DEFAULT_REPORTS_DIR = ".shadowflow/teardown"


def _reports_dir() -> Path:
    return Path(os.getenv(_REPORTS_DIR_ENV) or _DEFAULT_REPORTS_DIR)

MAX_TITLE = 200
MAX_FIELD = 8000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_field(value: Any, limit: int = MAX_FIELD) -> str:
    if value is None:
        return ""
    text = str(value)
    if len(text) > limit:
        raise HTTPException(422, f"字段过长（上限 {limit} 字符）")
    return text


def _norm_payload(raw: Mapping[str, Any]) -> Dict[str, Any]:
    """把请求体收成引擎认识的形状，顺手做长度与类型校验。"""
    title = _clean_field(raw.get("title"), MAX_TITLE)

    points_raw = raw.get("points")
    if isinstance(points_raw, (list, tuple)):
        points = [_clean_field(p, 400) for p in points_raw if str(p or "").strip()][:20]
    else:
        points = _clean_field(points_raw)

    price = raw.get("price_cents")
    price_cents: Optional[int]
    if price is None or price == "":
        price_cents = None
    else:
        try:
            price_cents = int(price)
        except (TypeError, ValueError):
            raise HTTPException(422, "price_cents 需为整数（单位：分）") from None
        if price_cents < 0:
            raise HTTPException(422, "price_cents 不能为负")

    flags_raw = raw.get("flags")
    flags: Dict[str, bool] = {}
    if isinstance(flags_raw, Mapping):
        for key, value in flags_raw.items():
            if isinstance(value, bool):
                flags[str(key)] = value

    if not title and not points:
        raise HTTPException(422, "至少需要「标题」或「卖点」其中一项才能诊断")

    return {
        "title": title,
        "points": points,
        "detail": _clean_field(raw.get("detail")),
        "reviews": _clean_field(raw.get("reviews"), 4000),
        "price_cents": price_cents,
        "flags": flags,
    }


def _report_path(report_id: str) -> Path:
    # 只允许十六进制短 id，避免路径穿越
    safe = "".join(ch for ch in report_id if ch.isalnum() or ch == "-")
    return _reports_dir() / f"{safe}.json"


def _save(report_id: str, record: Dict[str, Any]) -> None:
    _reports_dir().mkdir(parents=True, exist_ok=True)
    target = _report_path(report_id)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(target)


def _load(report_id: str) -> Optional[Dict[str, Any]]:
    path = _report_path(report_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@router.post("/analyze")
def analyze_listing(payload: dict = Body(...)):
    """诊断一份商品页，返回报告并留存一份快照（用于历史与对比）。"""
    data = _norm_payload(payload)
    report = analyze(data)

    report_id = f"td-{uuid.uuid4().hex[:12]}"
    record = {
        "report_id": report_id,
        "created_at": _now(),
        "title": data["title"],
        "price_cents": data["price_cents"],
        "report": report,
        "input": {
            "title": data["title"],
            "points": data["points"],
            "detail": data["detail"],
            "reviews": data["reviews"],
            "price_cents": data["price_cents"],
            "flags": data["flags"],
        },
    }
    _save(report_id, record)

    return {
        "report_id": report_id,
        "created_at": record["created_at"],
        "report": report,
    }


@router.get("/reports")
def list_reports(limit: int = Query(20, ge=1, le=100)):
    """历史诊断（只回摘要，避免列表把整份报告都拖下来）。"""
    if not _reports_dir().exists():
        return {"items": [], "total": 0}

    items: List[Dict[str, Any]] = []
    for path in _reports_dir().glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        report = record.get("report") or {}
        score = report.get("score") or {}
        items.append(
            {
                "report_id": record.get("report_id") or path.stem,
                "created_at": record.get("created_at"),
                "title": record.get("title") or "",
                "total": score.get("total"),
                "grade": score.get("grade"),
                "can_list": (report.get("gates") or {}).get("can_list"),
            }
        )

    items.sort(key=lambda i: str(i.get("created_at") or ""), reverse=True)
    return {"items": items[:limit], "total": len(items)}


@router.get("/reports/{report_id}")
def get_report(report_id: str):
    record = _load(report_id)
    if not record:
        raise HTTPException(404, f"诊断报告不存在：{report_id}")
    return record


@router.get("/rules")
def list_rules():
    """规则清单（口径自证）：界面用它解释「扣分都扣在哪」。"""
    from shadowflow.services import listing_doctor as engine

    return {
        "version": 1,
        "engine": "rules",
        "dimensions": [
            {"key": dim, "weight": engine.DIM_WEIGHTS[dim]} for dim in engine.DIM_ORDER
        ],
        "severity_deduct": engine.SEVERITY_DEDUCT,
        "score_cap": engine.COMPLIANCE_SCORE_CAP,
        "thresholds": {
            "title": [engine.TITLE_MIN, engine.TITLE_MAX],
            "points": [engine.POINTS_MIN, engine.POINTS_MAX],
        },
    }
