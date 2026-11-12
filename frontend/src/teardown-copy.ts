/**
 * 商品页诊断 —— 问题码 → 文案（中文原文即 key）。
 *
 * 后端只回结构化码（`title.too_short` + `{len, min}`），文案全在这里，
 * 渲染时统一过 `tn(copy.title, params)`，所以英文界面不会漏出中文结论。
 *
 * 约束：本表新增/修改中文后，`teardown-copy.test.ts` 会断言 EN 字典里
 * 一定存在对应词条——漏了会红，不会静默退回中文。
 */

export type IssueSeverity = "high" | "medium" | "low";

export type IssueDim =
  | "title"
  | "points"
  | "trust"
  | "pricing"
  | "conversion"
  | "compliance";

export interface IssueCopy {
  /** 问题是什么（可含 {len} {word} 等占位符）。 */
  title: string;
  /** 具体怎么改 —— 必须是可执行动作，不写空话。 */
  fix: string;
}

/** 六个诊断维度：key 与后端 `score.dimensions[].key` 一一对应。 */
export const DIM_LABEL: Record<IssueDim, string> = {
  title: "标题力",
  points: "卖点结构",
  trust: "信任状",
  pricing: "价格锚点",
  conversion: "转化路径",
  compliance: "合规风险",
};

export const DIM_ORDER: IssueDim[] = [
  "title",
  "points",
  "trust",
  "pricing",
  "conversion",
  "compliance",
];

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  high: "致命",
  medium: "次要",
  low: "打磨",
};

export const GRADE_LABEL: Record<string, string> = {
  excellent: "优秀",
  good: "良好",
  needs_work: "待改",
  risky: "危险",
};

/** 标题骨架缺哪一段（后端 `titles[].missing`）。 */
export const SLOT_LABEL: Record<string, string> = {
  name: "品名",
  benefit: "利益点",
  spec: "规格",
  scene: "场景",
  trust: "信任状",
};

/** 待填空的诉求（后端 `plan.bullets[].needs` 与 `plan.faq[]`）。 */
export const NEED_LABEL: Record<string, string> = {
  benefit: "补一句「对你有什么用」",
  proof: "补一条可核验的证据",
  after_sale: "补售后承诺",
  shipping: "补发货时效",
  material: "补材质或工艺",
};

