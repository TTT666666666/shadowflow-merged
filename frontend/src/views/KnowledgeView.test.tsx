/**
 * KnowledgeView 烟测：能渲染不崩，加载态可见。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KnowledgeView } from "./KnowledgeView";
import { stubFetchEmpty } from "./test-utils";
import { vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("KnowledgeView", () => {
  it("挂载后渲染出知识库标题", () => {
    stubFetchEmpty();
    const { container } = render(<KnowledgeView />);
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.textContent).toBeTruthy();
  });

  it("空数据下不抛异常且显示加载/空态文案", () => {
    stubFetchEmpty();
    render(<KnowledgeView />);
    // 加载中或空态至少有一个可见文案
    expect(document.body.textContent).toMatch(/加载中|暂无|知识|包/);
  });
});
