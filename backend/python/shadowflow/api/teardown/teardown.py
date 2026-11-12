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
from typing import Any, Dict, List, Mapping, Optional, Sequence

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response

from shadowflow.services.claim_evidence import EVIDENCE_TYPES, reconcile
from shadowflow.services.listing_doctor import analyze

router = APIRouter(prefix="/api/teardown", tags=["teardown"])

# 与 .shadowflow 下其他运行期数据同源；目录在调用时解析（环境变量可覆盖），
# 这样测试能在 import 之后把落盘位置指到临时目录，不污染仓库。
_REPORTS_DIR_ENV = "SHADOWFLOW_TEARDOWN_DIR"
_DEFAULT_REPORTS_DIR = ".shadowflow/teardown"


def _reports_dir() -> Path:
    return Path(os.getenv(_REPORTS_DIR_ENV) or _DEFAULT_REPORTS_DIR)

# 上限要高于最宽松的平台限制（TikTok 255 / 亚马逊单条卖点 500），
# 否则超长文案会被 422 直接拒收——而「标题超长」恰恰是该被诊断出来的问题。
MAX_TITLE = 300
MAX_POINT = 700
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
    "platform": "platform", "平台": "platform", "目标平台": "platform", "站点": "platform",
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

# 平台值别名：跨境卖家写的是「亚马逊」「amazon.com」「TikTok」，引擎要的是 key。
_PLATFORM_ALIASES = {
    "": "generic", "generic": "generic", "通用": "generic", "国内": "generic",
    "国内电商": "generic", "淘宝": "generic", "天猫": "generic", "抖店": "generic",
    "拼多多": "generic", "小红书": "generic", "京东": "generic",
    "amazon": "amazon", "亚马逊": "amazon", "amazon.com": "amazon", "亚马逊美国站": "amazon",
    "tiktok": "tiktok", "tiktok shop": "tiktok", "tik tok": "tiktok", "抖音小店": "tiktok",
    "跨境": "amazon",
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
        points = [_clean_field(p, MAX_POINT) for p in points_raw if str(p or "").strip()][:20]
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

    platform_raw = str(raw.get("platform") or "").strip().lower()
    platform = _PLATFORM_ALIASES.get(platform_raw, "generic")

    return {
        "title": title,
        "points": points,
        "detail": _clean_field(raw.get("detail")),
        "reviews": _clean_field(raw.get("reviews"), 4000),
        "price_cents": price_cents,
        "flags": flags,
        "category": category,
        "platform": platform,
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
        if cells.get("platform"):
            row["platform"] = cells["platform"]  # 行内平台同理
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
            # 带上判定口径：改后对比与「按上次的参数重跑」都要用到
            "category": data.get("category"),
            "platform": data.get("platform"),
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


# ── 改前 / 改后对比：代运营给甲方交差的证据 ──────────────────────────────────
#
# 单次诊断只回答「现在怎么样」，甲方真正要看的是「你改完之后好了多少」。
# 这也是复购钩子：第一次诊断是免费引流，第二次对比证明价值，第三次才谈订阅。


def _issue_ids(report: Mapping[str, Any]) -> List[str]:
    """按出现顺序去重：同一个码出现两次时，改后剩一个也算没改干净。"""
    seen: List[str] = []
    for item in report.get("issues") or []:
        code = str(item.get("id") or "")
        if code and code not in seen:
            seen.append(code)
    return seen


def _issues_for(report: Mapping[str, Any], codes: Sequence[str]) -> List[Dict[str, Any]]:
    """取出这些码对应的**完整问题对象**。

    只回 id 的话，前端没法渲染文案——`title.too_short` 的标题里带 `{length}`，
    缺 params 会原样漏到界面上。回对象则可以直接复用现有问题卡渲染。
    """
    wanted = set(codes)
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for item in report.get("issues") or []:
        code = str(item.get("id") or "")
        if code in wanted and code not in seen:
            out.append(item)
            seen.add(code)
    return out


def _compare_reports(before: Mapping[str, Any], after: Mapping[str, Any]) -> Dict[str, Any]:
    b_ids, a_ids = _issue_ids(before), _issue_ids(after)
    b_score = before.get("score") or {}
    a_score = after.get("score") or {}
    b_gates = before.get("gates") or {}
    a_gates = after.get("gates") or {}

    b_dims = {d.get("key"): d for d in b_score.get("dimensions") or []}
    dimensions = []
    for dim in a_score.get("dimensions") or []:
        key = dim.get("key")
        b_val = (b_dims.get(key) or {}).get("score")
        a_val = dim.get("score")
        dimensions.append(
            {
                "key": key,
                "before": b_val,
                "after": a_val,
                "delta": (a_val - b_val) if isinstance(b_val, int) and isinstance(a_val, int) else None,
            }
        )

    b_total, a_total = b_score.get("total"), a_score.get("total")
    return {
        "total": {
            "before": b_total,
            "after": a_total,
            "delta": (a_total - b_total) if isinstance(b_total, int) and isinstance(a_total, int) else None,
        },
        "grade": {"before": b_score.get("grade"), "after": a_score.get("grade")},
        "can_list": {"before": b_gates.get("can_list"), "after": a_gates.get("can_list")},
        # 回完整对象而不是 id：前端要按现有问题卡渲染文案（含 params）
        "resolved": _issues_for(before, [c for c in b_ids if c not in a_ids]),
        "remaining": _issues_for(after, [c for c in a_ids if c in b_ids]),
        "regressed": _issues_for(after, [c for c in a_ids if c not in b_ids]),
        "dimensions": dimensions,
        "counts": {
            "before": before.get("counts") or {},
            "after": after.get("counts") or {},
        },
    }


@router.post("/compare")
def compare_listings(payload: dict = Body(...)):
    """对比两份文案（改前 / 改后），返回分数变化、已解决、遗留与新增问题。"""
    before_raw = payload.get("before")
    after_raw = payload.get("after")
    if not isinstance(before_raw, Mapping) or not isinstance(after_raw, Mapping):
        raise HTTPException(422, "需要 before 与 after 两份文案")

    before_data = _norm_payload(dict(before_raw))
    after_data = _norm_payload(dict(after_raw))
    before_rep = analyze(before_data)
    after_rep = analyze(after_data)

    return {
        "before": {"input": before_data, "report": before_rep},
        "after": {"input": after_data, "report": after_rep},
        "delta": _compare_reports(before_rep, after_rep),
    }


@router.get("/compare")
def compare_saved(
    before: str = Query(..., min_length=1),
    after: str = Query(..., min_length=1),
):
    """用两份已落盘报告的 id 对比（批量诊断 / 历史列表里挑两条即可）。"""
    b_rec = _load(before)
    a_rec = _load(after)
    if not b_rec or not a_rec:
        raise HTTPException(404, "报告不存在")
    b_rep = b_rec.get("report") or {}
    a_rep = a_rec.get("report") or {}
    return {
        "before": {"report_id": before, "title": b_rec.get("title"), "report": b_rep},
        "after": {"report_id": after, "title": a_rec.get("title"), "report": a_rep},
        "delta": _compare_reports(b_rep, a_rep),
    }


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
        # 平台差异对外可见：界面上的「按亚马逊规则」不是文案噱头，限制值直接来自这里
        "platforms": [
            {
                "key": key,
                "label": label,
                "title_max": engine.PLATFORM_LIMITS[key]["title_max"],
                "points_max": engine.PLATFORM_LIMITS[key]["points_max"],
                "bullet_max": engine.PLATFORM_LIMITS[key]["bullet_max"],
            }
            for key, label in engine.PLATFORM_LABELS.items()
        ],
        # 对账页的证据类型下拉直接读这里，前端不再硬编码一份（两处清单必然漂移）
        "evidence_types": [
            {"key": key, "label": spec["label"], "hint": spec["hint"]}
            for key, spec in EVIDENCE_TYPES.items()
        ],
    }


# ── 宣称-证据对账：从「有没有违禁词」升级到「你有没有资格这么说」───────────
#
# 与 /analyze 的分工要说清楚：
#   /analyze   文本 → 问题码。模型也能做，而且能做得更细。
#   /ledger    文本 → 宣称 → 与证书台账对账。编号格式、有效期、主体、范围
#              这四件事是确定性计算，模型做不可靠。
#
# 刻意不合并成一个接口：对账要求用户手上有证书台账，没有台账的用户不该被它挡住。
# 两个接口各自独立可用，前端把它们做成两个标签页，不共享表单状态。

MAX_EVIDENCES = 200
MAX_EVIDENCE_FIELD = 200


def _ledger_points(value: Any) -> List[str]:
    if isinstance(value, (list, tuple)):
        items = [str(v) for v in value]
    else:
        items = _split_cell(value)
    return [item[:700] for item in items if item.strip()][:20]


@router.post("/ledger")
def claim_ledger(payload: dict = Body(...)):
    """宣称-证据对账：每条宣称需要什么证、你手上的证覆盖不覆盖。"""
    raw_items = payload.get("evidences")
    if raw_items is None:
        raw_items = []
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=422, detail="evidences 必须是数组")
    if len(raw_items) > MAX_EVIDENCES:
        raise HTTPException(status_code=422, detail=f"证据最多 {MAX_EVIDENCES} 条")

    evidences: List[Dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, Mapping):
            raise HTTPException(status_code=422, detail=f"第 {index + 1} 条证据格式不对")
        kind = str(item.get("type") or "").strip()
        if kind not in EVIDENCE_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"第 {index + 1} 条证据类型未知：{kind or '(空)'}",
            )
        evidences.append(
            {
                "type": kind,
                "code": _clean_field(item.get("code"), MAX_EVIDENCE_FIELD),
                "expiry": _clean_field(item.get("expiry"), 20),
                "subject": _clean_field(item.get("subject"), MAX_EVIDENCE_FIELD),
                "scope": _clean_field(item.get("scope"), MAX_EVIDENCE_FIELD),
            }
        )

    result = reconcile(
        {
            "title": _clean_field(payload.get("title"), 300),
            "points": _ledger_points(payload.get("points")),
            "detail": _clean_field(payload.get("detail"), 4000),
        },
        evidences,
        seller_name=_clean_field(payload.get("seller_name"), MAX_EVIDENCE_FIELD),
    )
    # 证据类型清单随响应返回，界面下拉不用再硬编码一份（两处清单必然漂移）。
    result["evidence_types"] = [
        {"key": key, "label": spec["label"], "hint": spec["hint"]}
        for key, spec in EVIDENCE_TYPES.items()
    ]
    return result


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
    default_platform = payload.get("platform") or "generic"
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
            if not str(row.get("platform") or "").strip():
                row["platform"] = default_platform
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
                    "platform": (rep.get("platform") or {}).get("key"),
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
        ["序号", "商品标题", "平台", "总分", "等级", "能否上架", "致命问题", "问题数", "主要问题", "报告编号"]
        if zh
        else ["Row", "Title", "Platform", "Score", "Grade", "Can list", "Critical", "Issues", "Top issues", "Report ID"]
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
                [item.get("row"), item.get("title"), item.get("platform") or "", "", "", "", "", "", item.get("error") or "", ""]
            )
            continue
        writer.writerow(
            [
                item.get("row"),
                item.get("title"),
                item.get("platform") or "",
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
