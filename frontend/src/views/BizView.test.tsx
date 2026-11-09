/**
 * BizView 烟测：能渲染不崩（默认总览标签页）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BizView } from "./BizView";
import { stubFetchEmpty } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BizView", () => {
  it("挂载渲染出 section 容器", () => {
    stubFetchEmpty();
    const { container } = render(<BizView />);
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("渲染出总览相关标签", () => {
    stubFetchEmpty();
    render(<BizView />);
    expect(document.body.textContent).toMatch(/总览|商品|销售|加载中|暂无/);
  });
});
