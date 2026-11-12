"""商品页诊断（Listing Doctor）—— 规则引擎 v1。

为什么是规则而不是「调模型」
----------------------------
本仓库的运行环境不保证有模型密钥（`shadowflow.llm` 只有 Provider 抽象，没有
`completion()` 门面；OPC 任务在无 key 时返回 ``[simulated]``）。把诊断做在模型上，
用户在没配 key 的机器上只会拿到一段假装分析过的文本。所以引擎用**词表 + 可解释
规则**实现：同样的输入必得同样的结论，每一条扣分都能指着原文说明理由，也能被
单元测试逐条钉死。模型只作为**增强层**（见 ``analyze(..., enhance=None)``），
接入与否不改变判定口径，界面会如实标注当前引擎。

三条不妥协
----------
1. **只输出结构化码**：返回值里没有中文句子，只有 ``id / dim / severity / params``。
   界面文案由前端 i18n 负责（中英各一份），否则英文界面会漏出中文诊断结论。
2. **不编造事实**：缺失的信息一律标成「待补」，绝不替用户生成材质、认证、销量
   这类可能构成虚假宣传的内容。改写建议是**填空模板**，不是成稿。
3. **合规是门禁**：命中极限词/功效宣称时，总分直接封顶 59（``can_list=False``），
   因为这类文案上架后是下架风险，不该被「其他维度分高」抵消。

输入（payload）
--------------
``title`` / ``points``（列表或换行文本）/ ``detail`` / ``price_cents`` /
``flags``（用户显式勾选：``material``/``proof``/``after_sale``/``shipping``/
``anchor``/``bundle``/``cta``/``contact``，True=有，False=没有，缺省=自动识别）
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

# --------------------------------------------------------------------------- 常量

SEVERITY_DEDUCT = {"high": 25, "medium": 12, "low": 6}

# 权重之和为 1.0；合规与转化是「能不能卖」的直接决定项，故给得比价格高。
DIM_WEIGHTS: Dict[str, float] = {
    "title": 0.20,
    "points": 0.20,
    "trust": 0.20,
    "pricing": 0.10,
    "conversion": 0.15,
    "compliance": 0.15,
}
DIM_ORDER: List[str] = ["title", "points", "trust", "pricing", "conversion", "compliance"]

# 命中合规高危 → 总分封顶。不是折扣，是「先别上架」。
COMPLIANCE_SCORE_CAP = 59

GRADE_BANDS = ((85, "excellent"), (70, "good"), (55, "needs_work"), (0, "risky"))

TITLE_MIN = 12
TITLE_MAX = 60
POINTS_MIN = 3
POINTS_MAX = 8

# 利益词：一句话里出现这些，说明写的是「对买家有什么用」而不是纯参数。
BENEFIT_MARKERS = (
    "让你", "帮你", "省", "免", "不用", "不怕", "避免", "适合", "可以",
    "耐用", "不掉", "不褪", "好洗", "易", "方便", "舒适", "安全", "轻",
    "暖", "吸", "防", "静音", "续航", "久", "柔软", "结实",
)

MATERIAL_WORDS = (
    "材质", "面料", "成分", "纯棉", "羊毛", "亚麻", "真皮", "实木", "陶瓷",
    "树脂", "不锈钢", "玻璃", "竹", "木", "手工", "钩织", "编织", "刺绣",
    "工艺", "做法", "制作",
)
PROOF_WORDS = (
    "检测", "认证", "质检", "资质", "专利", "报告", "销量", "好评", "评价",
    "回购", "案例", "实拍", "实测", "对比图", "买家秀",
)
AFTER_SALE_WORDS = (
    "退换", "无理由", "保修", "包退", "包换", "售后", "7天", "七天", "三包",
    "破损补发", "补发",
)
SHIPPING_WORDS = (
    "发货", "包邮", "快递", "顺丰", "次日", "现货", "48小时", "当天", "隔天",
)
ANCHOR_WORDS = (
    "原价", "日常价", "划线价", "专柜价", "套餐", "档位", "第二件", "买二",
    "买2", "组合价", "会员价", "到手价",
)
BUNDLE_WORDS = ("赠", "送", "加赠", "包邮", "附赠", "礼盒", "小样")
CTA_WORDS = (
    "立即", "马上", "点击", "下单", "购买", "加购", "私信", "咨询", "联系",
    "扫码", "拍下", "收藏", "预定", "预订", "领券",
)
VAGUE_CTA_WORDS = ("了解更多", "欢迎", "看看", "了解一下", "详情请")
CONTACT_WORDS = ("微信", "电话", "客服", "私信", "扫码", "二维码", "手机号", "QQ")
OPTION_WORDS = ("规格", "尺寸", "颜色", "款式", "可选", "定制", "型号", "尺码")

# 极限词：刻意收录多字词组，避免「最近/最后」这类单字误伤。
ABSOLUTE_WORDS = (
    "最好", "最佳", "最强", "最高级", "最低价", "全网最低", "史上最",
    "第一品牌", "销量第一", "排名第一", "国家级", "世界级", "顶级", "唯一",
    "绝对", "100%", "百分百", "独家配方", "王牌",
)
EFFICACY_WORDS = (
    "治疗", "治愈", "根治", "药效", "降血压", "降血糖", "降血脂", "减肥",
    "瘦身", "排毒", "抗炎", "消炎", "杀菌", "美白祛斑", "生发", "增强免疫",
    "抗癌", "处方",
)
GUARANTEE_WORDS = ("永久", "终身", "无效退款", "保证有效", "零风险", "百分百有效", "包治")

SCENE_WORDS = (
    "生日", "婚礼", "节日", "母亲节", "情人节", "毕业", "开学", "露营", "户外",
    "通勤", "办公室", "家用", "宿舍", "送礼", "伴手礼", "亲子", "儿童", "学生",
    "女生", "男生", "婴儿", "宠物",
)

# --------------------------------------------------------------------------- 类目词库
#
# 通用极限词抓不住类目特有的雷区：「降血糖」在玩具详情页只是句废话，在食品页
# 就是无证宣称功效；「药妆」「械字号」用在化妆品上一律违规。这些是代运营被罚
# 得最多、也是竞品按年收费的地方，纯词表规则，零模型成本。
#
# 设计取舍：类目词表**不重复收录**通用词（治疗/根治等已在 EFFICACY_WORDS），
# 否则同一句话会出两张问题卡，用户会以为是 bug。

CATEGORY_LABELS: Dict[str, str] = {
    "food": "食品/保健",
    "beauty": "美妆/护肤",
    "baby": "母婴/玩具",
    "medical": "器械/消毒",
}

# 类目 → ((问题码, 严重度, 词表), ...)；问题码即文案表的 key。
CATEGORY_RULES: Dict[str, tuple] = {
    "food": (
        (
            "compliance.food.efficacy",
            "high",
            (
                "降三高", "降血压", "降血糖", "降血脂", "降尿酸", "降火", "去湿",
                "排毒", "养胃", "护肝", "助眠", "抗糖", "增强免疫", "提高免疫",
                "调理", "防癌", "抗癌", "无副作用", "无添加蔗糖", "代餐瘦身",
            ),
        ),
        (
            "compliance.food.cert",
            "high",
            (
                "零添加", "无添加", "纯天然", "天然无添加", "有机", "无公害",
                "绿色食品", "非转基因", "0糖0卡", "零卡", "孕妇可用", "宝宝可食",
            ),
        ),
    ),
    "beauty": (
        (
            "compliance.beauty.drug",
            "high",
            ("药妆", "医学护肤", "医用级", "械字号", "医生推荐", "医院同款", "处方级"),
        ),
        (
            "compliance.beauty.whiten",
            "high",
            ("美白", "祛斑", "淡斑", "祛黄", "白一个度", "全身美白"),
        ),
        (
            "compliance.beauty.function",
            "medium",
            ("抗皱", "去皱", "祛痘", "缩毛孔", "去黑头", "防脱", "生发", "去疤"),
        ),
    ),
    "baby": (
        (
            "compliance.baby.claim",
            "high",
            (
                "益智", "开发智力", "促进大脑发育", "提高智力", "增强抵抗力",
                "可食用", "食品级", "无激素", "绝对安全", "宝宝可以咬", "可啃咬",
                "零甲醛", "无毒无害",
            ),
        ),
    ),
    "medical": (
        (
            "compliance.medical.claim",
            "high",
            ("疗效", "康复", "医用", "医院同款", "替代药物", "辅助治疗", "降血压"),
        ),
        (
            "compliance.medical.cert",
            "medium",
            ("消毒", "抑菌", "灭菌", "除菌", "械字号", "消字号"),
        ),
    ),
}

# 自动识别类目：只在标题/卖点/详情里出现明确的品类词时才启用，
# 宁可漏判也不误判——误判会把正常文案判成违规，比漏判更伤信任。
CATEGORY_HINTS: Dict[str, tuple] = {
    "food": (
        "零食", "食品", "饮片", "茶叶", "咖啡", "坚果", "糕点", "糖果", "蜂蜜",
        "代餐", "保健", "膳食", "调味", "米面", "粮油", "饮品", "酒",
    ),
    "beauty": (
        "面膜", "面霜", "精华", "水乳", "爽肤水", "洗面奶", "口红", "粉底",
        "护肤", "彩妆", "香水", "防晒", "眼霜", "身体乳", "洗发水", "沐浴露",
    ),
    "baby": (
        "婴儿", "宝宝", "儿童", "玩具", "奶瓶", "纸尿裤", "童装", "绘本",
        "拼图", "积木", "辅食", "婴儿车", "推车",
    ),
    "medical": (
        "口罩", "理疗", "按摩仪", "血压计", "血糖仪", "护腰", "护膝", "膏药",
        "敷料", "创可贴", "雾化", "制氧", "医用",
    ),
}

_GENERAL_COMPLIANCE = set(ABSOLUTE_WORDS) | set(EFFICACY_WORDS) | set(GUARANTEE_WORDS)


def _strip_dupes(words: Sequence[str]) -> tuple:
    return tuple(w for w in words if w not in _GENERAL_COMPLIANCE)


CATEGORY_RULES = {
    cat: tuple((code, sev, _strip_dupes(words)) for code, sev, words in rules)
    for cat, rules in CATEGORY_RULES.items()
}


def detect_category(text: str) -> Optional[str]:
    """按品类词猜类目；猜不出返回 None（此时只跑通用合规）。"""
    best, best_hits = None, 0
    for cat, hints in CATEGORY_HINTS.items():
        hits = sum(1 for h in hints if h in text)
        if hits > best_hits:
            best, best_hits = cat, hits
    return best

_NUM_TOKEN_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:cm|mm|m|kg|g|ml|l|寸|英寸|天|日|小时|分钟|年|件|只|个|片|套|色|w|v|mah)",
    re.IGNORECASE,
)
_SYMBOL_NOISE_RE = re.compile(r"[!！?？★☆◆●◇▶►※#~～]{2,}|[\U0001F300-\U0001FAFF]")
_SPACE_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------- 输入归一


def _compact(text: str) -> str:
    """去掉所有空白：中文字数按可见字符算，空格不算长度。"""
    return _SPACE_RE.sub("", text or "")


def _as_list(value: Any) -> List[str]:
    """卖点既可能是列表，也可能是一段用换行/分号写的文本。"""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        raw: Iterable[Any] = value
    else:
        text = str(value)
        parts = re.split(r"[\n\r；;]+", text)
        raw = parts
    out: List[str] = []
    for item in raw:
        line = str(item or "").strip().lstrip("-•·*0123456789.、)） ").strip()
        if line:
            out.append(line)
    return out


def _hit(text: str, words: Sequence[str]) -> Optional[str]:
    """返回首个命中的词（用于 evidence），没有则 None。"""
    lowered = (text or "").lower()
    for word in words:
        if word.lower() in lowered:
            return word
    return None


def _present(payload: Mapping[str, Any], flag: str, auto_text: str, words: Sequence[str]) -> bool:
    """信任/转化类元素：用户勾选优先（True/False 都算数），否则按词表自动识别。"""
    flags = payload.get("flags") or {}
    if isinstance(flags, Mapping) and flag in flags:
        return bool(flags.get(flag))
    return _hit(auto_text, words) is not None


def _corpus(payload: Mapping[str, Any], points: Sequence[str]) -> str:
    return "\n".join(
        [
            str(payload.get("title") or ""),
            "\n".join(points),
            str(payload.get("detail") or ""),
            str(payload.get("reviews") or ""),
        ]
    )


# --------------------------------------------------------------------------- 单项检查


def _issue(code: str, dim: str, severity: str, evidence: str = "", **params: Any) -> Dict[str, Any]:
    return {
        "id": code,
        "dim": dim,
        "severity": severity,
        "evidence": (evidence or "")[:120],
        "params": params,
    }


def _dup_word(text: str, size: int = 3, times: int = 3) -> Optional[str]:
    """找出在标题里被重复 ≥times 次的 n-gram（关键词堆砌/复读）。"""
    compact = _compact(text)
    seen: Dict[str, int] = {}
    for i in range(0, len(compact) - size + 1):
        gram = compact[i : i + size]
        if len(set(gram)) == 1:  # 「啊啊啊」不算有效词
            continue
        seen[gram] = seen.get(gram, 0) + 1
        if seen[gram] >= times:
            return gram
    return None


def _check_title(title: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    compact = _compact(title)
    if not compact:
        return [_issue("title.empty", "title", "high")]

    length = len(compact)
    if length < TITLE_MIN:
        issues.append(_issue("title.too_short", "title", "high", title, length=length, min=TITLE_MIN))
    elif length > TITLE_MAX:
        issues.append(_issue("title.too_long", "title", "low", title, length=length, max=TITLE_MAX))

    if not _NUM_TOKEN_RE.search(title):
        issues.append(_issue("title.no_number", "title", "medium", title))

    dup = _dup_word(title)
    if dup:
        issues.append(_issue("title.duplicate_words", "title", "medium", title, word=dup))

    if len(_SYMBOL_NOISE_RE.findall(title)) >= 3:
        issues.append(_issue("title.symbol_noise", "title", "low", title))

    return issues


def _has_benefit(point: str) -> bool:
    return _hit(point, BENEFIT_MARKERS) is not None


def _check_points(points: Sequence[str]) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    count = len(points)
    if count < POINTS_MIN:
        return [_issue("points.few", "points", "high", "", count=count, min=POINTS_MIN)]

    if count > POINTS_MAX:
        issues.append(_issue("points.many", "points", "low", "", count=count, max=POINTS_MAX))

    weak = [p for p in points if not _has_benefit(p)]
    if weak and len(weak) * 2 > count:
        issues.append(
            _issue("points.no_benefit", "points", "high", weak[0], count=len(weak), total=count)
        )

    norms = [_compact(p) for p in points]
    dupes = len(norms) - len(set(norms))
    if dupes:
        issues.append(_issue("points.duplicate", "points", "medium", "", count=dupes))

    return issues


def _check_trust(payload: Mapping[str, Any], text: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    checks = (
        ("material", "trust.no_material", "medium", MATERIAL_WORDS),
        ("proof", "trust.no_proof", "high", PROOF_WORDS),
        ("after_sale", "trust.no_after_sale", "high", AFTER_SALE_WORDS),
        ("shipping", "trust.no_shipping", "medium", SHIPPING_WORDS),
    )
    for flag, code, severity, words in checks:
        if not _present(payload, flag, text, words):
            issues.append(_issue(code, "trust", severity))
    return issues


def _check_pricing(payload: Mapping[str, Any], text: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    if not payload.get("price_cents"):
        issues.append(_issue("price.missing", "pricing", "medium"))
    if not _present(payload, "anchor", text, ANCHOR_WORDS):
        issues.append(_issue("price.no_anchor", "pricing", "medium"))
    if not _present(payload, "bundle", text, BUNDLE_WORDS):
        issues.append(_issue("price.no_bundle", "pricing", "low"))
    return issues


def _check_conversion(payload: Mapping[str, Any], text: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    has_cta = _present(payload, "cta", text, CTA_WORDS)
    if not has_cta:
        vague = _hit(text, VAGUE_CTA_WORDS)
        if vague:
            issues.append(_issue("cta.vague", "conversion", "medium", vague, word=vague))
        else:
            issues.append(_issue("cta.missing", "conversion", "high"))
    if not _present(payload, "contact", text, CONTACT_WORDS):
        issues.append(_issue("cta.no_contact", "conversion", "medium"))
    if _hit(text, OPTION_WORDS) is None:
        issues.append(_issue("cta.no_options", "conversion", "low"))
    return issues


def _check_compliance(text: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    for code, severity, words in (
        ("compliance.absolute", "high", ABSOLUTE_WORDS),
        ("compliance.efficacy", "high", EFFICACY_WORDS),
        ("compliance.guarantee", "medium", GUARANTEE_WORDS),
    ):
        hit = _hit(text, words)
        if hit:
            count = sum(1 for w in words if w.lower() in text.lower())
            issues.append(_issue(code, "compliance", severity, hit, word=hit, count=count))

    if category in CATEGORY_RULES:
        for code, severity, words in CATEGORY_RULES[category]:
            hit = _hit(text, words)
            if hit:
                count = sum(1 for w in words if w.lower() in text.lower())
                issues.append(
                    _issue(
                        code,
                        "compliance",
                        severity,
                        hit,
                        word=hit,
                        count=count,
                        category=category,
                        category_label=CATEGORY_LABELS.get(category, category),
                    )
                )
    return issues


# --------------------------------------------------------------------------- 评分


def _score_dim(issues: Sequence[Mapping[str, Any]]) -> int:
    score = 100
    for item in issues:
        score -= SEVERITY_DEDUCT.get(str(item.get("severity")), 0)
    return max(0, min(100, score))


def _grade(total: int) -> str:
    for floor, name in GRADE_BANDS:
        if total >= floor:
            return name
    return "risky"


# --------------------------------------------------------------------------- 改写建议


def _primary_name(title: str) -> str:
    """从标题里取「品名候选」：切掉符号与促销词，保留前一段。"""
    cleaned = _SYMBOL_NOISE_RE.sub("", title or "").strip()
    head = re.split(r"[|｜/、,，·\-—\s]+", cleaned)[0] if cleaned else ""
    return head[:16] or ""


def _build_title_plan(title: str, points: Sequence[str], text: str, payload: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """三个「填空式」标题骨架：只拼用户自己写过的词，缺的段位留空并报给前端。"""
    name = _primary_name(title)
    spec_match = _NUM_TOKEN_RE.search(text)
    spec = spec_match.group(0).strip() if spec_match else ""
    benefit = ""
    for point in points:
        if _has_benefit(point):
            benefit = re.split(r"[，,。；;]", point)[0].strip()[:14]
            break
    scene = ""
    for word in SCENE_WORDS:
        if word in text:
            scene = word
            break
    trust = "7天无理由" if _present(payload, "after_sale", text, AFTER_SALE_WORDS) else ""

    slots: List[Dict[str, Any]] = [
        {"key": "feature_first", "order": ["name", "benefit", "spec"]},
        {"key": "scene_first", "order": ["scene", "name", "spec", "trust"]},
        {"key": "trust_first", "order": ["name", "spec", "trust", "benefit"]},
    ]
    values = {"name": name, "benefit": benefit, "spec": spec, "scene": scene, "trust": trust}

    plan: List[Dict[str, Any]] = []
    for slot in slots:
        parts = [(k, values[k]) for k in slot["order"]]
        filled = [v for _, v in parts if v]
        missing = [k for k, v in parts if not v]
        plan.append(
            {
                "key": slot["key"],
                # text 只拼已填的段（可直接复制）；空位由前端按语言渲染成占位块，
                # 这样三种骨架在「全部缺项」时也不会撞成同一句。
                "text": "｜".join(filled),
                "parts": [{"slot": k, "value": v} for k, v in parts],
                "missing": missing,
            }
        )
    return plan


def _build_plan(points: Sequence[str], issues: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    """给前端的「待填空」清单：缺什么补什么，不代写内容。"""
    bullet_plan = [
        {"from": point[:60], "needs": "benefit"}
        for point in points
        if not _has_benefit(point)
    ][:3]

    dims = {str(item.get("dim")) for item in issues}
    faq_needs: List[str] = []
    if "trust" in dims:
        for code, need in (
            ("trust.no_proof", "proof"),
            ("trust.no_after_sale", "after_sale"),
            ("trust.no_shipping", "shipping"),
            ("trust.no_material", "material"),
        ):
            if any(item.get("id") == code for item in issues):
                faq_needs.append(need)
    return {"bullets": bullet_plan, "faq": faq_needs[:3]}


# --------------------------------------------------------------------------- 主入口


def analyze(payload: Mapping[str, Any], enhance: Optional[Any] = None) -> Dict[str, Any]:
    """诊断一份商品页，返回结构化报告。

    ``enhance`` 是模型增强层的可选回调：``enhance(payload, report) -> dict``，
    返回的 ``notes``/``suggestions`` 会并入报告，``engine`` 标记为 ``rules+llm``。
    回调抛异常不影响规则结论（降级为纯规则并记录 ``enhance_error``）。
    """
    title = str(payload.get("title") or "").strip()
    points = _as_list(payload.get("points"))
    text = _corpus(payload, points)

    wanted = str(payload.get("category") or "").strip().lower()
    if wanted in CATEGORY_RULES:
        category, category_detected = wanted, False
    elif wanted in ("", "auto"):
        category, category_detected = detect_category(text), True
    else:
        category, category_detected = None, False

    issues: List[Dict[str, Any]] = []
    issues += _check_title(title)
    issues += _check_points(points)
    issues += _check_trust(payload, text)
    issues += _check_pricing(payload, text)
    issues += _check_conversion(payload, text)
    issues += _check_compliance(text, category)

    by_dim = {dim: [i for i in issues if i["dim"] == dim] for dim in DIM_ORDER}
    dim_scores = {dim: _score_dim(by_dim[dim]) for dim in DIM_ORDER}

    total = int(round(sum(dim_scores[d] * DIM_WEIGHTS[d] for d in DIM_ORDER)))
    compliance_blocked = any(
        i["dim"] == "compliance" and i["severity"] == "high" for i in issues
    )
    if compliance_blocked:
        total = min(total, COMPLIANCE_SCORE_CAP)

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: (severity_rank.get(str(i["severity"]), 3), DIM_ORDER.index(i["dim"])))

    report: Dict[str, Any] = {
        "version": 1,
        "engine": "rules",
        "category": {
            "key": category,
            "label": CATEGORY_LABELS.get(category) if category else None,
            "detected": bool(category_detected and category),
        },
        "score": {
            "total": total,
            "grade": _grade(total),
            "dimensions": [
                {
                    "key": dim,
                    "score": dim_scores[dim],
                    "weight": DIM_WEIGHTS[dim],
                    "issues": len(by_dim[dim]),
                }
                for dim in DIM_ORDER
            ],
        },
        "gates": {
            "can_list": not compliance_blocked,
            "blocked_by": [i["id"] for i in issues if i["dim"] == "compliance" and i["severity"] == "high"],
            "score_cap": COMPLIANCE_SCORE_CAP if compliance_blocked else None,
        },
        "issues": issues,
        "titles": _build_title_plan(title, points, text, payload),
        "plan": _build_plan(points, issues),
        "counts": {
            "issues": len(issues),
            "high": sum(1 for i in issues if i["severity"] == "high"),
            "medium": sum(1 for i in issues if i["severity"] == "medium"),
            "low": sum(1 for i in issues if i["severity"] == "low"),
        },
    }

    if enhance is not None:
        try:
            extra = enhance(payload, report) or {}
            notes = extra.get("notes") or []
            if notes:
                report["notes"] = list(notes)
            suggestions = extra.get("suggestions") or []
            if suggestions:
                report["suggestions"] = list(suggestions)
            report["engine"] = "rules+llm"
        except Exception as exc:  # noqa: BLE001 — 增强失败不能连累规则结论
            report["enhance_error"] = f"{type(exc).__name__}: {exc}"

    return report
