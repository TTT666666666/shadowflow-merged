import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  GitBranch,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import {
  AgentAvatar,
} from "../avatar";
import {
  SfLoadState,
  agents,
  PolicyCellState,
  PolicyMatrix,
  SfDagEdge,
  SfTeamDag,
  sfFetch,
  SF_PALETTE,
} from "./shared";
import { useI18n } from "../i18n";

interface SfApproval {
  approval_id: string;
  gate_id: string;
  submitter_name: string;
  summary: string;
  waiting_seconds: number;
}

const POLICY_COLORS: Record<PolicyCellState, string> = {
  permit: "#16a34a",
  warn: "#d97706",
  deny: "#dc2626",
};
const POLICY_LABELS: Record<PolicyCellState, string> = {
  permit: "允许",
  warn: "警告",
  deny: "拒绝",
};
const POLICY_RANK: Record<PolicyCellState, number> = { deny: 3, warn: 2, permit: 1 };
const POLICY_CYCLE: (PolicyCellState | null)[] = [null, "permit", "warn", "deny"];

/** 演示编队（后端不可达时的回落，与上方 agents 卡片同一批 6 名部门员工）。 */
const DEMO_TEAM: SfTeamDag = {
  team_id: "demo-atlas",
  name: "Atlas 新品发布作战室",
  edges: [
    { source: "MA", target: "BP", mode: "direct" },
    { source: "MA", target: "BD", mode: "direct" },
    { source: "BP", target: "CC", mode: "direct" },
    { source: "CC", target: "CR", mode: "approve" },
    { source: "CR", target: "CC", mode: "conditional" },
    { source: "CR", target: "OPS", mode: "direct" },
    { source: "BD", target: "OPS", mode: "direct" },
  ],
  resolved_agents: [
    { id: "MA", title: "市场分析师" },
    { id: "BP", title: "品牌策划师" },
    { id: "CC", title: "内容策划师" },
    { id: "OPS", title: "运营专员" },
    { id: "BD", title: "商务专员" },
    { id: "CR", title: "合规审核员" },
  ],
  policy: {
    MA: { BP: "permit", BD: "permit" },
    BP: { CC: "permit" },
    CC: { CR: "warn" },
    CR: { CC: "deny", OPS: "permit" },
    BD: { OPS: "warn" },
  },
};

/** 最长路径分层（移植 neo/TeamDagCanvas.computeTeamDagColumns：回边不参与分层）。 */
function dagLayers(edges: SfDagEdge[], ids: string[]): Map<string, number> {
  const out: Record<string, string[]> = {};
  const seqOut: Record<string, string[]> = {};
  const inc: Record<string, string[]> = {};
  ids.forEach((id) => {
    out[id] = [];
    seqOut[id] = [];
    inc[id] = [];
  });
  edges.forEach((e) => {
    if (seqOut[e.source] && seqOut[e.target]) seqOut[e.source].push(e.target);
  });
  const isAncestor = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to && cur !== from) return true;
      for (const nx of seqOut[cur] ?? []) {
        if (!seen.has(nx)) {
          seen.add(nx);
          stack.push(nx);
        }
      }
    }
    return false;
  };
  edges.forEach((e) => {
    if (!inc[e.target] || !out[e.source]) return;
    if (e.mode === "conditional" && isAncestor(e.target, e.source)) return;
    inc[e.target].push(e.source);
    out[e.source].push(e.target);
  });
  const col = new Map<string, number>();
  const queue: string[] = [];
  ids.forEach((id) => {
    if ((inc[id] ?? []).length === 0) {
      col.set(id, 0);
      queue.push(id);
    }
  });
  const guard = ids.length * 4 + 8;
  const maxCol = Math.max(0, ids.length - 1);
  let steps = 0;
  while (queue.length && steps++ < guard) {
    const id = queue.shift()!;
    const c = col.get(id) ?? 0;
    for (const next of out[id] ?? []) {
      const prev = col.get(next);
      if ((prev === undefined || prev < c + 1) && c + 1 <= maxCol) {
        col.set(next, c + 1);
        queue.push(next);
      }
    }
  }
  ids.forEach((id) => {
    if (!col.has(id)) col.set(id, 0);
  });
  return col;
}

