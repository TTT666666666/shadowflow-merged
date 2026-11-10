/**
 * settings-prefs 的单元测试（2026-11-10）。
 *
 * 这里只测「读盘容错 + 合并写 + 格式化」三件纯逻辑。样式是否生效属于
 * CSS 层，浏览器里已手工验过（<html data-sf-*> + CSS 变量），不适合塞进 jsdom。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  applyPrefs,
  currentPrefs,
  formatDateTime,
  formatMoney,
  formatNumber,
  readPrefs,
  resetPrefs,
  subscribePrefs,
  writePrefs,
} from "./settings-prefs";

const KEY = "sf.prefs.v1";

beforeEach(() => {
  localStorage.clear();
  resetPrefs();
});

describe("readPrefs", () => {
  it("空存储返回默认值", () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("坏 JSON 不抛错，回落默认值", () => {
    localStorage.setItem(KEY, "{oops");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("越界枚举值逐字段回落，合法字段保留", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ zoom: "huge", accent: "violet", railWidth: 999, hour12: true }),
    );
    const prefs = readPrefs();
    expect(prefs.zoom).toBe(DEFAULT_PREFS.zoom);
    expect(prefs.railWidth).toBe(DEFAULT_PREFS.railWidth);
    expect(prefs.accent).toBe("violet");
    expect(prefs.hour12).toBe(true);
  });

  it("非对象（如数组、字符串）回落默认值", () => {
    localStorage.setItem(KEY, JSON.stringify(["nope"]));
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe("writePrefs", () => {
  it("局部合并并持久化，未传字段保持不变", () => {
    writePrefs({ railWidth: 252, density: "compact" });
    expect(currentPrefs().railWidth).toBe(252);
    expect(currentPrefs().density).toBe("compact");
    expect(currentPrefs().accent).toBe(DEFAULT_PREFS.accent);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({
      railWidth: 252,
      density: "compact",
    });
  });

  it("通知订阅者收到最新值", () => {
    const seen: string[] = [];
    const off = subscribePrefs((prefs) => seen.push(prefs.zoom));
    writePrefs({ zoom: "compact" });
    writePrefs({ zoom: "standard" });
    off();
    writePrefs({ zoom: "compact" });
    expect(seen).toEqual(["compact", "standard"]);
  });

  it("resetPrefs 清掉存储并回到默认", () => {
    writePrefs({ accent: "teal", notifyDesktop: true });
    resetPrefs();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(currentPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe("applyPrefs", () => {
  it("把偏好落到 html 的 data-* 与 CSS 变量上", () => {
    applyPrefs({
      ...DEFAULT_PREFS,
      zoom: "compact",
      accent: "teal",
      density: "compact",
      motion: "reduce",
      railWidth: 196,
      locale: "en-US",
    });
    const root = document.documentElement;
    expect(root.style.zoom).toBe("0.94");
    expect(root.dataset.sfAccent).toBe("teal");
    expect(root.dataset.sfDensity).toBe("compact");
    expect(root.dataset.sfMotion).toBe("reduce");
    expect(root.style.getPropertyValue("--sf-rail-w")).toBe("196px");
    expect(root.lang).toBe("en-US");
  });

  it("标准缩放不写内联 zoom（交给 CSS 默认）", () => {
    applyPrefs({ ...DEFAULT_PREFS, zoom: "standard" });
    expect(document.documentElement.style.zoom).toBe("");
  });
});

describe("格式化", () => {
  it("中文 + 24 小时制", () => {
    const prefs = { ...DEFAULT_PREFS, locale: "zh-CN" as const, hour12: false };
    const text = formatDateTime(new Date(2026, 10, 9, 15, 4), prefs);
    expect(text).toContain("2026");
    expect(text).toContain("15:04");
    expect(text).not.toMatch(/PM|AM/);
  });

  it("英文 + 12 小时制", () => {
    const prefs = { ...DEFAULT_PREFS, locale: "en-US" as const, hour12: true };
    const text = formatDateTime(new Date(2026, 10, 9, 15, 4), prefs);
    expect(text).toMatch(/11\/09\/2026/);
    expect(text).toMatch(/PM/i);
  });

  it("非法时间不抛错，返回占位符", () => {
    expect(formatDateTime("not-a-date", DEFAULT_PREFS)).toBe("—");
    expect(formatDateTime(null, DEFAULT_PREFS)).toBe("—");
  });

  it("金额按分转元并跟随币种", () => {
    expect(formatMoney(128800, { ...DEFAULT_PREFS, currency: "CNY" })).toContain("1,288");
    expect(formatMoney(128800, { ...DEFAULT_PREFS, locale: "en-US", currency: "USD" })).toContain("$");
  });

  it("数字千分位", () => {
    expect(formatNumber(1234567, DEFAULT_PREFS)).toBe("1,234,567");
  });
});
