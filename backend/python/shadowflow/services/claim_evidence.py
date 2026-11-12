# -*- coding: utf-8 -*-
"""宣称-证据对账（Claim–Evidence Ledger）。

为什么这个东西比「查违禁词」更难被替代
--------------------------------------
查违禁词是「文本 → 标签」，小模型微调一下就能做，甚至做得更细。对账不是：
它要回答的是「你**有没有资格**说这句话」，涉及四件模型不擅长的事：

1. **编号格式**：「国妆特字G20201234」是 8 位数字，少一位就是假号；
   SC 是 14 位，3C 是 16 位。模型会顺着上下文编一个「看起来对」的号。
2. **有效期**：证书过期了，宣称就失效。这是日期比较，不是语义判断。
3. **主体一致**：证书是 A 公司的，店铺主体是 B 公司——代运营最常见的坑，
   因为一个运营手里常常拿着上家的资质。
4. **适用范围**：证书写「棉针织面料」，文案写「真丝」，证不覆盖宣称。

前三条是确定性计算，第四条是关键词覆盖判断。这四件事组成了不可替代性：
不是「懂得多」，是「能对账、能算、能比对」。

设计约束
--------
- 只回结构化码 + params，中文句子在前端（沿用 listing_doctor 的契约）。
- 判定分三档可信度：``strict``（正则/日期，可直接结论）、``heuristic``（关键词
  重叠，只提示）、``manual``（无法自动判定，标「需人工核验」）。
- 宁可标 ``unknown`` 也不猜。**猜错一个证号，比漏判十个更伤信任。**
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

# --------------------------------------------------------------------------- 证据类型

# ``pattern`` 为 None 表示该类型暂无公开的统一编号格式（如授权书），只做类型匹配。
EVIDENCE_TYPES: Dict[str, Dict[str, Any]] = {
    "test_report": {
        "label": "检测报告",
        "pattern": r"(?:CMA|CNAS|MA)\s*[0-9A-Za-z\-]{6,}",
        "has_expiry": True,
        "hint": "CMA / CNAS 标志的第三方检测报告",
    },
    "special_cosmetic": {
        "label": "特殊化妆品注册证",
        "pattern": r"国妆特字[GJ]\d{8}",
        "has_expiry": True,
        "hint": "美白、祛斑、防晒、染发等特殊化妆品必须有",
    },
    "organic_cert": {
        "label": "有机产品认证",
        "pattern": r"(?:OFDC|有机认证|有机产品认证)[0-9A-Za-z\-]*",
        "has_expiry": True,
        "hint": "OFDC 等认证机构的有机证书，一年一检",
    },
    "ccc": {
        "label": "3C 认证",
        "pattern": r"\d{16}",
        "has_expiry": True,
        "hint": "玩具、电器、童车等强制性产品认证",
    },
    "food_production": {
        "label": "食品生产许可",
        "pattern": r"SC\d{14}",
        "has_expiry": True,
        "hint": "SC 开头 14 位数字，食品生产许可证编号",
    },
    "health_food": {
        "label": "保健食品批号",
        "pattern": r"国食健字[GJ]\d{8}",
        "has_expiry": True,
        "hint": "蓝帽子，普通食品不能借用",
    },
    "medical_device": {
        "label": "医疗器械注册证",
        "pattern": r"(?:械注准|械备|械注进)\d{4,}",
        "has_expiry": True,
        "hint": "械字号，按注册范围宣称",
    },
    "authorization": {
        "label": "品牌授权书",
        "pattern": None,
        "has_expiry": True,
        "hint": "无统一编号格式，只能核对授权方与有效期",
    },
}

# --------------------------------------------------------------------------- 宣称类型

# ``evidence`` 是该宣称**最低限度**需要的证据类型，按顺序第一个匹配到的算通过。
# 一个宣称可以接受多种证据（如成分可用检测报告，也可用原料商 COA）。
CLAIM_TYPES: Dict[str, Dict[str, Any]] = {
    "composition": {
        "label": "成分 / 材质",
        # 只收「材质词」，不要求带 100% 前缀：有机棉、精梳棉、长绒棉都是真实写法，
        # 只写「纯棉/全棉」会漏掉一半的服装类目。
        "patterns": (
            r"(?:纯棉|全棉|有机棉|精梳棉|长绒棉|棉麻|纯羊毛|羊毛|真丝|桑蚕丝|羊绒|亚麻|"
            r"真皮|实木|不锈钢|316|304|硅胶|乳胶|羽绒|蚕丝|竹纤维|天丝)",
        ),
        "evidence": ("test_report",),
        "note": "成分与实测不符即虚假宣传，需要成分检测报告",
    },
    "certification": {
        "label": "认证 / 资质",
        "patterns": (
            r"(?:有机|绿色食品|无公害|非转基因|3C|CCC|FDA|CE认证|HACCP|ISO\d+)",
        ),
        "evidence": ("organic_cert", "ccc"),
        "note": "认证类宣称必须有对应证书，且证书在有效期内",
    },
    "efficacy": {
        "label": "功效",
        "patterns": (
            r"(?:美白|祛斑|淡斑|抗皱|祛痘|防脱|生发|减肥|降血压|降血糖|助眠|"
            r"增强免疫|抗疲劳|改善睡眠)",
        ),
        "evidence": ("special_cosmetic", "health_food", "medical_device"),
        "note": "功效宣称按类目走不同资质：化妆品→特证，食品→蓝帽子，器械→械字号",
    },
    "safety": {
        "label": "安全性",
        "patterns": (
            r"(?:食品级|无毒无害|零甲醛|无添加|零添加|可食用|可啃咬|母婴可用|孕妇可用)",
        ),
        "evidence": ("test_report",),
        "note": "安全宣称需要对应标准的检测报告（如 GB 4806 食品接触材料）",
    },
    "spec": {
        "label": "参数",
        # 单位里刻意不收「天 / 年」：「7天无理由」「3年质保」是售后条款，
        # 归 service 管；收进来会让每条文案都多出一行无意义的「7天」。
        "patterns": (
            r"\d+(?:\.\d+)?\s*(?:cm|mm|kg|g|ml|l|mah|w|v|小时|度)",
        ),
        # 参数不阻塞：尺寸、容量是商品自身属性，要求每条都配质检报告会让功能没法用。
        # 虚标承重/容量属虚假宣传，属另一类检测，先只提示「需与实测一致」。
        "evidence": (),
        "note": "参数需与实测一致；虚标承重、容量属虚假宣传，建议留存检测报告（非强制）",
    },
    "service": {
        "label": "售后承诺",
        "patterns": (r"(?:终身|永久|无理由|包退|包换|保修|质保|无效退款|零风险)",),
        "evidence": (),
        "note": "服务承诺无需外部证书，但必须能兑现（属经营承诺，不是资质）",
    },
}

# --------------------------------------------------------------------------- 结果状态

STATUS = ("ok", "missing", "expired", "bad_code", "subject_mismatch", "scope_mismatch", "unknown")

# 判定可信度：strict 可直接下结论，heuristic 只提示，manual 需人工核验。
CONFIDENCE = {"strict": "strict", "heuristic": "heuristic", "manual": "manual"}


def _today() -> date:
    return date.today()


def _parse_date(value: Any) -> Optional[date]:
    """接受 2027-03-01 / 2027/3/1 / 20270301 三种写法，失败返回 None。"""
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d", "%Y.%m.%d"):
        try:
            from datetime import datetime

            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _norm(text: str) -> str:
    return re.sub(r"[\s　]+", "", str(text or "")).lower()


# 具体词 → 指定证据类型。同一类宣称需要的证完全不同：
# 「美白」要特证，「减肥」要蓝帽子，「3C」要 CCC——用「任一即可」的宽松匹配，
# 会拿一张检测报告冒充认证，是比漏判更坏的错。
WORD_EVIDENCE: Dict[str, str] = {
    "美白": "special_cosmetic",
    "祛斑": "special_cosmetic",
    "淡斑": "special_cosmetic",
    "抗皱": "special_cosmetic",
    "祛痘": "special_cosmetic",
    "防脱": "special_cosmetic",
    "生发": "special_cosmetic",
    "减肥": "health_food",
    "降血压": "health_food",
    "降血糖": "health_food",
    "助眠": "health_food",
    "改善睡眠": "health_food",
    "增强免疫": "health_food",
    "抗疲劳": "health_food",
    "有机": "organic_cert",
    "绿色食品": "organic_cert",
    "无公害": "organic_cert",
    "非转基因": "organic_cert",
    "3c": "ccc",
    "ccc": "ccc",
}


def _evidence_for(kind: str, snippet: str) -> List[str]:
    """先按具体词定证据类型，查不到才用该类别的默认清单。

    **只在认证与功效两类里查词表。** 「有机棉」是成分宣称，虽然含「有机」二字，
    但它要的是成分检测报告，不是有机认证——把词映射套到成分上会造成反向张冠李戴。
    """
    if kind in ("certification", "efficacy"):
        lowered = snippet.lower()
        for word, evidence in WORD_EVIDENCE.items():
            if word in lowered:
                return [evidence]
    return list(CLAIM_TYPES[kind]["evidence"])


def _find_claims(text: str) -> List[Dict[str, Any]]:
    """从文案里抽出宣称。**每类只取首个命中**。

    同名宣称出现多次（「精梳棉」「有机棉」）时只报一条：证据要求完全一样，
    报两遍会让对账表看起来像在凑数。
    """
    claims: List[Dict[str, Any]] = []
    for kind, spec in CLAIM_TYPES.items():
        hit = None
        for pattern in spec["patterns"]:
            hit = re.search(pattern, text, re.IGNORECASE)
            if hit:
                break
        if not hit:
            continue
        snippet = hit.group(0)
        claims.append(
            {
                "type": kind,
                "type_label": spec["label"],
                "text": snippet,
                "evidence_types": _evidence_for(kind, snippet),
                "note": spec["note"],
            }
        )
    return claims


def _check_code(code: str, kind: str) -> Tuple[str, str]:
    """校验编号格式。返回 (状态, 命中的正则/空)。大小写不敏感。"""
    pattern = EVIDENCE_TYPES[kind].get("pattern")
    if not pattern:
        return "unknown", ""
    raw = str(code or "").strip()
    for candidate in (raw, re.sub(r"[\s\-_/]", "", raw)):
        if re.fullmatch(pattern, candidate, re.IGNORECASE):
            return "ok", pattern
    return "bad_code", pattern


def _subject_match(cert_subject: str, seller: str) -> str:
    """证书主体与店铺主体是否一致。启发式：归一化后互为子串即视为一致。"""
    a, b = _norm(cert_subject), _norm(seller)
    if not a or not b:
        return "unknown"
    if a in b or b in a:
        return "ok"
    return "mismatch"


_MATERIAL_CHARS = "棉毛丝麻绒皮木胶纶纤竹乳羽"


def _scope_match(scope: str, claim_text: str) -> str:
    """证书适用范围是否覆盖这条宣称。

    启发式两层：材质类宣称比「材质核心字」（纯棉 vs 棉针织面料算覆盖），
    其余宣称比双字词重叠。判断不了就返回 unknown，不硬给结论。
    """
    scope_norm = _norm(scope)
    claim_norm = _norm(claim_text)
    if not scope_norm:
        return "unknown"

    claim_chars = {c for c in claim_norm if c in _MATERIAL_CHARS}
    if claim_chars:
        scope_chars = {c for c in scope_norm if c in _MATERIAL_CHARS}
        return "ok" if claim_chars & scope_chars else "mismatch"

    tokens = re.findall(r"[\u4e00-\u9fa5]{2,}", claim_norm)
    if not tokens:
        return "unknown"
    return "ok" if any(t in scope_norm for t in tokens) else "mismatch"


def _pick_evidence(
    claim: Mapping[str, Any], evidences: Sequence[Mapping[str, Any]]
) -> Optional[Mapping[str, Any]]:
    """按宣称允许的证据类型顺序挑一份证据；同类多份时取有效期最晚的。"""
    for kind in claim["evidence_types"]:
        candidates = [e for e in evidences if str(e.get("type") or "") == kind]
        if not candidates:
            continue
        dated = [(e, _parse_date(e.get("expiry"))) for e in candidates]
        dated.sort(key=lambda pair: (pair[1] or date.min), reverse=True)
        return dated[0][0]
    return None


def reconcile(
    listing: Mapping[str, Any],
    evidences: Sequence[Mapping[str, Any]],
    seller_name: str = "",
) -> Dict[str, Any]:
    """对账入口。

    ``listing``: ``{title, points, detail}``
    ``evidences``: ``[{type, code, expiry, subject, scope}]``
    ``seller_name``: 店铺主体名，用于核对证书主体
    """
    parts = [
        str(listing.get("title") or ""),
        "\n".join(listing.get("points") or []),
        str(listing.get("detail") or ""),
    ]
    text = "\n".join(parts)

    claims = _find_claims(text)
    rows: List[Dict[str, Any]] = []
    today = _today()

    for claim in claims:
        row: Dict[str, Any] = {
            "type": claim["type"],
            "type_label": claim["type_label"],
            "text": claim["text"],
            "need": claim["evidence_types"],
            "note": claim["note"],
            "status": "ok",
            "confidence": "strict",
            "params": {},
        }

        if not claim["evidence_types"]:
            # 售后承诺、参数这类不需要外部资质，但也不能算「已验证」，标 manual 由人核。
            row["status"] = "ok"
            row["confidence"] = "manual"
            row["params"] = {"reason": claim["note"]}
            rows.append(row)
            continue

        ev = _pick_evidence(claim, evidences)
        if ev is None:
            row["status"] = "missing"
            row["confidence"] = "strict"
            row["params"] = {"need": claim["evidence_types"]}
            rows.append(row)
            continue

        row["evidence"] = {
            "type": ev.get("type"),
            "code": ev.get("code"),
            "expiry": ev.get("expiry"),
        }

        # 1. 编号格式（严格）
        code_state, _ = _check_code(str(ev.get("code") or ""), str(ev.get("type")))
        if code_state == "bad_code":
            row["status"] = "bad_code"
            row["confidence"] = "strict"
            rows.append(row)
            continue

        # 2. 有效期（严格）
        expiry = _parse_date(ev.get("expiry"))
        if expiry is None:
            row["status"] = "unknown"
            row["confidence"] = "manual"
            row["params"] = {"reason": "未填有效期，无法判断是否过期"}
            rows.append(row)
            continue
        if expiry < today:
            row["status"] = "expired"
            row["confidence"] = "strict"
            row["params"] = {"expiry": expiry.isoformat()}
            rows.append(row)
            continue

        # 3. 主体一致（启发式）
        if seller_name:
            subj = _subject_match(str(ev.get("subject") or ""), seller_name)
            if subj == "mismatch":
                row["status"] = "subject_mismatch"
                row["confidence"] = "heuristic"
                row["params"] = {"subject": ev.get("subject"), "seller": seller_name}
                rows.append(row)
                continue

        # 4. 适用范围（启发式）
        scope = _scope_match(str(ev.get("scope") or ""), claim["text"])
        if scope == "mismatch":
            row["status"] = "scope_mismatch"
            row["confidence"] = "heuristic"
            row["params"] = {"scope": ev.get("scope"), "claim": claim["text"]}
            rows.append(row)
            continue

        row["status"] = "ok"
        row["confidence"] = "strict"
        rows.append(row)

    counts = {key: 0 for key in STATUS}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    blocking = [r for r in rows if r["status"] in ("missing", "expired", "bad_code", "subject_mismatch")]
    return {
        "version": 1,
        "engine": "rules",
        "counts": counts,
        "total": len(rows),
        "blocking": len(blocking),
        "can_claim": not blocking,
        "claims": rows,
        "evidence_count": len(evidences),
    }
