/**
 * chat-api.ts 测试：apiFetch 鉴权头 / 401 全局处理 / ApiError 结构（mock fetch）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, setUnauthorizedHandler } from "./chat-api";

function mockFetchOnce(init: { ok?: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.body ?? {},
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  window.localStorage.clear();
});

describe("apiFetch", () => {
  it("有 token 时带 Authorization 头", async () => {
    window.localStorage.setItem("sf_auth_token", "tok-123");
    // 重新导入以刷新 auth 模块快照
    vi.resetModules();
    const mod = await import("./chat-api");
    const fetchFn = mockFetchOnce({ body: { ok: 1 } });
    await mod.apiFetch("/api/ping");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("字符串 body 自动补 Content-Type", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    const fetchFn = mockFetchOnce({ body: {} });
    await mod.apiFetch("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("显式 Content-Type 不被覆盖", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    const fetchFn = mockFetchOnce({ body: {} });
    await mod.apiFetch("/api/x", { method: "POST", body: "raw", headers: { "Content-Type": "text/plain" } });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
  });

  it("401 触发全局处理器并抛 ApiError(401)", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    mockFetchOnce({ ok: false, status: 401, body: { error: { code: "UNAUTHORIZED", message: "登录已过期" } } });
    await expect(mod.apiFetch("/api/secret")).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("非 401 错误不触发全局处理器", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    mockFetchOnce({ ok: false, status: 500, body: { error: { code: "BOOM", message: "炸了" } } });
    await expect(mod.apiFetch("/api/x")).rejects.toMatchObject({ status: 500, code: "BOOM" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("从 detail.error 提取错误码", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    mockFetchOnce({ ok: false, status: 422, body: { detail: { error: { code: "VALIDATION", message: "参数错误" } } } });
    await expect(mod.apiFetch("/api/x")).rejects.toMatchObject({ code: "VALIDATION", message: "参数错误" });
  });

  it("无结构化错误时回落到 HTTP_<status>", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    mockFetchOnce({ ok: false, status: 418, body: null });
    await expect(mod.apiFetch("/api/x")).rejects.toMatchObject({ code: "HTTP_418" });
  });

  it("成功时返回 JSON body", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    mockFetchOnce({ body: { hello: "world" } });
    await expect(mod.apiFetch("/api/x")).resolves.toEqual({ hello: "world" });
  });
});

describe("ApiError", () => {
  it("字段与 name 正确", () => {
    const err = new ApiError(403, "FORBIDDEN", "无权限");
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("无权限");
    expect(err.name).toBe("ApiError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("setUnauthorizedHandler", () => {
  it("返回的注销函数能清空处理器", async () => {
    vi.resetModules();
    const mod = await import("./chat-api");
    const handler = vi.fn();
    const off = mod.setUnauthorizedHandler(handler);
    off();
    mockFetchOnce({ ok: false, status: 401, body: {} });
    await expect(mod.apiFetch("/api/x")).rejects.toBeInstanceOf(Error);
    expect(handler).not.toHaveBeenCalled();
  });
});
