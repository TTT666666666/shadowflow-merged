/**
 * ProjectsView（MemosView）烟测：能渲染不崩。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemosView } from "./ProjectsView";
import { stubFetchEmpty } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemosView", () => {
  it("挂载渲染出 section 容器", () => {
    stubFetchEmpty();
    const { container } = render(<MemosView />);
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("空数据下渲染备忘相关文案", () => {
    stubFetchEmpty();
    render(<MemosView />);
    expect(document.body.textContent).toMatch(/备忘|memo|暂无|加载中|新建/i);
  });
});
