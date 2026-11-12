/**
 * 改前改后对比视图测试。
 *
 * 判定在后端，这里只锁三件前端必须做对的事：
 * 1. 示例按钮要能一次填好两侧，否则用户看不出这页是干嘛的；
 * 2. 结果要把「涨了多少分、哪些问题被改掉」摆出来，不能只给一个总分；
 * 3. 没填东西时按钮必须不可点，别让用户提交空请求后看到报错。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import TeardownCompare from "./TeardownCompare";
import { stubBrowserApis } from "./test-utils";

stubBrowserApis();

interface FixtureIssue {
  id: string;
  dim: string;
  severity: string;
  evidence: string;
  params: Record<string, string | number>;
}

interface CompareFixture {
  delta: {
    total: { before: number; after: number; delta: number };
    grade: { before: string; after: string };
    can_list: { before: boolean; after: boolean };
    resolved: FixtureIssue[];
    remaining: FixtureIssue[];
    regressed: FixtureIssue[];
    dimensions: { key: string; before: number; after: number; delta: number }[];
  };
}

const COMPARE: CompareFixture = {
  delta: {
    total: { before: 37, after: 88, delta: 51 },
    grade: { before: "risky", after: "excellent" },
    can_list: { before: false, after: true },
    resolved: [
      { id: "compliance.absolute", dim: "compliance", severity: "high", evidence: "全网最低价", params: { word: "全网最低价", count: 1 } },
      { id: "title.too_short", dim: "title", severity: "high", evidence: "小兔子玩偶", params: { length: 5, min: 12 } },
    ],
    remaining: [
      { id: "trust.no_proof", dim: "trust", severity: "high", evidence: "", params: {} },
    ],
    regressed: [],
    dimensions: [
      { key: "title", before: 75, after: 100, delta: 25 },
      { key: "points", before: 75, after: 100, delta: 25 },
      { key: "trust", before: 50, after: 100, delta: 50 },
      { key: "pricing", before: 100, after: 100, delta: 0 },
      { key: "conversion", before: 88, after: 100, delta: 12 },
      { key: "compliance", before: 0, after: 100, delta: 100 },
    ],
  },
};

function stubCompare(payload: CompareFixture = COMPARE) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/teardown/compare") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => payload };
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

describe("TeardownCompare", () => {
  it("未填内容时对比按钮不可点", () => {
    stubCompare();
    const { container } = render(<TeardownCompare />);
    const run = container.querySelector(".sf-doctor-run") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(container.querySelector(".sf-cmp-result")).toBeNull();
  });

  it("示例一次填好两侧，点对比后渲染分差与已解决清单", async () => {
    const fetchMock = stubCompare();
    const { container } = render(<TeardownCompare />);

    const sample = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("示例"),
    ) as HTMLButtonElement;
    fireEvent.click(sample);
    // 两侧都被填上：标题非空
    const inputs = container.querySelectorAll(".sf-cmp-side input");
    expect((inputs[0] as HTMLInputElement).value.length).toBeGreaterThan(0);

    fireEvent.click(container.querySelector(".sf-doctor-run") as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector(".sf-cmp-result")).not.toBeNull());

    const body = fetchMock.mock.calls[0];
    const sent = JSON.parse(String((body[1] as RequestInit).body));
    // 两侧共用同一口径：类目与平台必须一致，否则分差没有意义
    expect(sent.before.category).toBe(sent.after.category);
    expect(sent.before.platform).toBe(sent.after.platform);

    const delta = container.querySelector(".sf-cmp-delta");
    expect(delta?.textContent).toContain("51");
    expect(delta?.className).toContain("up");

    expect(container.querySelector(".sf-cmp-gate")?.textContent).toContain("现在可以上架");
    // 已解决 2 条、仍存在 1 条、新增 0 条
    const lists = container.querySelectorAll(".sf-cmp-list");
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].querySelectorAll("li")).toHaveLength(1);
    expect(lists[2].textContent).toContain("无");
  });

  it("分数下降时用下降样式，不报喜", async () => {
    stubCompare({
      delta: {
        ...COMPARE.delta,
        total: { before: 88, after: 61, delta: -27 },
        can_list: { before: true, after: false },
        resolved: [],
        regressed: [
          { id: "compliance.absolute", dim: "compliance", severity: "high", evidence: "全网最低价", params: { word: "全网最低价", count: 1 } },
        ],
      },
    });
    const { container } = render(<TeardownCompare />);
    const sample = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("示例"),
    ) as HTMLButtonElement;
    fireEvent.click(sample);
    fireEvent.click(container.querySelector(".sf-doctor-run") as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector(".sf-cmp-result")).not.toBeNull());

    const delta = container.querySelector(".sf-cmp-delta");
    expect(delta?.className).toContain("down");
    expect(container.querySelector(".sf-cmp-gate")?.textContent).toContain("现在不行了");
    const lists = container.querySelectorAll(".sf-cmp-list");
    expect(lists[2].querySelectorAll("li")).toHaveLength(1);
  });
});
