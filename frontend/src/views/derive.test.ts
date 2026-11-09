/**
 * ChatView / BizView 纯函数测试：
 * deriveSteps / deriveArtifacts / normalizeDag（ChatView）+ fmtCompact / fmtDelta / fmtYuan（BizView）
 */
import { describe, expect, it } from "vitest";
import { deriveSteps, deriveArtifacts, normalizeDag } from "./ChatView";
import { fmtCompact, fmtDelta, fmtYuan } from "./BizView";
import type { TimelineMessage } from "../chat-api";

function msg(patch: Record<string, unknown>): TimelineMessage {
  return { id: "m1", kind: "text", role: "assistant", content: "", timestamp: 0, ...patch } as unknown as TimelineMessage;
}

describe("deriveSteps", () => {
  it("无消息返回空数组", () => {
    expect(deriveSteps([])).toEqual([]);
  });

  it("优先取最后一块 step_panel", () => {
    const steps = deriveSteps([
      msg({ id: "a", kind: "step_panel", steps: [{ name: "旧步骤", status: "done" }] }),
      msg({ id: "b", kind: "step_panel", steps: [{ name: "新步骤", status: "running" }] }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("新步骤");
    expect(steps[0].status).toBe("running");
  });

  it("无 step_panel 时回落到 plan_card", () => {
    const steps = deriveSteps([
      msg({ kind: "plan_card", tasks: [{ title: "写文档", status: "done", assignee: "小王" }] }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("写文档");
    expect(steps[0].meta).toBe("小王");
  });

  it("step_panel 空 steps 会被忽略", () => {
    const steps = deriveSteps([msg({ kind: "step_panel", steps: [] })]);
    expect(steps).toEqual([]);
  });

  it("status 归一：未知值降级为 pending", () => {
    const steps = deriveSteps([msg({ kind: "step_panel", steps: [{ name: "x", status: "weird" }] })]);
    expect(steps[0].status).toBe("pending");
  });

  it("带 substeps 时映射 agent 名", () => {
    const steps = deriveSteps([
      msg({ kind: "step_panel", steps: [{ name: "主", status: "running", substeps: [{ name: "子", status: "done" }] }] }),
    ]);
    expect(steps[0].substeps[0].agent).toBe("子");
    expect(steps[0].substeps[0].status).toBe("done");
  });
});

describe("deriveArtifacts", () => {
  it("无产物消息返回空", () => {
    expect(deriveArtifacts([msg({ kind: "text" })])).toEqual([]);
  });

  it("diff_panel 归并为 diff 类型", () => {
    const out = deriveArtifacts([
      msg({ kind: "diff_panel", filename: "a.ts", added: 3, removed: 1, lines: ["x", "y"] }),
    ]);
    expect(out[0].type).toBe("diff");
    expect(out[0].name).toBe("a.ts");
    expect(out[0].summary).toBe("+3 −1");
    expect(out[0].size).toBe("2 行");
  });

  it("commit_record 归并为 commit 类型", () => {
    const out = deriveArtifacts([
      msg({ kind: "commit_record", short_sha: "abc1234", message: "fix", repo: "r", author: "bob", files_changed: 5 }),
    ]);
    expect(out[0].type).toBe("commit");
    expect(out[0].name).toBe("abc1234 fix");
    expect(out[0].summary).toBe("r · bob");
    expect(out[0].size).toBe("5 文件");
  });

  it("artifact_card 用 artifact_type 作为类型", () => {
    const out = deriveArtifacts([msg({ kind: "artifact_card", filename: "r.pdf", artifact_type: "pdf", note: "报告" })]);
    expect(out[0].type).toBe("pdf");
    expect(out[0].name).toBe("r.pdf");
    expect(out[0].summary).toBe("报告");
  });

  it("多产物保持出现顺序", () => {
    const out = deriveArtifacts([
      msg({ id: "1", kind: "diff_panel", filename: "a" }),
      msg({ id: "2", kind: "commit_record", short_sha: "s" }),
    ]);
    expect(out.map((a) => a.id)).toEqual(["1", "2"]);
  });
});

describe("normalizeDag", () => {
  it("全空输入返回空结构", () => {
    const dag = normalizeDag({} as never);
    expect(dag.team_id).toBe("");
    expect(dag.members).toEqual([]);
    expect(dag.edges).toEqual([]);
    expect(dag.policy).toBeNull();
  });

  it("resolved_agents 缺 title 时回落到 id", () => {
    const dag = normalizeDag({ resolved_agents: [{ id: "agt1" }] } as never);
    expect(dag.resolved_agents[0].title).toBe("agt1");
  });

  it("edge 的 mode 从 data.mode 兜底", () => {
    const dag = normalizeDag({ edges: [{ source: "a", target: "b", data: { mode: "auto" } }] } as never);
    expect(dag.edges[0].mode).toBe("auto");
  });

  it("显式 mode 优先于 data.mode", () => {
    const dag = normalizeDag({ edges: [{ source: "a", target: "b", mode: "manual", data: { mode: "auto" } }] } as never);
    expect(dag.edges[0].mode).toBe("manual");
  });
});

describe("BizView 格式化", () => {
  it("fmtCompact 千位以下取整", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(999.6)).toBe("1000");
  });

  it("fmtCompact 千位用 k", () => {
    expect(fmtCompact(1500)).toBe("2k");
    expect(fmtCompact(12_000)).toBe("12k");
  });

  it("fmtCompact 百万用 M", () => {
    expect(fmtCompact(2_500_000)).toBe("2.50M");
  });

  it("fmtDelta null 显示破折号", () => {
    expect(fmtDelta(null)).toEqual(["—", ""]);
  });

  it("fmtDelta 正数带加号 up", () => {
    expect(fmtDelta(12.5)).toEqual(["+12.5%", "up"]);
  });

  it("fmtDelta 负数 down", () => {
    expect(fmtDelta(-3)).toEqual(["-3%", "down"]);
  });

  it("fmtYuan 分转元保留两位", () => {
    expect(fmtYuan(12345)).toBe("¥123.45");
    expect(fmtYuan(0)).toBe("¥0.00");
  });
});
