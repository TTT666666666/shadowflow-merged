"""商品页诊断 API（/api/teardown）。

职责边界：只做「收参数 → 调引擎 → 落盘 → 回读」，判定逻辑全在
``shadowflow.services.listing_doctor`` 里（纯函数、可单测）。
"""

from __future__ import annotations

import csv
import io
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response

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
MAX_CSV = 200_000
# 一次批次最多 50 条：规则引擎是纯函数、单条毫秒级，但落盘与响应体要可控。
MAX_BATCH_ITEMS = 50

# CSV 表头别名：代运营从各平台后台导出的表，列名五花八门，这里做一次收敛。
# 价格统一按「元」收（与前端单条诊断一致），进引擎前换算成分。
_CSV_ALIASES = {
    "title": "title", "name": "title", "标题": "title", "商品标题": "title",
    "points": "points", "卖点": "points", "卖点列表": "points",
    "detail": "detail", "详情": "detail", "描述": "detail", "商品详情": "detail",
    "price": "price", "价格": "price", "价格(元)": "price", "价格（元）": "price",
    "flags": "flags", "素材": "flags", "已有素材": "flags",
    "category": "category", "类目": "category", "品类": "category", "行业": "category",
}

# 类目值别名：CSV 里人写的是「食品」「母婴」，引擎要的是 key。
_CATEGORY_ALIASES = {
    "": "auto", "auto": "auto", "自动": "auto", "自动识别": "auto",
    "food": "food", "食品": "food", "食品饮料": "food", "零食": "food",
    "保健": "food", "保健品": "food", "生鲜": "food", "饮品类": "food",
    "beauty": "beauty", "美妆": "beauty", "护肤": "beauty", "化妆品": "beauty",
    "彩妆": "beauty", "个护": "beauty",
    "baby": "baby", "母婴": "baby", "玩具": "baby", "儿童": "baby", "童装": "baby",
    "medical": "medical", "医疗": "medical", "器械": "medical", "消毒": "medical",
    "医疗器械": "medical", "个护器械": "medical",
}


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

    category_raw = str(raw.get("category") or "").strip().lower()
    category = _CATEGORY_ALIASES.get(category_raw, "auto")

    return {
        "title": title,
        "points": points,
        "detail": _clean_field(raw.get("detail")),
        "reviews": _clean_field(raw.get("reviews"), 4000),
        "price_cents": price_cents,
        "flags": flags,
        "category": category,
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


def _col_key(name: Any) -> Optional[str]:
    raw = str(name or "").strip()
    return _CSV_ALIASES.get(raw) or _CSV_ALIASES.get(raw.lower())


def _split_cell(value: Any) -> List[str]:
    """单元格里的多值：优先竖线，其次中文分号 / 换行。"""
    text = str(value or "")
    parts = [p.strip() for chunk in text.split("|") for p in chunk.replace("；", "\n").split("\n")]
    return [p for p in parts if p][:20]


def _parse_csv(text: str) -> List[Dict[str, Any]]:
    """把平台导出的商品表收成引擎认识的 payload 列表（不做评分）。"""
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise HTTPException(422, "CSV 缺少表头行")
    columns = [(_col_key(name), name) for name in reader.fieldnames]
    if not any(key == "title" for key, _ in columns):
        raise HTTPException(422, "CSV 表头需要「标题」或 title 列")

    rows: List[Dict[str, Any]] = []
    for raw in reader:
        cells: Dict[str, Any] = {}
        for key, name in columns:
            if key:
                cells[key] = (raw.get(name) or "").strip()

        title = cells.get("title") or ""
        points = _split_cell(cells.get("points"))
        if not title and not points:
            continue  # 空行 / 分隔行

        row: Dict[str, Any] = {"title": title, "points": points}
        if cells.get("detail"):
            row["detail"] = cells["detail"]
        price_text = str(cells.get("price") or "").strip()
        if price_text:
            try:
                row["price_cents"] = int(round(float(price_text) * 100))
            except ValueError:
                pass  # 价格不是必填，脏数据忽略而不是整批失败
        flag_keys = [f for f in _split_cell(cells.get("flags")) if f]
        if flag_keys:
            row["flags"] = {f: True for f in flag_keys}
        if cells.get("category"):
            row["category"] = cells["category"]  # 行内类目优先于批次级默认值
        rows.append(row)
    return rows


def _batch_dir() -> Path:
    return _reports_dir() / "batches"


def _batch_path(batch_id: str) -> Path:
    safe = "".join(ch for ch in batch_id if ch.isalnum() or ch == "-")
    return _batch_dir() / f"{safe}.json"


def _save_batch(batch_id: str, record: Dict[str, Any]) -> None:
    _batch_dir().mkdir(parents=True, exist_ok=True)
    target = _batch_path(batch_id)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(target)


def _load_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    path = _batch_path(batch_id)
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
        # 类目词库对外自证：界面下拉与「这条为什么被判违规」都靠它
        "categories": [
            {
                "key": key,
                "label": label,
                "rules": [
                    {"code": code, "severity": severity, "words": len(words)}
                    for code, severity, words in engine.CATEGORY_RULES.get(key, ())
                ],
            }
            for key, label in engine.CATEGORY_LABELS.items()
        ],
    }


# ── 批量诊断：给代运营「一次交一份可验收的报告」用 ──────────────────────────
#
# 设计取舍：
# 1. 逐条复用同一个 analyze()，批量不产生第二套判定口径；
# 2. 单条脏数据不拖垮整批，错误按行记在 items[].error 里；
# 3. 每条同时落一份独立 report，前端可以沿 /reports/{id} 打开完整详情，
#    不用为批量再造一套详情接口。


