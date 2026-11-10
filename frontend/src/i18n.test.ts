/**
 * i18n.test.ts — Agent 副标题双语（2026-11-10）。
 *
 * 事故背景：侧栏「项目与 Agent」此前把 `agent.soul`（**系统提示词**）当介绍直接
 * 截断显示，切到英文后仍是一屏中文 —— 既没翻译，又把内部提示词漏给了用户。
 * 现改为结构化摘要 `部门 · 职责`，由 `agentSubtitle` 按当前语言渲染。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSubtitle, translate } from "./i18n";
import { resetPrefs, writePrefs } from "./settings-prefs";

const zh = (s: string) => s;

beforeEach(() => {
  resetPrefs();
});

afterEach(() => {
  resetPrefs();
});

describe("agentSubtitle", () => {
  it("中文：部门 · 职责", () => {
    expect(agentSubtitle("市场分析师", zh)).toBe("市场研究部 · 目标用户、市场、竞品和需求分析");
  });

  it("英文：词条命中则整体英文化", () => {
    writePrefs({ locale: "en-US" });
    expect(agentSubtitle("市场分析师", translate)).toBe(
      "Market research · Target users, market, competitors and needs",
    );
  });

  it("六个部门岗位都有副标题且互不相同", () => {
    const names = ["市场分析师", "品牌策划师", "内容策划师", "合规审核员", "运营专员", "商务专员"];
    const subs = names.map((n) => agentSubtitle(n, zh));
    expect(subs.every((s) => s.length > 3)).toBe(true);
    expect(new Set(subs).size).toBe(names.length);
  });

  it("总经理 / CEO 走管理层口径", () => {
    writePrefs({ locale: "en-US" });
    expect(agentSubtitle("总经理", translate)).toBe("Leadership · Orchestration and decisions");
    expect(agentSubtitle("AI 总经理 CEO", translate)).toBe(
      "Leadership · Orchestration and decisions",
    );
  });

  it("自建 Agent 兜底为中性词，不漏中文提示词", () => {
    writePrefs({ locale: "en-US" });
    expect(agentSubtitle("我的自定义助手", translate)).toBe("Custom agent");
    expect(agentSubtitle(undefined, translate)).toBe("Custom agent");
  });

  it("名字两端空白不影响命中", () => {
    expect(agentSubtitle(" 运营专员 ", zh)).toBe("电商运营部 · 商品资料、上架准备、店铺运营支持");
  });
});
