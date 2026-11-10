/**
 * 全站外观 / 区域 / 通知偏好（2026-11-10）。
 *
 * 为什么落在 localStorage 而不是后端：这些都是「这台设备上的观感」，
 * 多端同步反而会互相打架（手机要紧凑、桌面要宽松）。真正需要跨端一致的
 * 配置（模型密钥、记忆策略）走各自的后端接口，不进这里。
 *
 * applyPrefs 只做一件事：把偏好写到 <html> 的 data-* 属性和 CSS 变量上，
 * 样式侧用 `html[data-sf-*]` 选择器响应。这样切换偏好**不需要** React
 * 重渲染整棵树，也不会出现「内联 style 被组件级 CSS 覆盖」的失灵。
 */

export type SfPrefs = {
  version: 1;
  /** 界面缩放：compact=0.94（一屏多看些），standard=1 */
  zoom: "compact" | "standard";
  /** 左侧栏宽度（px） */
  railWidth: 196 | 224 | 252;
  /** 强调色，落到 --sf-purple */
  accent: "coral" | "violet" | "teal" | "ink";
  /** 动效：reduce 关掉过渡与动画 */
  motion: "full" | "reduce";
  /** 列表密度 */
  density: "comfortable" | "compact";
  /** 区域：影响日期/数字格式与 <html lang> */
  locale: "zh-CN" | "en-US";
  hour12: boolean;
  currency: "CNY" | "USD";
  /** 通知 */
  notifyDesktop: boolean;
  notifySound: boolean;
  notifyOnRunDone: boolean;
  /** 高级：显示内部提示（id、原始状态等） */
  debugHints: boolean;
};

export const DEFAULT_PREFS: SfPrefs = {
  version: 1,
  zoom: "standard",
  railWidth: 224,
  accent: "coral",
  motion: "full",
  density: "comfortable",
  locale: "zh-CN",
  hour12: false,
  currency: "CNY",
  notifyDesktop: false,
  notifySound: false,
  notifyOnRunDone: true,
  debugHints: false,
};

const STORAGE_KEY = "sf.prefs.v1";

/** 白名单式读取：磁盘里可能是旧版本 / 手改坏的 JSON，逐字段校验，坏值回落默认。 */
export function readPrefs(): SfPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFS };
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const src = raw as Partial<SfPrefs>;
  const pick = <K extends keyof SfPrefs>(key: K, allowed: readonly SfPrefs[K][]): SfPrefs[K] =>
    allowed.includes(src[key] as SfPrefs[K]) ? (src[key] as SfPrefs[K]) : DEFAULT_PREFS[key];
  const bool = (key: keyof SfPrefs): boolean =>
    typeof src[key] === "boolean" ? (src[key] as boolean) : (DEFAULT_PREFS[key] as boolean);

  return {
    version: 1,
    zoom: pick("zoom", ["compact", "standard"] as const),
    railWidth: pick("railWidth", [196, 224, 252] as const),
    accent: pick("accent", ["coral", "violet", "teal", "ink"] as const),
    motion: pick("motion", ["full", "reduce"] as const),
    density: pick("density", ["comfortable", "compact"] as const),
    locale: pick("locale", ["zh-CN", "en-US"] as const),
    hour12: bool("hour12"),
    currency: pick("currency", ["CNY", "USD"] as const),
    notifyDesktop: bool("notifyDesktop"),
    notifySound: bool("notifySound"),
    notifyOnRunDone: bool("notifyOnRunDone"),
    debugHints: bool("debugHints"),
  };
}

type Listener = (prefs: SfPrefs) => void;
const listeners = new Set<Listener>();
let cache: SfPrefs | null = null;

/** 当前偏好（带内存缓存，避免每次渲染都 JSON.parse）。 */
export function currentPrefs(): SfPrefs {
  if (!cache) cache = readPrefs();
  return cache;
}

/** 合并写入 + 立即生效 + 通知订阅者。返回合并后的完整偏好。 */
export function writePrefs(patch: Partial<SfPrefs>): SfPrefs {
  const next: SfPrefs = { ...currentPrefs(), ...patch, version: 1 };
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式 / 配额满：内存里仍然生效，只是刷新后丢失 */
  }
  applyPrefs(next);
  for (const fn of listeners) fn(next);
  return next;
}

/** 订阅偏好变化（供需要在 JS 里读偏好的组件用，纯 CSS 响应不需要订阅）。 */
export function subscribePrefs(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 清空全部偏好，回到默认值。 */
export function resetPrefs(): SfPrefs {
  cache = { ...DEFAULT_PREFS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  applyPrefs(cache);
  for (const fn of listeners) fn(cache);
  return cache;
}

/**
 * 把偏好落到文档根上。
 *
 * - zoom 用 `zoom` 属性作用在 <html>：0.94 只是「一屏多显示一点」，
 *   不会放大导致溢出滚动条（放大档位刻意没提供，因为 .sf-app 是
 *   100vh 固定高度，放大会被裁）。
 * - 强调色/侧栏宽度走 CSS 变量，让组件级样式自然继承。
 */
export function applyPrefs(prefs: SfPrefs = currentPrefs()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.zoom = prefs.zoom === "compact" ? "0.94" : "";
  root.dataset.sfAccent = prefs.accent;
  root.dataset.sfDensity = prefs.density;
  root.dataset.sfMotion = prefs.motion;
  root.style.setProperty("--sf-rail-w", `${prefs.railWidth}px`);
  root.lang = prefs.locale;
}

// ── 格式化（受 locale / hour12 / currency 影响，供新界面直接调用） ─────────────

export function formatDateTime(value: string | number | Date | null | undefined, prefs = currentPrefs()): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(prefs.locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: prefs.hour12,
  });
}

export function formatMoney(cents: number | null | undefined, prefs = currentPrefs()): string {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat(prefs.locale, {
    style: "currency",
    currency: prefs.currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | null | undefined, prefs = currentPrefs()): string {
  return new Intl.NumberFormat(prefs.locale).format(value ?? 0);
}
