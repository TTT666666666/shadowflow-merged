/**
 * 批量诊断视图测试：示例表格、批次结果、脏行标记、跳转单条详情。
 * 判定逻辑在后端，这里只验证「结果有没有被正确呈现出来」。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TeardownBatch } from "./TeardownBatch";
import { TeardownView } from "./TeardownView";
import { stubBrowserApis } from "./test-utils";

stubBrowserApis();

const BATCH = {
  batch_id: "tb-abc123",
  created_at: "2026-11-12T06:00:00Z",
  label: "双十一上架前自检",
  brand: "星火工作室",
  summary: { total: 3, ok: 2, failed: 1, avg_total: 62.5, blocked: 1, high: 4 },
  items: [
    {
      row: 1,
      title: "手工钩织小兔 18cm",
      report_id: "td-1",
      ok: true,
      total: 88,
      grade: "excellent",
      can_list: true,
      high: 0,
      issues: 1,
      top_issues: ["trust.no_proof"],
    },
    {
      row: 2,
      title: "小兔子玩偶",
      report_id: "td-2",
      ok: true,
      total: 37,
      grade: "risky",
      can_list: false,
      high: 4,
      issues: 8,
      top_issues: ["compliance.absolute", "title.too_short"],
    },
    { row: 3, title: "x".repeat(300), ok: false, error: "字段过长" },
  ],
};

function stubRouted() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/teardown/batches?limit")) {
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
    }
    if (url.includes("/api/teardown/batch") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => BATCH };
    }
    if (url.includes("/api/teardown/batches/")) {
      return { ok: true, status: 200, json: async () => BATCH };
    }
    if (url.includes("/api/teardown/reports")) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
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

describe("TeardownBatch", () => {
  it("默认渲染表单与空态，未提交时不显示结果表", () => {
    stubRouted();
    const { container } = render(<TeardownBatch />);
    expect(container.querySelector(".sf-batch-form")).not.toBeNull();
    expect(container.querySelector(".sf-batch-table")).toBeNull();
  });

  it("填入示例表格把 CSV 放进输入框", () => {
    stubRouted();
    const { container } = render(<TeardownBatch />);
    const fill = container.querySelector(".sf-batch-tools button") as HTMLButtonElement;
    fireEvent.click(fill);
    const area = container.querySelector(".sf-batch-form textarea") as HTMLTextAreaElement;
    expect(area.value).toContain("标题,卖点,详情,价格,已有素材");
    expect(area.value.split("\n").length).toBeGreaterThan(2);
  });

  it("空内容直接提交会给出提示，不发请求", () => {
    const fetchMock = stubRouted();
    const { container } = render(<TeardownBatch />);
    fireEvent.click(container.querySelector(".sf-doctor-run") as HTMLButtonElement);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/请粘贴|upload/i);
    expect(fetchMock.mock.calls.some((c) => String(c[1] ?? "").includes("POST"))).toBe(false);
  });

  it("跑完批次渲染汇总、逐行结果、合规门禁与罚单敞口", async () => {
    stubRouted();
    const { container, getByText } = render(<TeardownBatch />);
    fireEvent.click(container.querySelector(".sf-batch-tools button") as HTMLButtonElement);
    fireEvent.click(container.querySelector(".sf-doctor-run") as HTMLButtonElement);

    await waitFor(() => {
      expect(container.querySelector(".sf-batch-table")).not.toBeNull();
    });
    expect(container.querySelectorAll(".sf-batch-table tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll(".sf-batch-gate.blocked")).toHaveLength(2);
    // 1 条被拦 × 2 万 = 20,000，必须换算成钱展示
    expect(getByText(/20,000/)).toBeTruthy();
    expect(container.querySelector(".sf-batch-brand")?.textContent).toBe("星火工作室");
    expect(container.querySelector(".sf-batch-exports")?.textContent).toMatch(/导出 CSV|Export CSV/);
    // 脏行标失败，不冒充成功结果
    expect(container.querySelector(".sf-batch-table tr.failed")).not.toBeNull();
    expect((container.querySelector(".sf-doctor-run") as HTMLButtonElement).textContent).toMatch(
      /开始批量诊断|Run batch diagnosis/,
    );
  });

  it("点查看把 report_id 交给上层打开单条报告", async () => {
    stubRouted();
    const onOpen = vi.fn();
    const { container } = render(<TeardownBatch onOpenReport={onOpen} />);
    fireEvent.click(container.querySelector(".sf-batch-tools button") as HTMLButtonElement);
    fireEvent.click(container.querySelector(".sf-doctor-run") as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector(".sf-batch-table")).not.toBeNull());
    const view = container.querySelector(".sf-batch-table td button") as HTMLButtonElement;
    fireEvent.click(view);
    expect(onOpen).toHaveBeenCalledWith("td-1");
  });
});

describe("TeardownView 标签页", () => {
  it("默认单条诊断，切到批量诊断后渲染批量面板", () => {
    stubRouted();
    const { container } = render(<TeardownView />);
    expect(container.querySelector(".sf-doctor")).not.toBeNull();
    const tabs = container.querySelectorAll(".sf-doctor-tabs button");
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]);
    expect(container.querySelector(".sf-doctor")).toBeNull();
    expect(container.querySelector(".sf-batch-form")).not.toBeNull();
  });
});
