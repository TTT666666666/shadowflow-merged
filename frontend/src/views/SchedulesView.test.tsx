/**
 * SchedulesView 烟测：能渲染不崩。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SchedulesView } from "./SchedulesView";
import { stubFetchEmpty } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SchedulesView", () => {
  it("挂载渲染出 section 容器", () => {
    stubFetchEmpty();
    const { container } = render(<SchedulesView />);
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("空数据下无异常且渲染时间表相关文案", () => {
    stubFetchEmpty();
    render(<SchedulesView />);
    expect(document.body.textContent).toMatch(/定时|计划|时间表|暂无|加载中/);
  });
});
