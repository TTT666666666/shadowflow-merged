/**
 * SettingsView 烟测：能渲染不崩（含未登录态）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { stubFetchEmpty } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SettingsView", () => {
  it("未登录态能渲染设置分区", () => {
    stubFetchEmpty();
    const { container } = render(<SettingsView />);
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("渲染出设置相关分区文案", () => {
    stubFetchEmpty();
    render(<SettingsView />);
    expect(document.body.textContent).toMatch(/设置|模型|密钥|账号|加载中/);
  });
});
