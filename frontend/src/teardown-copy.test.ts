/**
 * 商品诊断文案表自检。
 *
 * 为什么单独有这个测试：诊断结论是**后端给的码**，文案在 `teardown-copy.ts`，
 * 渲染时走 `tn(copy.title, params)`。这类「变量当 key」的写法静态扫描看不到，
 * 一旦漏翻就会在英文界面里静默露出中文。所以这里做数据级断言：
 *
 * 1. 每个问题码的 title / fix 都有英文词条，且英文确实不等于中文；
 * 2. 维度名、等级、骨架缺位、待补诉求这些 label 同样有词条；
 * 3. 问题码清单与后端 `listing_doctor.py` 实际会产出的码对齐（新增码忘了补文案会红）。
 */
import { describe, expect, it } from "vitest";
import { EN_DICTIONARY } from "./i18n";
import {
  DIM_LABEL,
  GRADE_LABEL,
  ISSUE_COPY,
  NEED_LABEL,
  SEVERITY_LABEL,
  PLATFORM_OPTIONS,
  SLOT_LABEL,
  platformLimits,
} from "./teardown-copy";

const HAN = /[\u4e00-\u9fa5]/;

/**
 * 后端 `shadowflow/services/listing_doctor.py` 里 `_issue()` 会产出的全部码。
 * 引擎加新码时必须同步这里与 ISSUE_COPY，否则界面会退化成显示裸码。
 */
const ENGINE_CODES = [
  "title.empty",
  "title.too_short",
  "title.too_long",
  "title.no_number",
  "title.duplicate_words",
  "title.symbol_noise",
  "points.few",
  "points.many",
  "points.no_benefit",
  "points.duplicate",
  "trust.no_material",
  "trust.no_proof",
  "trust.no_after_sale",
  "trust.no_shipping",
  "price.missing",
  "price.no_anchor",
  "price.no_bundle",
  "cta.missing",
  "cta.vague",
  "cta.no_contact",
  "cta.no_options",
  "compliance.absolute",
  "compliance.efficacy",
  "compliance.guarantee",
  "compliance.promise",
  // 类目专属（2026-11-12）：词库按类目切换，码随类目一起加
  "compliance.food.efficacy",
  "compliance.food.cert",
  "compliance.food.cert_required",
  "compliance.beauty.drug",
  "compliance.beauty.whiten",
  "compliance.beauty.special",
  "compliance.beauty.function",
  "compliance.baby.claim",
  "compliance.medical.claim",
  "compliance.medical.cert",
  // 平台规则（2026-11-12）：跨境平台硬限制与政策违规，码随平台一起加
  "platform.title.too_long",
  "platform.title.emoji",
  "platform.title.caps",
  "platform.title.symbols",
  "platform.bullets.too_many",
  "platform.bullets.too_long",
  "platform.promo",
  "platform.claim",
  "platform.contact",
];

/**
 * 每个码**后端实际会带的参数名**（照抄 `listing_doctor.py` 的 `_issue(..., **params)`）。
 * 文案里的占位符必须是这里面的子集 —— 名字对不上时 `{len}` 会原样漏到界面上，
 * 这个错在中文看不出来、英文里才刺眼，所以必须机器校验。
 */
const ENGINE_PARAMS: Record<string, string[]> = {
  "title.empty": [],
  "title.too_short": ["length", "min"],
  "title.too_long": ["length", "max"],
  "title.no_number": [],
  "title.duplicate_words": ["word"],
  "title.symbol_noise": [],
  "points.few": ["count", "min"],
  "points.many": ["count", "max"],
  "points.no_benefit": ["count", "total"],
  "points.duplicate": ["count"],
  "trust.no_material": [],
  "trust.no_proof": [],
  "trust.no_after_sale": [],
  "trust.no_shipping": [],
  "price.missing": [],
  "price.no_anchor": [],
  "price.no_bundle": [],
  "cta.missing": [],
  "cta.vague": ["word"],
  "cta.no_contact": [],
  "cta.no_options": [],
  "compliance.absolute": ["word", "count"],
  "compliance.efficacy": ["word", "count"],
  "compliance.guarantee": ["word", "count"],
  "compliance.promise": ["word", "count"],
  "compliance.food.efficacy": ["word", "count"],
  "compliance.food.cert": ["word", "count"],
  "compliance.food.cert_required": ["word", "count", "category", "category_label"],
  "compliance.beauty.drug": ["word", "count"],
  "compliance.beauty.whiten": ["word", "count"],
  "compliance.beauty.special": ["word", "count", "category", "category_label"],
  "compliance.beauty.function": ["word", "count"],
  "compliance.baby.claim": ["word", "count"],
  "compliance.medical.claim": ["word", "count"],
  "compliance.medical.cert": ["word", "count"],
  "platform.title.too_long": ["length", "max"],
  "platform.title.emoji": ["count"],
  "platform.title.caps": ["word"],
  "platform.title.symbols": ["chars", "count"],
  "platform.bullets.too_many": ["count", "max"],
  "platform.bullets.too_long": ["row", "length", "max"],
  "platform.promo": ["word"],
  "platform.claim": ["word"],
  "platform.contact": ["kind"],
};

