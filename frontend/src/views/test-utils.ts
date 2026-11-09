/**
 * 视图烟测公共设施：浏览器 API 桩 + 全局 fetch stub。
 */
import { vi } from "vitest";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** jsdom 缺 ResizeObserver / IntersectionObserver（真实浏览器才有的 API），组件挂载时会用到。 */
export function stubBrowserApis() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.ResizeObserver) g.ResizeObserver = NoopObserver;
  if (!g.IntersectionObserver) g.IntersectionObserver = NoopObserver;
  if (!g.matchMedia) {
    g.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
}

export function stubFetchEmpty() {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function stubFetchData(body: unknown) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
