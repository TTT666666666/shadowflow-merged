/**
 * 界面文案国际化（2026-11-10）
 *
 * 设计取舍：**中文原文即 key**。不做 key 命名体系（`settings.profile.title` 那种），
 * 因为现有界面文案全是中文硬编码，改成 key 等于把 7 个视图全部重写一遍、且极易漏改。
 * 用中文原文作 key 的好处是渐进式：包一层 `t("个人资料")` 就生效，没包的照旧显示中文，
 * 不会出现空白或 key 泄漏到界面。
 *
 * 覆盖范围（本轮）：设置页全部导航与主要分区文案、主侧栏导航。其余视图随改随包。
 * 缺词条时 `t()` 原样返回中文 —— 宁可是中文，也不显示原始 key。
 */
import { useEffect, useState } from "react";
import { currentPrefs, subscribePrefs } from "./settings-prefs";

const EN: Record<string, string> = {
  // ── 主侧栏 ─────────────────────────────────────────────
  对话: "Chat",
  生意看板: "Business",
  团队知识库: "Knowledge",
  知识库: "Knowledge",
  "Agent 团队": "Agents",
  备忘: "Notes",
  定时任务: "Schedules",
  项目: "Projects",
  员工: "Agents",
  日程: "Schedules",
  设置: "Settings",
  新建: "New",
  搜索: "Search",
  收起侧栏: "Collapse sidebar",

  // ── 设置：分组 ─────────────────────────────────────────
  账户: "Account",
  外观: "Appearance",
  集成: "Integrations",
  记忆: "Memory",
  计费: "Billing",
  数据: "Data",
  管理员: "Admin",

  // ── 设置：栏目 ─────────────────────────────────────────
  个人资料: "Profile",
  主题与显示: "Theme & display",
  语言: "Language",
  Skills: "Skills",
  模型与密钥: "Models & keys",
  向量模型: "Embeddings",
  工具提供商: "Tool providers",
  连接器: "Connectors",
  "MCP 集成": "MCP",
  记忆条目: "Memory entries",
  "Agent 画像": "Agent profiles",
  交接与写回: "Handoff & write-back",
  用量: "Usage",
  通知: "Notifications",
  高级设置: "Advanced",
  用户管理: "Users",

  // ── 设置：通用 ─────────────────────────────────────────
  保存: "Save",
  保存中: "Saving",
  已保存: "Saved",
  取消: "Cancel",
  删除: "Delete",
  确认删除: "Confirm delete",
  刷新: "Refresh",
  加载中: "Loading",
  恢复默认: "Restore defaults",
  导出偏好: "Export preferences",
  清空界面缓存: "Clear UI cache",

  // ── 外观 ──────────────────────────────────────────────
  界面缩放: "Interface scale",
  标准: "Default",
  紧凑: "Compact",
  宽松: "Comfortable",
  左侧栏宽度: "Sidebar width",
  窄: "Narrow",
  宽: "Wide",
  列表密度: "List density",
  界面动效: "Motion",
  开启: "On",
  关闭: "Off",
  减弱: "Reduced",
  强调色: "Accent color",
  珊瑚: "Coral",
  紫罗兰: "Violet",
  青绿: "Teal",
  靛蓝: "Indigo",

  // ── 语言 ──────────────────────────────────────────────
  界面语言: "Interface language",
  简体中文: "简体中文",
  时间制: "Time format",
  "24 小时": "24-hour",
  "12 小时": "12-hour",
  货币: "Currency",
  "人民币 ¥": "CNY ¥",
  "美元 $": "USD $",
  欧元: "EUR €",
  格式预览: "Format preview",
  日期时间: "Date & time",
  金额: "Amount",
  数字: "Number",
  区域与格式: "Locale & formats",
  影响日期: "Affects how dates, times, currencies and numbers are displayed",

  // ── 用量 ──────────────────────────────────────────────
  用量与额度: "Usage & quota",
  模型调用: "Model calls",
  消耗: "Tokens used",
  折算成本: "Estimated cost",
  近: "Last",
  天: "days",
  "近 7 天": "7 days",
  "近 30 天": "30 days",
  "近 90 天": "90 days",
  输入输出构成: "Input / output split",
  输入: "Input",
  输出: "Output",
  运行: "Runs",
  成功率: "success rate",

  // ── 画像 / 交接 ────────────────────────────────────────
  主体: "Subject",
  客户: "Customer",
  用户: "User",
  置信度: "Confidence",
  来源: "Source",
  写回: "Write back",
  条目: "Entry",
  值: "Value",
  键: "Key",
  暂无数据: "No data",
  读取留痕: "Read trail",
  交接轮次: "Handoff rounds",
  待裁决冲突: "Open conflicts",

  // ── 通知 ──────────────────────────────────────────────
  浏览器通知: "Browser notifications",
  申请权限: "Request permission",
  发送测试通知: "Send test notification",
  已授权: "Granted",
  已拒绝: "Denied",
  未授权: "Not granted",
  新消息提醒: "New message alerts",
  任务完成提醒: "Run finished alerts",
  每日摘要: "Daily digest",
};

export type Locale = "zh-CN" | "en-US";

/** 供非组件环境（工具函数、测试）直接调用。 */
export function translate(zh: string): string {
  if (currentPrefs().locale !== "en-US") return zh;
  return EN[zh] ?? zh;
}

/** 组件用：订阅偏好变化，切语言立刻重渲染（不需要刷新页面）。 */
export function useI18n(): { t: (zh: string) => string; isEn: boolean } {
  const [locale, setLocale] = useState<Locale>(currentPrefs().locale);
  useEffect(() => subscribePrefs((prefs) => setLocale(prefs.locale)), []);
  return {
    t: (zh: string) => (locale === "en-US" ? EN[zh] ?? zh : zh),
    isEn: locale === "en-US",
  };
}

export const EN_DICTIONARY = EN;
