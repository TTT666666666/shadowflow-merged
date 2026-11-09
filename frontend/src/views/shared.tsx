import {
  apiFetch,
  type AgentRecord,
  type GroupRecord,
  type UserAttachment,
} from "../chat-api";
import {
  userVisibleText,
} from "../TimelineView";
import {
  stripMarkdown,
} from "../markdown";

/** 数据加载三态（加载中 / 成功 / 失败）：各视图状态标签统一入口，
 *  避免把「加载中」与「加载失败」混为一态而在加载过程闪现错误提示。 */
export type SfLoadState = "loading" | "ready" | "error";

export function SfLoadTag({ state, okText }: { state: SfLoadState; okText?: string }) {
  if (state === "loading") return <p className="sf-live-tag">加载中…</p>;
  if (state === "error") return null;
  return okText ? <p className="sf-live-tag on">{okText}</p> : null;
}

/** 相对时间（会话列表用）：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM/DD。 */
export function fmtRelativeTime(iso?: string | number | null): string {
  if (iso == null || iso === "") return "";
  const ts = typeof iso === "number" ? iso : Date.parse(String(iso));
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 172800_000) return "昨天";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** 会话列表预览：最后一条消息内容截断（2026-11-08 协议标记行剥掉不进预览，md 语法剥平）。 */
export function groupPreview(group: GroupRecord): string {
  const msgs = Array.isArray(group.messages) ? group.messages : [];
  const last = msgs[msgs.length - 1];
  const content = stripMarkdown(userVisibleText((last?.content ?? "").trim())).replace(/\s+/g, " ");
  if (!content) return "还没有消息";
  return content.length > 32 ? `${content.slice(0, 32)}…` : content;
}

/** 会话「最近活跃」时间：updated_at → 末条消息时间 → created_at 三级兜底。
 *  后端补 updated_at 之前创建的记录没有该字段，排序/时间列不能因此失真。 */
export function groupActivityIso(group: GroupRecord): string | undefined {
  const msgs = Array.isArray(group.messages) ? group.messages : [];
  const last = msgs.length > 0 ? msgs[msgs.length - 1].timestamp : undefined;
  return group.updated_at || last || group.created_at;
}

/**
 * 展示口径的 6 名部门核心员工（对齐后端 .shadowflow/agents 的手工艺品代卖团队成员，
 * 由 craft-team-setup 播种；旧「AI 营销公司」seed 编制已于 2026-11-08 清理）。
 * 后端不可达时作为各视图的兜底占位数据；id 同时用作 DEMO_TEAM 的 DAG 节点 id。
 */
export const agents = [
  {
    id: "MA",
    name: "市场分析师",
    role: "目标用户、市场、竞品和需求分析",
    initials: "市场",
    color: "#2777e8",
    status: "执行中",
  },
  {
    id: "BP",
    name: "品牌策划师",
    role: "品牌定位、产品卖点、品牌故事",
    initials: "品牌",
    color: "#7c5cff",
    status: "执行中",
  },
  {
    id: "CC",
    name: "内容策划师",
    role: "商品详情页、图文、短视频脚本",
    initials: "内容",
    color: "#e2603a",
    status: "已完成",
  },
  {
    id: "OPS",
    name: "运营专员",
    role: "商品资料、上架准备、店铺运营支持",
    initials: "运营",
    color: "#0ea5a4",
    status: "等待中",
  },
  {
    id: "BD",
    name: "商务专员",
    role: "企业采购材料、潜在客户筛选跟进",
    initials: "商务",
    color: "#57a04a",
    status: "等待中",
  },
  {
    id: "CR",
    name: "合规审核员",
    role: "内容合规、授权、品牌伦理和质量检查",
    initials: "合规",
    color: "#d6455e",
    status: "在线",
  },
];

/** 后端内置的调度中枢 / 服务账号不计入「AI 员工」展示（员工恒为 6 名部门核心员工）。 */
export const HIDDEN_AGENT_IDS = new Set(["agent-shadow-secretary"]);

/** 「AI 员工」展示口径：API 列表过滤掉内置中枢与秘书。 */
export function displayAgents(list: AgentRecord[]): AgentRecord[] {
  return list.filter((a) => !HIDDEN_AGENT_IDS.has(String(a.agent_id ?? "")));
}

/** composer 附件条目（2026-11-07 对话框拖拽传图）：上传中/成功/失败三态可见。 */
export interface ComposerAtt {
  id: string;
  name: string;
  size: number;
  isImage: boolean;
  /** 本地缩略图 object URL（上传中预览，完成后回收）。 */
  previewUrl?: string;
  status: "uploading" | "done" | "error";
  /** 上传成功后的服务端附件（status=done）。 */
  data?: UserAttachment;
  /** 失败原因（status=error）。 */
  error?: string;
}

  export type PlusView = "root" | "skills" | "connectors";
  export type PlusSkill = {
    skill_id: string;
    name: string;
    description?: string;
    example_prompt?: string;
    enabled?: boolean;
  };
  export type PlusConnector = {
    id: string;
    name: string;
    kind?: string;
    transport?: string;
    status?: string;
    policy?: { enabled?: boolean; approval_mode?: string };
  };
  export type PlusPublishAccount = {
    id: string;
    platform: string;
    account_name?: string;
    auth_mode?: string;
    status?: string;
  };

// ═══ 团队编排（对齐 ShadowFlow 后端：/api/teams、/api/teams/:id/dag、
//     /api/teams/:id/policy、/api/groups/:id/approvals/*、/api/approvals/*）═
// 后端可达 → 拉真实编队；不可达（静态预览）→ 回落占位数据。

export type PolicyCellState = "permit" | "warn" | "deny";
export type PolicyMatrix = Record<string, Record<string, PolicyCellState>>;

export interface SfDagEdge {
  source: string;
  target: string;
  /** direct | approve | conditional（后端在 e.data.mode，这里归一） */
  mode?: string;
  data?: { mode?: string };
}
export interface SfDagAgent {
  id: string;
  title: string;
  sub?: string;
}
export interface SfTeamDag {
  team_id: string;
  name: string;
  members?: string[];
  edges: SfDagEdge[];
  resolved_agents: SfDagAgent[];
  policy?: PolicyMatrix | null;
}

/** 旧视图专用 fetch：委托 apiFetch（Bearer 鉴权 + 401 → AuthModal），保留 {data} 解包。 */
export async function sfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const json = await apiFetch<unknown>(path, init);
  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export type SfProject = {
  project_id: string;
  name: string;
  sessions?: unknown[];
  updated_at?: string | number | null;
};

export const SF_PALETTE = ["#ff5e3a", "#2777e8", "#d97b38", "#c64f7d", "#7c5cff", "#0ea5a4"];
