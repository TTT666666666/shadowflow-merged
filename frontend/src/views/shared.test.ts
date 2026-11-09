/**
 * shared.tsx 纯函数测试（vitest + jsdom）
 * 覆盖：fmtRelativeTime / groupPreview / groupActivityIso / displayAgents / sfFetch
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayAgents, fmtRelativeTime, groupActivityIso, groupPreview, HIDDEN_AGENT_IDS, sfFetch } from "./shared";
import type { AgentRecord, GroupRecord } from "../chat-api";

const NOW = new Date("2026-11-09T12:00:00+08:00").getTime();

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("fmtRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("空值返回空串", () => {
    expect(fmtRelativeTime(null)).toBe("");
    expect(fmtRelativeTime(undefined)).toBe("");
    expect(fmtRelativeTime("")).toBe("");
  });

  it("非法时间串返回空串", () => {
    expect(fmtRelativeTime("not-a-date")).toBe("");
  });

  it("一分钟内显示「刚刚」", () => {
    expect(fmtRelativeTime(iso(30_000))).toBe("刚刚");
  });

  it("一小时内显示分钟", () => {
    expect(fmtRelativeTime(iso(5 * 60_000))).toBe("5 分钟前");
  });

  it("一天内显示小时", () => {
    expect(fmtRelativeTime(iso(3 * 3600_000))).toBe("3 小时前");
  });

  it("一到两天显示「昨天」", () => {
    expect(fmtRelativeTime(iso(30 * 3600_000))).toBe("昨天");
  });

  it("超过两天显示 MM/DD", () => {
    expect(fmtRelativeTime(iso(5 * 86400_000))).toMatch(/^\d{2}\/\d{2}$/);
  });

  it("接受数字时间戳", () => {
    expect(fmtRelativeTime(NOW - 120_000)).toBe("2 分钟前");
  });
});

describe("groupPreview", () => {
  it("无消息返回「还没有消息」", () => {
    expect(groupPreview({ messages: [] } as unknown as GroupRecord)).toBe("还没有消息");
  });

  it("messages 非数组时容错", () => {
    expect(groupPreview({ messages: undefined } as unknown as GroupRecord)).toBe("还没有消息");
  });

  it("长文本截断到 32 字符加省略号", () => {
    const long = "这是一段非常长的消息内容用于验证截断逻辑是否按照预期工作并且不会超长显示";
    const out = groupPreview({ messages: [{ content: long }] } as unknown as GroupRecord);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(33);
  });

  it("短文本原样返回", () => {
    expect(groupPreview({ messages: [{ content: "你好" }] } as unknown as GroupRecord)).toBe("你好");
  });

  it("剥掉 markdown 语法", () => {
    const out = groupPreview({ messages: [{ content: "**加粗** 文本" }] } as unknown as GroupRecord);
    expect(out).not.toContain("**");
    expect(out).toContain("加粗");
  });
});

describe("groupActivityIso", () => {
  it("优先 updated_at", () => {
    const g = { updated_at: "2026-11-09T10:00:00Z", created_at: "2026-11-01T00:00:00Z" } as GroupRecord;
    expect(groupActivityIso(g)).toBe("2026-11-09T10:00:00Z");
  });

  it("无 updated_at 时用末条消息时间", () => {
    const g = {
      messages: [{ timestamp: "2026-11-05T00:00:00Z" }],
      created_at: "2026-11-01T00:00:00Z",
    } as unknown as GroupRecord;
    expect(groupActivityIso(g)).toBe("2026-11-05T00:00:00Z");
  });

  it("都缺失时回落到 created_at", () => {
    const g = { created_at: "2026-11-01T00:00:00Z" } as unknown as GroupRecord;
    expect(groupActivityIso(g)).toBe("2026-11-01T00:00:00Z");
  });
});

describe("displayAgents", () => {
  it("过滤隐藏 agent（按 agent_id）", () => {
    const list = [
      { agent_id: "a1", name: "A" } as AgentRecord,
      { agent_id: [...HIDDEN_AGENT_IDS][0], name: "隐藏" } as AgentRecord,
    ];
    const out = displayAgents(list);
    expect(out.map((a) => a.agent_id)).toEqual(["a1"]);
  });

  it("空列表返回空", () => {
    expect(displayAgents([])).toEqual([]);
  });
});

describe("sfFetch", () => {
  it("解包 {data} 包裹", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { x: 1 } }) })));
    await expect(sfFetch<{ x: number }>("/api/x")).resolves.toEqual({ x: 1 });
    vi.unstubAllGlobals();
  });

  it("无包裹时原样返回", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ y: 2 }) })));
    await expect(sfFetch<{ y: number }>("/api/y")).resolves.toEqual({ y: 2 });
    vi.unstubAllGlobals();
  });
});