/** 成员对策略态（无向取更严，与 neo/teamPolicyVisual.lookupPairPolicy 同口径）。 */
function pairPolicy(matrix: PolicyMatrix, a: string, b: string): PolicyCellState | null {
  const s1 = matrix[a]?.[b];
  const s2 = matrix[b]?.[a];
  const cand = [s1, s2].filter(Boolean) as PolicyCellState[];
  return cand.length ? cand.sort((x, y) => POLICY_RANK[y] - POLICY_RANK[x])[0] : null;
}

/** 单个成员的最严策略态（节点描边染色用，与 buildAgentPolicyColor 同口径）。 */
function agentPolicy(matrix: PolicyMatrix, id: string): PolicyCellState | null {
  let best: PolicyCellState | null = null;
  for (const [from, row] of Object.entries(matrix)) {
    for (const [to, s] of Object.entries(row ?? {})) {
      if (from !== id && to !== id) continue;
      if (!best || POLICY_RANK[s] > POLICY_RANK[best]) best = s;
    }
  }
  return best;
}

function SfDagPanel({ team, matrix }: { team: SfTeamDag; matrix: PolicyMatrix }) {
  const nodes = team.resolved_agents.length
    ? team.resolved_agents
    : (team.members ?? []).map((id) => ({ id, title: id }));
  const col = useMemo(
    () => dagLayers(team.edges, nodes.map((n) => n.id)),
    [team],
  );
  const { t } = useI18n();

  const NW = 150;
  const NH = 44;
  const COLG = 62;
  const ROWG = 36;
  const M = 26;

  const byCol = new Map<number, string[]>();
  nodes.forEach(({ id }) => {
    const c = col.get(id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(id);
  });
  const maxColIdx = Math.max(0, ...byCol.keys());
  let maxRows = 1;
  byCol.forEach((list) => {
    maxRows = Math.max(maxRows, list.length);
  });

  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((list, c) => {
    list.forEach((id, r) => {
      pos.set(id, { x: M + c * (NW + COLG), y: M + r * (NH + ROWG) });
    });
  });
  const W = M * 2 + (maxColIdx + 1) * NW + maxColIdx * COLG;
  const hasBackEdge = team.edges.some(
    (e) => (col.get(e.target) ?? 0) < (col.get(e.source) ?? 0),
  );
  const H = M * 2 + maxRows * NH + (maxRows - 1) * ROWG + (hasBackEdge ? 38 : 0);

  const edgeVisual = (e: SfDagEdge): { stroke: string; dash?: string; w: number; label?: string } => {
    const p = pairPolicy(matrix, e.source, e.target);
    if (p) {
      return {
        stroke: POLICY_COLORS[p],
        w: p === "deny" ? 2.4 : 1.9,
        dash: !e.mode || e.mode === "direct" ? undefined : "5 4",
        label: t(POLICY_LABELS[p]),
      };
    }
    if (e.mode === "approve") return { stroke: "#d97706", w: 1.6, dash: "5 4", label: t("审批") };
    if (e.mode === "conditional")
      return { stroke: "#0891b2", w: 1.6, dash: "5 4", label: t("驳回回炉") };
    return { stroke: "#c9c5ba", w: 1.6 };
  };

  const colorOf = (id: string, index: number, title?: string): string =>
    agents.find((a) => a.id === id || a.initials === id || (!!title && a.name === title))?.color ??
    SF_PALETTE[index % SF_PALETTE.length];

  return (
    <div className="sf-teamops-panel">
      <div className="sf-teamops-head">
        <GitBranch size={14} />
        <h3>{t("工作流 DAG")}</h3>
        <span className="sf-teamops-name">{t(team.name)}</span>
      </div>
      <p className="sf-teamops-sub">
        {t("交接边随协作策略染色 · 虚线为审批门 / 驳回回炉边")}
      </p>
      <div className="sf-dag-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minWidth: Math.min(W, 560) }}>
          {team.edges.map((e, i) => {
            const s = pos.get(e.source);
            const t = pos.get(e.target);
            if (!s || !t) return null;
            const x1 = s.x + NW;
            const y1 = s.y + NH / 2;
            const x2 = t.x;
            const y2 = t.y + NH / 2;
            const backward = (col.get(e.target) ?? 0) < (col.get(e.source) ?? 0);
            const v = edgeVisual(e);
            let d: string;
            let lx: number;
            let ly: number;
            if (backward) {
              // 回边（驳回回炉）：下弧线绕过中间列，避免横穿节点
              const drop = Math.max(...Array.from(pos.values()).map((p) => p.y)) + NH + 26;
              d = `M ${x1} ${y1} C ${x1} ${drop}, ${x2} ${drop}, ${x2} ${y2}`;
              lx = (x1 + x2) / 2;
              ly = drop + 9;
            } else {
              const dx = Math.max(36, (x2 - x1) / 2);
              d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              lx = (x1 + x2) / 2;
              ly = (y1 + y2) / 2 - 5;
            }
            return (
              <g key={`e${i}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={v.stroke}
                  strokeWidth={v.w}
                  strokeDasharray={v.dash}
                  markerEnd="url(#sf-arrow)"
                />
                {v.label && (
                  <text x={lx} y={ly} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={v.stroke}>
                    {v.label}
                  </text>
                )}
              </g>
            );
          })}
          <defs>
            <marker
              id="sf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {nodes.map((n, i) => {
            const p = pos.get(n.id)!;
            const st = agentPolicy(matrix, n.id);
            const stroke = st ? POLICY_COLORS[st] : "#e3e0d8";
            const color = colorOf(n.id, i, n.title);
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                <rect
                  width={NW}
                  height={NH}
                  rx={12}
                  fill="#fff"
                  stroke={stroke}
                  strokeWidth={st ? 2 : 1}
                  style={{ filter: "drop-shadow(0 1px 2px rgba(23,22,45,0.06))" }}
                />
                <circle cx={22} cy={NH / 2} r={12.5} fill={color} />
                <text
                  x={22}
                  y={NH / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill="#fff"
                >
                  {t(n.title || n.id).slice(0, 1)}
                </text>
                <text x={41} y={NH / 2 + 3.5} fontSize={13} fontWeight={650} fill="#17162d">
                  {t(n.title || n.id)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sf-dag-legend">
        <span><i style={{ borderColor: "#c9c5ba" }} />{t("direct 交接")}</span>
        <span><i style={{ borderColor: "#d97706", borderStyle: "dashed" }} />{t("approve 审批门")}</span>
        <span><i style={{ borderColor: "#0891b2", borderStyle: "dashed" }} />{t("驳回回炉")}</span>
        <span><i style={{ borderColor: "#16a34a" }} />{t("允许")}</span>
        <span><i style={{ borderColor: "#d97706" }} />{t("警告")}</span>
        <span><i style={{ borderColor: "#dc2626" }} />{t("拒绝")}</span>
      </div>
    </div>
  );
}

function SfPolicyPanel({
  team,
  matrix,
  dirty,
  saveState,
  onCell,
  onSave,
}: {
  team: SfTeamDag;
  matrix: PolicyMatrix;
  dirty: boolean;
  saveState: "idle" | "saving" | "ok" | "err";
  onCell: (a: string, b: string) => void;
  onSave: () => void;
}) {
  const roster = team.resolved_agents.length
    ? team.resolved_agents
    : (team.members ?? []).map((id) => ({ id, title: id }));
  const colorOf = (id: string, index: number, title?: string): string =>
    agents.find((a) => a.id === id || a.initials === id || (!!title && a.name === title))?.color ??
    SF_PALETTE[index % SF_PALETTE.length];
  const cellOf = (a: string, b: string): PolicyCellState | null => matrix[a]?.[b] ?? null;
  const { t, tn } = useI18n();
  return (
    <div className="sf-teamops-panel">
      <div className="sf-teamops-head">
        <LayoutGrid size={14} />
        <h3>{t("协作策略矩阵")}</h3>
      </div>
      <p className="sf-teamops-sub">
        {t("行 → 列 方向的交接许可 · 点击格子切换 允许 / 警告 / 拒绝")}
      </p>
      <div
        className="sf-policy-grid"
        style={{ gridTemplateColumns: `58px repeat(${roster.length}, 30px)` }}
      >
        <span />
        {roster.map((c, ci) => (
          <span className="sf-policy-head" key={`h${c.id}`} title={t(c.title)}>
            <i style={{ background: colorOf(c.id, ci, c.title) }}>{t(c.title || c.id).slice(0, 1)}</i>
            {t(c.title || c.id).slice(0, 2)}
          </span>
        ))}
        {roster.map((r, ri) => (
          <Fragment key={`r${r.id}`}>
            <span className="sf-policy-head sf-policy-row" title={t(r.title)}>
              <i style={{ background: colorOf(r.id, ri, r.title) }}>{t(r.title || r.id).slice(0, 1)}</i>
              {t(r.title || r.id).slice(0, 4)}
            </span>
            {roster.map((c) => {
              if (r.id === c.id) {
                return (
                  <span className="sf-policy-cell diag" key={`${r.id}-${c.id}`}>
                    <s>—</s>
                  </span>
                );
              }
              const st = cellOf(r.id, c.id);
              return (
                <button
                  type="button"
                  key={`${r.id}-${c.id}`}
                  className="sf-policy-cell"
                  style={{ background: st ? POLICY_COLORS[st] : "#f1efe9" }}
                  title={tn("{from} → {to}：{status}", {
                    from: r.title,
                    to: c.title,
                    status: st ? t(POLICY_LABELS[st]) : t("默认允许（未配置）"),
                  })}
                  onClick={() => onCell(r.id, c.id)}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="sf-policy-foot">
        <span className="sf-policy-legend">
          <i style={{ background: "#16a34a" }} />{t("允许")}
          <i style={{ background: "#d97706" }} />{t("警告")}
          <i style={{ background: "#dc2626" }} />{t("拒绝")}
          <i style={{ background: "#f1efe9" }} />{t("未配置")}
        </span>
        {dirty && (
          <button className="sf-policy-save" onClick={onSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? t("保存中…") : t("保存策略")}
          </button>
        )}
        {!dirty && saveState === "ok" && <span className="sf-policy-hint">{t("已保存 ✓")}</span>}
        {saveState === "err" && (
          <span className="sf-policy-hint err">{t("保存失败，请重试")}</span>
        )}
      </div>
    </div>
  );
}

function SfApprovalsPanel({
  approvals,
  onDecide,
}: {
  approvals: SfApproval[];
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const { t, tn } = useI18n();
  return (
    <div className="sf-teamops-panel">
      <div className="sf-teamops-head">
        <ShieldCheck size={14} />
        <h3>{t("审批门 · 封驳矩阵")}</h3>
        <span className="sf-teamops-count">{tn("{n} 待决", { n: approvals.length })}</span>
      </div>
      {approvals.length === 0 ? (
        <p className="sf-teamops-empty">
          {t("暂无待审批事项 —— Agent 交接触发审批门时会出现在这里。")}
        </p>
      ) : (
        <div className="sf-approve-list">
          {approvals.map((a) => (
            <div className="sf-approve-item" key={a.approval_id}>
              <div className="sf-approve-body">
                <strong>{a.submitter_name || a.gate_id}</strong>
                {a.summary && <span>{a.summary}</span>}
              </div>
              <span className="sf-approve-wait">
                {a.waiting_seconds < 60
                  ? `${Math.floor(a.waiting_seconds)}s`
                  : a.waiting_seconds < 3600
                    ? `${Math.floor(a.waiting_seconds / 60)}min`
                    : `${Math.floor(a.waiting_seconds / 3600)}h`}
              </span>
              <button
                className="sf-approve-btn ok"
                title={t("批准")}
                onClick={() => onDecide(a.approval_id, "approve")}
              >
                <Check size={14} strokeWidth={2.4} />
              </button>
              <button
                className="sf-approve-btn no"
                title={t("驳回")}
                onClick={() => onDecide(a.approval_id, "reject")}
              >
                <X size={14} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamOpsSection() {
  const [team, setTeam] = useState<SfTeamDag>(DEMO_TEAM);
  const [live, setLive] = useState(false);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  const [matrix, setMatrix] = useState<PolicyMatrix>(DEMO_TEAM.policy ?? {});
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [approvals, setApprovals] = useState<SfApproval[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const teams = await sfFetch<SfTeamDag[]>("/api/teams");
        const first = Array.isArray(teams) ? teams[0] : null;
        const tid = (first as any)?.team_id ?? (first as any)?.id;
        if (!tid) throw new Error("no team");
        const dag = await sfFetch<SfTeamDag>(`/api/teams/${tid}/dag`);
        if (!dag || !dag.resolved_agents?.length) throw new Error("no dag");
        if (dead) return;
        setTeam({
          ...dag,
          team_id: tid,
          edges: (dag.edges ?? []).map((e: any) => ({
            source: e.source,
            target: e.target,
            mode: e.mode ?? e.data?.mode ?? "direct",
          })),
        });
        setLive(true);
        setLoadState("ready");
        try {
          const pol = await sfFetch<PolicyMatrix>(`/api/teams/${tid}/policy`);
          if (!dead) setMatrix(pol ?? {});
        } catch {
          /* 策略为空即默认全允许 */
        }
        try {
          const ap = await sfFetch<SfApproval[] | { items?: SfApproval[] }>(
            `/api/groups/${tid}/approvals/pending`,
          );
          const items = Array.isArray(ap) ? ap : ap?.items ?? [];
          if (!dead) setApprovals(items);
        } catch {
          /* 审批接口不可达 —— 空态 */
        }
      } catch {
        /* 后端不可达 —— 保留占位编队 */
        setLoadState("error");
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const savePolicy = async () => {
    setSaveState("saving");
    try {
      if (!team.team_id.startsWith("demo")) {
        await sfFetch(`/api/teams/${team.team_id}/policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matrix }),
        });
      }
      setSaveState("ok");
      setDirty(false);
    } catch {
      setSaveState("err");
    }
  };

  const decide = async (approvalId: string, decision: "approve" | "reject") => {
    try {
      await sfFetch(`/api/approvals/${approvalId}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: decision === "reject" ? JSON.stringify({ reason: "" }) : JSON.stringify({}),
      });
      setApprovals((cur) => cur.filter((a) => a.approval_id !== approvalId));
    } catch {
      /* 失败静默，刷新可见 */
    }
  };

  return (
    <div className="sf-teamops">
      <div className="sf-teamops-main">
        <SfDagPanel team={team} matrix={matrix} />
      </div>
      <div className="sf-teamops-side">
        <SfPolicyPanel
          team={team}
          matrix={matrix}
          dirty={dirty}
          saveState={saveState}
          onCell={(a, b) => {
            const row = { ...(matrix[a] ?? {}) };
            const cur = row[b] ?? null;
            const next = POLICY_CYCLE[(POLICY_CYCLE.indexOf(cur) + 1) % POLICY_CYCLE.length];
            if (next) row[b] = next;
            else delete row[b];
            setMatrix({ ...matrix, [a]: row });
            setDirty(true);
            setSaveState("idle");
          }}
          onSave={() => void savePolicy()}
        />
        <SfApprovalsPanel approvals={approvals} onDecide={(id, d) => void decide(id, d)} />
      </div>
      <span className={`sf-live-tag ${live ? "on" : ""}`} data-testid="sf-teamops-source">
        {loadState === "loading" ? t("加载中…") : live ? t("LIVE · 已连接后端") : ""}
      </span>
    </div>
  );
}

export function AgentsView() {
  const { t } = useI18n();
  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>AI WORKFORCE</p>
          <h1>{t("你的 Agent 团队")}</h1>
          <span>{t("为不同角色配置能力、工具与责任边界。")}</span>
        </div>
        <button>
          <Plus size={15} /> {t("创建 Agent")}
        </button>
      </div>
      <div className="sf-agent-grid">
        {agents.map((agent) => (
          <article key={agent.name}>
            <div>
              <AgentAvatar label={t(agent.initials)} color={agent.color} />
              <button>
                <MoreHorizontal size={17} />
              </button>
            </div>
            <h2>{t(agent.name)}</h2>
            <p>{t(agent.role)}</p>
            <div>
              <span>
                <Zap size={13} /> 6 Skills
              </span>
              <span>
                <BookOpen size={13} /> {t("3 知识源")}
              </span>
            </div>
            <footer>
              <span>
                <i /> {t(agent.status)}
              </span>
              <button>
                {t("配置")} <ChevronRight size={14} />
              </button>
            </footer>
          </article>
        ))}
      </div>
      <TeamOpsSection />
    </section>
  );
}