/** 词条存在且真的翻译了（不是把中文原样塞回去）。 */
function expectTranslated(zh: string) {
  const en = EN_DICTIONARY[zh];
  expect(en, `缺英文词条：${zh}`).toBeTruthy();
  expect(HAN.test(String(en)), `英文词条里仍是中文：${zh} → ${en}`).toBe(false);
}

describe("商品诊断文案表", () => {
  it("引擎产出的问题码与文案表一一对齐", () => {
    expect(Object.keys(ISSUE_COPY).sort()).toEqual([...ENGINE_CODES].sort());
  });

  it("每个问题码的标题与改法都有英文", () => {
    for (const [code, copy] of Object.entries(ISSUE_COPY)) {
      expect(copy.title.length, `${code} 缺标题`).toBeGreaterThan(0);
      expect(copy.fix.length, `${code} 缺改法`).toBeGreaterThan(0);
      expectTranslated(copy.title);
      expectTranslated(copy.fix);
    }
  });

  it("维度 / 等级 / 骨架缺位 / 待补诉求的 label 都有英文", () => {
    for (const table of [DIM_LABEL, SEVERITY_LABEL, GRADE_LABEL, SLOT_LABEL, NEED_LABEL]) {
      for (const label of Object.values(table)) expectTranslated(label);
    }
  });

  it("占位符只在英文里有、不丢：带 {len} 的词条英文也带 {len}", () => {
    for (const copy of Object.values(ISSUE_COPY)) {
      const vars = [...copy.title.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (vars.length === 0) continue;
      const en = String(EN_DICTIONARY[copy.title]);
      for (const name of vars) expect(en, `${copy.title} 的英文丢了 {${name}}`).toContain(`{${name}}`);
    }
  });

  it("文案里的占位符必须是后端真会传的参数名（否则 {len} 会原样漏到界面上）", () => {
    for (const [code, copy] of Object.entries(ISSUE_COPY)) {
      const allowed = new Set(ENGINE_PARAMS[code]);
      for (const [, name] of copy.title.matchAll(/\{(\w+)\}/g)) {
        expect(allowed.has(name), `${code} 的文案用了后端不会传的 {${name}}`).toBe(true);
      }
      for (const [, name] of copy.fix.matchAll(/\{(\w+)\}/g)) {
        expect(allowed.has(name), `${code} 的改法用了后端不会传的 {${name}}`).toBe(true);
      }
    }
  });
});

/**
 * 平台下拉的自检：选项文案要有英文，限制值要跟后端一致。
 * 限制值写错不会崩，只会让用户在界面上看到错误的「标题上限」——最难发现的那种错。
 */
describe("平台选项", () => {
  it("每个平台标签都有英文词条", () => {
    for (const opt of PLATFORM_OPTIONS) {
      const en = EN_DICTIONARY[opt.label];
      expect(en, `${opt.label} 缺英文`).toBeTruthy();
      expect(HAN.test(String(en))).toBe(false);
    }
  });

  it("限制值与后端 PLATFORM_LIMITS 对齐（亚马逊 200 字符 / 5 条卖点）", () => {
    expect(platformLimits("generic").titleMax).toBe(60);
    expect(platformLimits("amazon").titleMax).toBe(200);
    expect(platformLimits("amazon").pointsMax).toBe(5);
    expect(platformLimits("tiktok").titleMax).toBe(255);
  });

  it("未知平台回落到通用，不抛错", () => {
    expect(platformLimits("alibaba").key).toBe("generic");
  });
});