/** 问题码 → 文案。key 必须与 `listing_doctor.py` 里 `_issue()` 的第一参完全一致。 */
export const ISSUE_COPY: Record<string, IssueCopy> = {
  // ── 标题力 ─────────────────────────────────────────────────────────────
  "title.empty": {
    title: "标题是空的",
    fix: "至少写清「是什么 + 给谁用 + 一个规格」，三个信息缺一个都会掉搜索命中。",
  },
  "title.too_short": {
    title: "标题只有 {length} 字，搜索词挤不进去（建议 {min} 字以上）",
    fix: "按「品名 + 关键规格 + 场景或人群」重写，把买家用得到的那几个词放进去。",
  },
  "title.too_long": {
    title: "标题 {length} 字，超出常见截断长度（{max} 字内更稳）",
    fix: "把最不重要的形容词删到详情里，标题只留能被搜到的实词。",
  },
  "title.no_number": {
    title: "标题里没有任何数字或规格",
    fix: "把尺寸、容量、数量或时长写进标题——数字是单位字数里最省的说服力。",
  },
  "title.duplicate_words": {
    title: "标题里「{word}」重复出现",
    fix: "删掉重复词，把位置让给场景和规格；重复不影响搜索权重，只浪费字数。",
  },
  "title.symbol_noise": {
    title: "标题堆了过多符号或表情",
    fix: "符号最多留 1 个，其余换成实词——平台搜索不认符号，买家也不认。",
  },

  // ── 卖点结构 ───────────────────────────────────────────────────────────
  "points.few": {
    title: "卖点只有 {count} 条，撑不起说服（建议 {min} 条起）",
    fix: "按「功能 / 信任 / 场景」各补一条，三块齐了才有人愿意往下看。",
  },
  "points.many": {
    title: "卖点 {count} 条，注意力被分散了（建议 {max} 条内）",
    fix: "只留最能决定下单的 5 条，其余挪进详情页，首屏不要超过一屏。",
  },
  "points.no_benefit": {
    title: "{count}/{total} 条卖点只写了参数，没写对买家有什么用",
    fix: "每条后面补半句「所以你能……」，参数是理由，利益才是买点。",
  },
  "points.duplicate": {
    title: "有 {count} 条卖点内容重复",
    fix: "把重复项合并成一条，省下的位置写真正的差异点。",
  },

  // ── 信任状 ─────────────────────────────────────────────────────────────
  "trust.no_material": {
    title: "没写材质、成分或工艺",
    fix: "买家第一反应是「这是什么东西做的」，一句话交代清楚，别让他猜。",
  },
  "trust.no_proof": {
    title: "没有任何证据：检测、资质、实拍、口碑都没有",
    fix: "至少放一条可核验的证据；一张实拍图比三个形容词有用。",
  },
  "trust.no_after_sale": {
    title: "没写售后承诺",
    fix: "写清退换条件与破损补发——这是压掉最后一点犹豫的那句话。",
  },
  "trust.no_shipping": {
    title: "没写发货时效或物流方式",
    fix: "写明「几点前下单当天发」「包不包邮」，很多人是因为不确定才不买。",
  },

  // ── 价格锚点 ───────────────────────────────────────────────────────────
  "price.missing": {
    title: "没填价格",
    fix: "填上到手价，诊断才能判断锚点是否成立（不填这一项只影响价格维度）。",
  },
  "price.no_anchor": {
    title: "只有单一价格，没有对比锚点",
    fix: "给原价 / 到手价，或做两档套餐——没有对比，「便宜」就不成立。",
  },
  "price.no_bundle": {
    title: "没提赠品或包邮",
    fix: "加一个小额赠品（贺卡、备用件）或标出包邮，感知价值远高于成本。",
  },

  // ── 转化路径 ───────────────────────────────────────────────────────────
  "cta.missing": {
    title: "没有明确的行动指令",
    fix: "结尾加一句「点下方立即下单」。不写这一句，很多人看完就走。",
  },
  "cta.vague": {
    title: "只有「{word}」这类模糊指令",
    fix: "换成具体动作：立即下单 / 私信报尺寸 / 扫码领券，一步到位。",
  },
  "cta.no_contact": {
    title: "没留联系方式",
    fix: "定制类商品必须留私信或客服入口，否则想买的人找不到你。",
  },
  "cta.no_options": {
    title: "没写可选规格（颜色 / 尺寸 / 款式）",
    fix: "列出可选档位，买家会自己对号入座，减少来回问价。",
  },

  // ── 合规风险 ───────────────────────────────────────────────────────────
  "compliance.absolute": {
    title: "出现极限词「{word}」",
    fix: "广告法禁止最高级表述，换成可核验的具体描述（材质、参数、实测数据）。",
  },
  "compliance.efficacy": {
    title: "出现功效宣称「{word}」",
    fix: "普通商品不能宣称疗效，删掉或改成使用体验描述，否则有下架风险。",
  },
  "compliance.guarantee": {
    title: "出现绝对承诺「{word}」",
    fix: "改成有条件承诺，例如「非人为损坏 7 天内可退」，比空头保证更可信。",
  },
};

/** 问题码在文案表里是否存在（后端加新码时，前端要同步补文案）。 */
export function issueCopy(code: string): IssueCopy | undefined {
  return ISSUE_COPY[code];
}

/**
 * 「示例」按钮的预填内容：故意做成一份**卖不动**的商品页，
 * 让用户第一次点诊断就能看见具体的改造清单，而不是看空表格。
 * （放在本文件而不是视图里：这是数据，不该被 i18n 漏包扫描当成界面文案。）
 */
export const SAMPLE_LISTING = {
  title: "小兔子玩偶",
  points: "很可爱的兔子\n纯手工做的好东西\n买就送",
  detail: "自己做的，质量很好，喜欢可以联系我。全网最低价，错过就没了。",
  price: "39",
};
