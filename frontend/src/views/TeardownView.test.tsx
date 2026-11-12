/**
 * 商品诊断视图测试：挂载、示例填充、跑一次诊断后能渲染出结论。
 *
 * 第三条是本轮的真实事故回归 —— 视图曾在 StrictMode 下因为 `mounted` ref
 * 被永久置 false 而丢弃结果（点诊断没反应、按钮卡在「诊断中…」），
 * 后来又在渲染标题骨架时崩成白屏。这两件事都必须被测试拦住。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TeardownView } from "./TeardownView";
import { stubBrowserApis } from "./test-utils";

stubBrowserApis();

const REPORT = {
  version: 1,
  engine: "rules",
  score: {
    total: 59,
    grade: "needs_work",
    dimensions: [
      { key: "title", score: 63, weight: 0.2, issues: 2 },
      { key: "points", score: 75, weight: 0.2, issues: 1 },
      { key: "trust", score: 38, weight: 0.2, issues: 3 },
      { key: "pricing", score: 88, weight: 0.1, issues: 1 },
      { key: "conversion", score: 82, weight: 0.15, issues: 2 },
      { key: "compliance", score: 75, weight: 0.15, issues: 1 },
    ],
  },
  gates: { can_list: false, blocked_by: ["compliance.absolute"], score_cap: 59 },
  issues: [
    {
      id: "title.too_short",
      dim: "title",
      severity: "high",
      evidence: "小兔子玩偶",
      params: { length: 5, min: 12 },
    },
    {
      id: "compliance.absolute",
      dim: "compliance",
      severity: "high",
      evidence: "全网最低价",
      params: { word: "最低价", count: 2 },
    },
  ],
  titles: [
    {
      key: "feature_first",
      text: "小兔子玩偶",
      parts: [
        { slot: "name", value: "小兔子玩偶" },
        { slot: "benefit", value: "" },
        { slot: "spec", value: "" },
      ],
      missing: ["benefit", "spec"],
    },
    {
      key: "trust_first",
      text: "小兔子玩偶",
      parts: [
        { slot: "name", value: "小兔子玩偶" },
        { slot: "spec", value: "" },
        { slot: "trust", value: "" },
      ],
      missing: ["spec", "trust"],
    },
  ],
  plan: { bullets: [{ from: "很可爱的兔子", needs: "benefit" }], faq: ["proof"] },
  counts: { issues: 2, high: 2, medium: 0, low: 0 },
};

function stubRouted() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/teardown/analyze")) {
      return { ok: true, status: 200, json: async () => ({ report_id: "td-1", report: REPORT }) };
    }
    if (url.includes("/api/teardown/reports")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ report_id: "td-1", title: "小兔子玩偶", total: 59 }] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeardownView", () => {
  it("挂载后渲染出标题与表单", () => {
    stubRouted();
    const { container } = render(<TeardownView />);
    expect(container.querySelector(".sf-doctor")).not.toBeNull();
    expect(container.querySelectorAll(".sf-doctor-flags label")).toHaveLength(8);
  });

  it("点「示例」把一份卖不动的商品页填进表单", () => {
    stubRouted();
    const { container } = render(<TeardownView />);
    const sample = container.querySelector(".sf-subview-intro button") as HTMLButtonElement;
    fireEvent.click(sample);
    const title = container.querySelector(".sf-doctor-field input") as HTMLInputElement;
    expect(title.value.length).toBeGreaterThan(0);
  });

  it("跑诊断后渲染分数、问题清单与填空式标题（不崩、按钮回位）", async () => {
    stubRouted();
    const { container } = render(<TeardownView />);

    fireEvent.click(container.querySelector(".sf-subview-intro button") as HTMLButtonElement);
    const run = container.querySelector(".sf-doctor-run") as HTMLButtonElement;
    fireEvent.click(run);

    await waitFor(() => {
      expect(container.querySelector(".sf-doctor-grade")).not.toBeNull();
    });
    expect(container.querySelector(".sf-doctor-grade")?.textContent).toBeTruthy();
    expect(container.querySelectorAll(".sf-doctor-issue")).toHaveLength(2);
    // 空位渲染成占位块（而不是三张一模一样的标题卡）
    expect(container.querySelectorAll(".sf-doctor-title-card .slot").length).toBeGreaterThan(0);
    // 合规红线：必须显示「先别上架」而不是「可以上架」
    expect(container.querySelector(".sf-doctor-gate")?.className).toContain("blocked");
    // 按钮从「诊断中…」回到「开始诊断」，否则用户会以为卡死
    expect((container.querySelector(".sf-doctor-run") as HTMLButtonElement).textContent).toMatch(
      /开始诊断|Run diagnosis/,
    );
  });
});
