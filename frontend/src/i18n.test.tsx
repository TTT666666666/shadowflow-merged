/**
 * i18n 运行时 API 单测（2026-11-10）：
 * 「中文原文即 key」这套方案最容易翻车的地方都在插值与回退，不在字典本身。
 *
 * 覆盖四件事：
 * 1. `interpolate` 的具名占位符替换、缺变量保留原样（不吞字符）；
 * 2. 中文环境原样返回（含带 `{}` 的 key 不许被误插值）；
 * 3. 英文环境下 `t/tn/translate/translateN` 各自命中字典 + 插值；
 * 4. 词条缺失时退回中文原文（绝不把 key 泄漏到界面）；
 * 5. `useI18n()` 在切语言后重渲染拿到新文案（订阅 settings-prefs）。
 */

import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EN_DICTIONARY,
  interpolate,
  translate,
  translateN,
  useI18n,
} from "./i18n";
import { resetPrefs, writePrefs } from "./settings-prefs";

/** 真实词条：三个占位符，能同时验证「翻译 + 多变量插值」。 */
const COUNT_KEY = "共 {n} 条 · 待办 {a} 条 · 已完成 {b} 条";

// jsdom 环境默认不开 act 支持，切语言那条用例会刷一条 stderr 噪音。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  resetPrefs();
});

describe("interpolate", () => {
  it("替换具名占位符", () => {
    expect(interpolate("共 {n} 条 · 待办 {a} 条", { n: 5, a: 2 })).toBe("共 5 条 · 待办 2 条");
  });

  it("缺变量时保留占位符原样，不渲染 undefined", () => {
    expect(interpolate("共 {n} 条 · 待办 {a} 条", { n: 5 })).toBe("共 5 条 · 待办 {a} 条");
  });

  it("没传 vars 时原样返回（含 {} 的纯文本不会被吃掉）", () => {
    expect(interpolate("共 {n} 条")).toBe("共 {n} 条");
    expect(interpolate("{")).toBe("{");
  });

  it("同一占位符出现多次全部替换，数字按字面量转字符串", () => {
    expect(interpolate("{n}/{n}", { n: 0 })).toBe("0/0");
  });
});

describe("中文环境（默认）", () => {
  it("translate 原样返回中文", () => {
    expect(translate("对话")).toBe("对话");
  });

  it("translateN 只做插值，不查字典", () => {
    expect(translateN("共 {n} 条", { n: 3 })).toBe("共 3 条");
  });

  it("字典里没有的中文照样返回原文（不会漏 key）", () => {
    expect(translate("这句话尚未翻译")).toBe("这句话尚未翻译");
  });
});

describe("英文环境", () => {
  beforeEach(() => {
    writePrefs({ locale: "en-US" });
  });

  it("translate 命中字典", () => {
    expect(translate("对话")).toBe(EN_DICTIONARY["对话"]);
    expect(translate("对话")).not.toBe("对话");
  });

  it("translateN 先翻译再插值", () => {
    expect(translateN(COUNT_KEY, { n: 7, a: 2, b: 1 })).toBe("7 total · 2 open · 1 done");
  });

  it("词条缺失时退回中文原文", () => {
    expect(translate("这句话尚未翻译")).toBe("这句话尚未翻译");
  });

  it("切回中文后立即恢复原文", () => {
    writePrefs({ locale: "zh-CN" });
    expect(translate("对话")).toBe("对话");
  });
});

/** 探针组件：把 useI18n() 的三个返回值都渲染出来，验证订阅与重渲染。 */
function Probe() {
  const { t, tn, isEn } = useI18n();
  return (
    <div>
      <span data-testid="t">{t("对话")}</span>
      <span data-testid="tn">{tn(COUNT_KEY, { n: 4, a: 2, b: 1 })}</span>
      <span data-testid="en">{String(isEn)}</span>
    </div>
  );
}

describe("useI18n", () => {
  it("默认中文，切到 English 后无需刷新即重渲染", () => {
    render(<Probe />);
    expect(screen.getByTestId("t").textContent).toBe("对话");
    expect(screen.getByTestId("en").textContent).toBe("false");

    act(() => {
      writePrefs({ locale: "en-US" });
    });

    expect(screen.getByTestId("t").textContent).toBe(EN_DICTIONARY["对话"]);
    expect(screen.getByTestId("tn").textContent).toBe("4 total · 2 open · 1 done");
    expect(screen.getByTestId("en").textContent).toBe("true");
  });
});