@router.post("/batch")
def analyze_batch(payload: dict = Body(...)):
    """一次诊断多条商品页；支持粘贴 CSV 文本或直接传 items 数组。"""
    if payload.get("csv") is not None:
        text = _clean_field(payload.get("csv"), MAX_CSV)
        items = _parse_csv(text)
    elif isinstance(payload.get("items"), list):
        items = payload["items"]
    else:
        raise HTTPException(422, "需要 csv 文本或 items 数组")

    if not items:
        raise HTTPException(422, "没有可诊断的商品行")
    if len(items) > MAX_BATCH_ITEMS:
        raise HTTPException(422, f"单次最多 {MAX_BATCH_ITEMS} 条，请分批处理")

    label = _clean_field(payload.get("label"), 120)
    brand = _clean_field(payload.get("brand"), 120)
    default_category = payload.get("category") or "auto"
    batch_id = f"tb-{uuid.uuid4().hex[:12]}"
    created_at = _now()
    results: List[Dict[str, Any]] = []

    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, Mapping):
            results.append({"row": index, "title": "", "ok": False, "error": "行数据格式不正确"})
            continue
        try:
            row = dict(raw)
            # 行内没写类目就用批次级默认值（前端下拉选的），再没有就交给自动识别
            if not str(row.get("category") or "").strip():
                row["category"] = default_category
            data = _norm_payload(row)
            rep = analyze(data)
            report_id = f"td-{uuid.uuid4().hex[:12]}"
            _save(
                report_id,
                {
                    "report_id": report_id,
                    "created_at": created_at,
                    "title": data["title"],
                    "price_cents": data["price_cents"],
                    "report": rep,
                    "input": data,
                    "batch_id": batch_id,
                    "source": "batch",
                },
            )
            score = rep.get("score") or {}
            gates = rep.get("gates") or {}
            counts = rep.get("counts") or {}
            results.append(
                {
                    "row": index,
                    "title": data["title"],
                    "report_id": report_id,
                    "ok": True,
                    "total": score.get("total"),
                    "grade": score.get("grade"),
                    "can_list": gates.get("can_list"),
                    "blocked_by": gates.get("blocked_by") or [],
                    "high": counts.get("high") or 0,
                    "issues": counts.get("issues") or 0,
                    "category": (rep.get("category") or {}).get("key"),
                    "top_issues": [i.get("id") for i in (rep.get("issues") or [])[:3]],
                }
            )
        except HTTPException as exc:
            results.append(
                {
                    "row": index,
                    "title": str(raw.get("title") or "")[:MAX_TITLE],
                    "ok": False,
                    "error": str(exc.detail),
                }
            )

    ok_items = [r for r in results if r.get("ok")]
    totals = [r["total"] for r in ok_items if isinstance(r.get("total"), (int, float))]
    summary = {
        "total": len(results),
        "ok": len(ok_items),
        "failed": len(results) - len(ok_items),
        "avg_total": round(sum(totals) / len(totals), 1) if totals else None,
        "blocked": sum(1 for r in ok_items if r.get("can_list") is False),
        "high": sum(int(r.get("high") or 0) for r in ok_items),
    }
    record = {
        "batch_id": batch_id,
        "created_at": created_at,
        "label": label,
        "brand": brand,
        "summary": summary,
        "items": results,
    }
    _save_batch(batch_id, record)
    return record


@router.get("/batches")
def list_batches(limit: int = Query(20, ge=1, le=100)):
    """历史批次（只回摘要）。"""
    if not _batch_dir().exists():
        return {"items": [], "total": 0}
    items: List[Dict[str, Any]] = []
    for path in _batch_dir().glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        items.append(
            {
                "batch_id": record.get("batch_id") or path.stem,
                "created_at": record.get("created_at"),
                "label": record.get("label") or "",
                "brand": record.get("brand") or "",
                "summary": record.get("summary") or {},
            }
        )
    items.sort(key=lambda i: str(i.get("created_at") or ""), reverse=True)
    return {"items": items[:limit], "total": len(items)}


@router.get("/batches/{batch_id}/export")
def export_batch(
    batch_id: str,
    format: str = Query("csv", pattern="^(csv|json)$"),
    lang: str = Query("zh", pattern="^(zh|en)$"),
):
    """白标导出：brand 写在抬头，CSV 带 BOM（Excel 直接打开不乱码）。"""
    record = _load_batch(batch_id)
    if not record:
        raise HTTPException(404, f"批次不存在：{batch_id}")
    if format == "json":
        return record

    zh = lang == "zh"
    header = (
        ["序号", "商品标题", "总分", "等级", "能否上架", "致命问题", "问题数", "主要问题", "报告编号"]
        if zh
        else ["Row", "Title", "Score", "Grade", "Can list", "Critical", "Issues", "Top issues", "Report ID"]
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    brand = str(record.get("brand") or "").strip()
    if brand:
        writer.writerow([f"# {brand} · Listing Doctor"])
    writer.writerow(header)
    for item in record.get("items") or []:
        if not item.get("ok"):
            writer.writerow(
                [item.get("row"), item.get("title"), "", "", "", "", "", item.get("error") or "", ""]
            )
            continue
        writer.writerow(
            [
                item.get("row"),
                item.get("title"),
                item.get("total") if item.get("total") is not None else "",
                item.get("grade") or "",
                ("是" if zh else "Yes") if item.get("can_list") else ("否" if zh else "No"),
                item.get("high") or 0,
                item.get("issues") or 0,
                ", ".join(item.get("top_issues") or []),
                item.get("report_id") or "",
            ]
        )
    return Response(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="listing-doctor-{batch_id}.csv"'
        },
    )


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str):
    record = _load_batch(batch_id)
    if not record:
        raise HTTPException(404, f"批次不存在：{batch_id}")
    return record
