/**
 * AgentsView 烟测：能渲染不崩。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AgentsView } from "./AgentsView";
import { stubFetchEmpty } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentsView", () => {
  it("挂载渲染出 section 容器", () => {
    stubFetchEmpty();
    const { container } = render(<AgentsView />);
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("空数据下渲染团队/员工相关文案", () => {
    stubFetchEmpty();
    render(<AgentsView />);
    expect(document.body.textContent).toMatch(/团队|员工|Agent|加载中|暂无/);
  });
});
