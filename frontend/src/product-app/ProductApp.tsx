import {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Store,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "./product-app.css";
import AuthModal from "../AuthModal";
import {
  authGuest,
  authLogout,
  displayNameOf,
  initialsOf,
  useAuthState,
} from "../auth";
import { useI18n } from "../i18n";
import {
  ApiError,
  apiFetch,
  CHAT_UPLOAD_MAX_BYTES,
  createGroup,
  createProject,
  deleteGroup,
  listAgents,
  listGroups,
  listProjects,
  resolveDm,
  setUnauthorizedHandler,
  uploadChatAttachment,
  type AgentRecord,
  type GroupRecord,
  type UserAttachment,
} from "../chat-api";
import {
  useGroupChat,
} from "../useGroupChat";
import {
  isTerminalRunStatus,
} from "../message-patches";
import {
  SfLoadState,
  groupPreview,
  groupActivityIso,
  agents,
  displayAgents,
  ComposerAtt,
  PlusView,
  PlusSkill,
  PlusConnector,
  PlusPublishAccount,
  sfFetch,
  SfProject,
} from "../views/shared";
import {
  renderChatView,
} from "../views/ChatView";
import {
  AgentsView,
} from "../views/AgentsView";
import {
  KnowledgeView,
} from "../views/KnowledgeView";
import {
  BizView,
} from "../views/BizView";
import {
  MemosView,
} from "../views/ProjectsView";
import {
  SchedulesView,
} from "../views/SchedulesView";
import {
  SettingsView,
} from "../views/SettingsView";

type View = "chat" | "agents" | "knowledge" | "biz" | "projects" | "schedules" | "settings";

const viewCopy: Record<Exclude<View, "chat">, { title: string; subtitle: string }> = {
  agents: { title: "Agent 团队", subtitle: "管理角色、能力与协作关系" },
  knowledge: { title: "知识库", subtitle: "管理团队共享的知识与上下文" },
  biz: { title: "生意看板", subtitle: "手工艺品代销：商品、销售、快递、社媒与盈利" },
  projects: { title: "工作备忘", subtitle: "个人日程与备忘，随手增删。" },
  schedules: { title: "定时任务", subtitle: "管理所有 Agent 的周期与一次性计划" },
  settings: { title: "设置", subtitle: "模型、Skills、集成、记忆与工作空间" },
};

// ── 拖拽图片解析（2026-11-09 修复「拖入就没反应」）──────────────────────────
// 从微信/浏览器/网页/Word 拖图片时 dataTransfer 只有 text/uri-list / text/html
// （没有 Files），需要从 URL 拉取转 File 后走既有上传链路。

/** 拖拽是否由聊天区接管：Files，或携带 text/uri-list / text/html 的图片类拖拽。 */
function isChatDragAccepted(dt: DataTransfer): boolean {
  const types: ReadonlyArray<string> = Array.from(dt.types ?? []);
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
}

/** 从 text/uri-list / text/html 解析候选图片地址（drop 时 getData 才可读）。 */
function extractDragUrls(dt: DataTransfer): string[] {
  const urls: string[] = [];
  for (const line of (dt.getData("text/uri-list") || "").split(/\r?\n/)) {
    const url = line.trim();
    if (url && !url.startsWith("#")) urls.push(url); // # 开头是 uri-list 注释行
  }
  if (urls.length === 0) {
    // 网页/微信富文本拖拽：取 <img src="..."> 的地址
    const re = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
    for (const m of (dt.getData("text/html") || "").matchAll(re)) urls.push(m[1]);
  }
  return urls.slice(0, 9); // 与单条消息 9 个附件上限对齐
}

/**
 * 拖拽 URL → File：fetch 取 blob（data: 与 http(s) 同路径）后转 File。
 * 失败抛错：FETCH_FAIL=取不到（跨域 CORS / file: / weixin: 协议受限），NOT_IMAGE=不是图片。
 */
async function dragUrlToFile(url: string, index: number): Promise<File> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("FETCH_FAIL");
    blob = await res.blob();
  } catch {
    // 跨域/协议受限统一按取不到处理，调用方提示改用回形针或粘贴（不许静默）
    throw new Error("FETCH_FAIL");
  }
  const extHint = /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  // 优先看 Content-Type；缺失/兜底时信 URL 扩展名（部分 CDN 回 octet-stream）
  if (!blob.type.startsWith("image/") && !(extHint && blob.size > 0)) throw new Error("NOT_IMAGE");
  const rawExt = (extHint ?? blob.type.split("/")[1] ?? "png").toLowerCase();
  const ext = rawExt === "jpeg" || rawExt === "jpg" ? "jpg" : rawExt === "svg+xml" || rawExt === "svg" ? "svg" : "png";
  return new File([blob], `拖入图片-${Date.now()}-${index}.${ext}`, {
    type: blob.type || (ext === "svg" ? "image/svg+xml" : `image/${ext}`),
  });
}

/**
 * 瞬断自动重试一次（2026-11-08）：网关 tsx watch 热重启 / Python 重载窗口期会出现
 * 5xx 信封（如 "upstream connect failed"）或 fetch 网络层 TypeError——这类错误请求
 * 大概率没到业务层，安全重试一次；4xx 业务错误不重试。
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const retryable =
      err instanceof TypeError ||
      (err instanceof ApiError && err.status >= 500);
    if (!retryable) throw err;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return await fn();
  }
}

export default function ProductApp() {
  const { t, tn } = useI18n();
  const [view, setView] = useState<View>("chat");
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [detailOpen, setDetailOpen] = useState(true);
  const auth = useAuthState();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  // ── 侧边栏「新建」菜单（2026-11-08 做全）：对话/项目都接真实后端创建 ──
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newMenuView, setNewMenuView] = useState<"root" | "project">("root");
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── 真实数据：群列表 / Agent / 项目树 ────────────────────────────────────
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [groupsState, setGroupsState] = useState<"loading" | "ready" | "error">("loading");
  const [agentsList, setAgentsList] = useState<AgentRecord[]>([]);
  const [agentsState, setAgentsState] = useState<SfLoadState>("loading");
  const [projectsTree, setProjectsTree] = useState<SfProject[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("新对话");
  const [ceoPinAvailable, setCeoPinAvailable] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const chat = useGroupChat(activeGroupId);

  // ── 聊天附件（2026-11-07 对话框拖拽传图）：拖拽/点选文件 → 上传 → 随消息发送 ──
  const [atts, setAtts] = useState<ComposerAtt[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // 内联提示（2026-11-09）：拖拽取不到图 / 失败附件拦截发送等，不许静默失败
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0); // dragenter/leave 计数，避免经过子元素时遮罩闪烁
  const attIdRef = useRef(0);
  const sendingRef = useRef(false); // submitMessage 异步窗口防重入

  // ── 连接器徽标（2026-11-10 UI 改造）：点「小红书发布」后在加号旁显示小红书
  //    图标（参考 WorkBuddy 的 +GitHub 形式），点击图标可移除 ──
  const [xhsChip, setXhsChip] = useState(false);

  function openAuth(mode: "login" | "register") {
    setAuthMode(mode);
    setAuthOpen(true);
    setAccountMenuOpen(false);
  }

  // 401 → 弹登录框（apiFetch 全局钩子）
  useEffect(
    () => setUnauthorizedHandler(() => setAuthOpen(true)),
    [],
  );

  const reloadGroups = useCallback(async () => {
    try {
      const list = await listGroups("all");
      list.sort((a, b) => {
        const ta = Date.parse(groupActivityIso(a) ?? "") || 0;
        const tb = Date.parse(groupActivityIso(b) ?? "") || 0;
        return tb - ta;
      });
      setGroups(list);
      setGroupsState("ready");
    } catch {
      setGroupsState("error");
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
    listAgents()
      .then((list) => {
        setAgentsList(list);
        setAgentsState("ready");
      })
      .catch(() => {
        setAgentsList([]);
        setAgentsState("error");
      });
    listProjects()
      .then(setProjectsTree)
      .catch(() => setProjectsTree([]));
  }, [reloadGroups]);

  // 身份切换（游客 ↔ 登录/注册）→ 旧身份的会话按归属隔离已不可再访问，
  // 清掉当前会话并重拉列表，避免 timeline 404 把界面卡死在「Group not found」
  // （2026-11-08 修「消息发不出来」的前端侧）。
  const authUserId = auth.user?.user_id ?? null;
  const prevAuthUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevAuthUserIdRef.current;
    prevAuthUserIdRef.current = authUserId;
    if (prev === undefined || prev === authUserId) return;
    setActiveGroupId(null);
    setActiveTitle("新对话");
    void reloadGroups();
  }, [authUserId, reloadGroups]);

  // 侧边栏预览/排序随消息活动刷新（2026-11-08 做全）：会话内消息变化
  // （用户发出 / Agent 回复）后防抖重拉列表，预览与「最近」排序不再
  // 滞后到手动刷新。用最后一条消息 ts 单调推进做信号，切换会话只记录
  // 不刷新（切到更旧会话 ts 不推进）。
  const lastChatActivityTsRef = useRef<number>(0);
  useEffect(() => {
    const msgs = chat.messages;
    const lastTs = msgs.length > 0 ? Number(msgs[msgs.length - 1].ts) || 0 : 0;
    if (lastTs <= lastChatActivityTsRef.current) return;
    lastChatActivityTsRef.current = lastTs;
    const timer = window.setTimeout(() => {
      void reloadGroups();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [chat.messages, reloadGroups]);

  // 点击账号区外部时收起「三个点」菜单
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountMenuOpen]);

  // 点击「新建」菜单外部收起（同账号菜单惯例）
  useEffect(() => {
    if (!newMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setNewMenuOpen(false);
        setNewMenuView("root");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [newMenuOpen]);

  // ⌘K / Ctrl+K 聚焦搜索框（kbd 已画在输入框上，此前没接线）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("chat");
        setPanelOpen(true);
        window.setTimeout(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chatStatusText = !activeGroupId
    ? t("选择或新建一个会话")
    : chat.status === "loading"
      ? t("正在加载会话…")
      : chat.status === "error"
        ? ""
        : chat.runs.some((r) => !isTerminalRunStatus(r.status))
          ? t("Agent 团队执行中")
          : chat.typing
            ? tn("{name} 正在输入…", { name: chat.typing })
            : t("会话在线");

  const filteredConversations = useMemo(
    () =>
      groups.filter((group) =>
        `${group.name ?? ""}${groupPreview(group)}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [groups, query],
  );

  // 搜索做全（2026-11-08）：placeholder 承诺「搜索对话、项目或 Agent」，
  // 此前只过滤对话。项目按 名称/会话标题 匹配，Agent 按 名称/ID 匹配。
  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectsTree;
    return projectsTree.filter((p) => {
      const sessions = Array.isArray(p.sessions) ? p.sessions : [];
      const sessionHit = sessions.some((s) => {
        const row = s as { title?: string; session_id?: string };
        return `${row.title ?? ""}${row.session_id ?? ""}`.toLowerCase().includes(q);
      });
      return `${p.name ?? ""}${p.project_id ?? ""}`.toLowerCase().includes(q) || sessionHit;
    });
  }, [projectsTree, query]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list =
      agentsList.length > 0 ? displayAgents(agentsList) : (agents as unknown as AgentRecord[]);
    if (!q) return list;
    return list.filter((a) =>
      `${a.name ?? ""}${a.agent_id ?? ""}`.toLowerCase().includes(q),
    );
  }, [agentsList, query]);

  function openGroup(group: GroupRecord) {
    setActiveGroupId(group.group_id);
    setActiveTitle(group.name || "会话");
    setView("chat");
    setMobileRailOpen(false);
    if (window.innerWidth <= 820) setPanelOpen(false);
  }

  /**
   * 删除会话（2026-11-10，右键菜单触发）。
   *
   * 后端 `DELETE /api/groups/{id}` 对 group / dm 一视同仁，直接删持久化 JSON。
   * 三层收尾必须都做，否则会留下「删了但还在」的假象：
   *   1) 删的是当前会话 → 先清 activeGroupId，避免 timeline 轮询打到 404 把界面卡死；
   *   2) 重拉列表，侧栏不再显示；
   *   3) 失败不静默，用 toast 告知（常见是游客身份下删别人的会话 → 403/404）。
   */
  async function deleteConversation(group: GroupRecord) {
    try {
      await deleteGroup(group.group_id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showNotice(tn("删除对话失败：{detail}", { detail }));
      return;
    }
    if (activeGroupId === group.group_id) {
      setActiveGroupId(null);
      setActiveTitle("选择或新建一个会话");
    }
    await reloadGroups();
    showNotice(t("已删除对话"));
  }

  /** 「董事长」置顶：resolve DM（总经理 agent-shadow-secretary）→ 打开；失败回落第一个 agent 的 DM。 */
  async function openCeoDm() {
    const candidates = ["agent-shadow-secretary", ...agentsList.map((a) => a.agent_id)];
    for (const agentId of candidates) {
      try {
        const res = await resolveDm(agentId);
        if (res?.group_id) {
          const label = agentId === "agent-shadow-secretary" ? "董事长" : agentsList.find((a) => a.agent_id === agentId)?.name || "单聊";
          setActiveGroupId(res.group_id);
          setActiveTitle(label);
          setView("chat");
          setMobileRailOpen(false);
          void reloadGroups();
          return;
        }
      } catch {
        /* 试下一个候选 */
      }
    }
    setCeoPinAvailable(false); // 一个 agent 都没有 → 隐藏置顶行
  }

  async function openAgentDm(agent: AgentRecord) {
    try {
      const res = await resolveDm(agent.agent_id);
      if (res?.group_id) {
        setActiveGroupId(res.group_id);
        setActiveTitle(agent.name || agent.agent_id);
        setView("chat");
        setMobileRailOpen(false);
        if (window.innerWidth <= 820) setPanelOpen(false);
        void reloadGroups();
      }
    } catch {
      /* 后端不可达 —— 静默 */
    }
  }

  /**
   * 新建对话的默认成员（2026-11-08 修复「Agent 说不出话」）：此前 createGroup
   * 不带 agent_ids → 空成员群 → 后端回「[chat] No agents are members」什么都不答。
   * 默认全员入群（总经理 + 各部门），@点名 / 策略矩阵路由到对口的人。
   * 上限 8 对齐后端 MAX_FANOUT_AGENTS（超编裁剪防 422）。
   */
  async function defaultGroupAgentIds(): Promise<string[]> {
    const list =
      agentsList.length > 0 ? agentsList : await listAgents().catch(() => [] as AgentRecord[]);
    return [...new Set(list.map((a) => String(a.agent_id ?? "")).filter(Boolean))].slice(0, 8);
  }

  /** 新建对话 → POST /api/groups（真实建群）后进入。
   *  2026-11-08 做全：创建中态 + 失败可见（不再静默吞掉，之前「点了没反应」的根因）
   *  + 网关瞬断自动重试一次（tsx watch 热重启窗口期会 5xx/fetch 失败）+ 成功聚焦输入框接上发送。 */
  async function createConversation() {
    if (creatingConversation) return;
    setCreatingConversation(true);
    const name = tn("新对话 {n}", { n: groups.length + 1 });
    try {
      const group = await withRetry(async () =>
        createGroup({
          name: name.slice(0, 40),
          kind: "group",
          agent_ids: await defaultGroupAgentIds(),
        }),
      );
      if (group?.group_id) {
        setActiveGroupId(group.group_id);
        setActiveTitle(group.name || name);
        await reloadGroups();
        setNewMenuOpen(false);
        setNewMenuView("root");
        window.setTimeout(() => composerRef.current?.focus(), 0);
        return;
      }
      showNotice(t("创建对话失败：后端未返回会话 ID，请重试"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(tn("创建对话失败：{msg}（后端可达后可再次点击「新建」重试）", { msg }));
    } finally {
      setCreatingConversation(false);
    }
  }

  /** 新建项目 → POST /api/projects，成功刷新侧边栏项目树。 */
  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("newProjectName") as HTMLInputElement | null;
    const name = input?.value.trim();
    if (!name || creatingProject) return;
    setCreatingProject(true);
    try {
      await withRetry(() => createProject(name));
      setNewMenuOpen(false);
      setNewMenuView("root");
      listProjects()
        .then(setProjectsTree)
        .catch(() => setProjectsTree((cur) => cur));
      showNotice(tn("项目「{name}」已创建", { name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(tn("创建项目失败：{msg}", { msg }));
    } finally {
      setCreatingProject(false);
    }
  }

  /**
   * 发送消息。返回 true=已发出或已排入补发；false=建群失败（调用方保留 composer 内容供重试）。
   * 无活动会话时先建群，成功后跨群补发（2026-11-08 主理人裁决：不再静默丢内容）。
   * opts：executor/model 透传预留（模型选择器已于 2026-11-10 移除，默认服务端路由）。
   */
  async function sendText(
    text: string,
    attachments?: UserAttachment[],
    opts?: { executor?: string; model?: string },
  ): Promise<boolean> {
    if (!activeGroupId) {
      const name = text.trim().slice(0, 40) || tn("新对话 {n}", { n: groups.length + 1 });
      try {
        const group = await createGroup({
          name,
          kind: "group",
          agent_ids: await defaultGroupAgentIds(),
        });
        if (!group?.group_id) return false;
        setActiveGroupId(group.group_id);
        setActiveTitle(group.name || name);
        await reloadGroups();
        // 建群成功 → 跨群补发（gidOverride 指向新群，消息随新会话服务端回读出现）
        void chat.send(text, attachments, group.group_id, opts);
        return true;
      } catch {
        return false; // 建群失败 → 无处可发
      }
    }
    void chat.send(text, attachments, undefined, opts);
    return true;
  }

  // ── 聊天附件（2026-11-07 对话框拖拽传图）────────────────────────────────

  /** 批量加入附件：逐个上传 /api/fs/chat-upload，单个失败不阻塞其它。 */
  function addChatFiles(files: File[]) {
    // 非失败条目计数：后端 coerceAttachments 单条消息上限 9 个附件，超出会被丢弃，前端同步拦截
    let slots = atts.filter((a) => a.status !== "error").length;
    for (const file of files) {
      const id = `att-${(attIdRef.current += 1)}`;
      const isImage =
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
      // 与后端守卫一致：8MB 上限；文件名不允许路径分隔符或 ..；单条消息最多 9 个附件
      const badName = /[\\/]/.test(file.name) || file.name.includes("..");
      const overCount = slots >= 9;
      if (badName || overCount || file.size > CHAT_UPLOAD_MAX_BYTES) {
        setAtts((cur) => [
          ...cur,
          {
            id,
            name: file.name,
            size: file.size,
            isImage,
            status: "error",
            error: badName
              ? t("文件名含非法字符")
              : overCount
                ? t("单条消息最多 9 个附件")
                : t("超过 8MB 上限"),
          },
        ]);
        continue;
      }
      slots += 1;
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      setAtts((cur) => [
        ...cur,
        { id, name: file.name, size: file.size, isImage, previewUrl, status: "uploading" },
      ]);
      void (async () => {
        try {
          const data = await uploadChatAttachment(file);
          patchChatAtt(id, { status: "done", data, previewUrl: undefined });
        } catch (err) {
          patchChatAtt(id, {
            status: "error",
            error: err instanceof Error ? err.message : t("上传失败"),
            previewUrl: undefined,
          });
        } finally {
          // 完成后回收本地预览（成功态改用服务端直链）
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        }
      })();
    }
  }

  function patchChatAtt(id: string, patch: Partial<ComposerAtt>) {
    setAtts((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeChatAtt(id: string) {
    setAtts((cur) => {
      const hit = cur.find((a) => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return cur.filter((a) => a.id !== id);
    });
  }

  /** 内联提示（拖拽取不到图 / 发送被拦截）：8 秒自动收起，可手动关闭。 */
  function showNotice(text: string) {
    setNotice(text);
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 8000);
  }

  /** 剪贴板粘贴图片（2026-11-09）：截图/复制的图片 blob 直接进附件队列。 */
  function onChatPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length === 0) return;
    event.preventDefault(); // 图片粘贴不再向输入框插文本
    addChatFiles(files);
  }

  // ── 聊天框加号菜单（2026-11-08）：技能 / 连接器两级弹层，数据接后端 ──────


  const [plusView, setPlusView] = useState<PlusView | null>(null);
  const [plusSkills, setPlusSkills] = useState<PlusSkill[] | null>(null);
  const [plusConnectors, setPlusConnectors] = useState<{
    connectors: PlusConnector[];
    accounts: PlusPublishAccount[];
  } | null>(null);

  /** 打开加号子菜单；首次进入拉真实数据（技能列表 / 连接器+发布通道）。 */
  function openPlusView(view: "skills" | "connectors") {
    setPlusView(view);
    if (view === "skills" && plusSkills === null) {
      sfFetch<PlusSkill[]>("/api/skills")
        .then((list) => setPlusSkills(Array.isArray(list) ? list : []))
        .catch(() => setPlusSkills([]));
    }
    if (view === "connectors" && plusConnectors === null) {
      Promise.all([
        sfFetch<{ items?: PlusConnector[] }>("/api/connectors"),
        sfFetch<{ accounts?: PlusPublishAccount[] }>("/api/social-publish/accounts"),
      ])
        .then(([c, a]) =>
          setPlusConnectors({ connectors: c.items ?? [], accounts: a.accounts ?? [] }),
        )
        .catch(() => setPlusConnectors({ connectors: [], accounts: [] }));
    }
  }

  /** 向输入框注入文本（保留已输入内容，换行衔接）并收起菜单。 */
  function insertIntoComposer(text: string) {
    setMessage((cur) => (cur.trim() ? `${cur.replace(/\n+$/, "")}\n${text}` : text));
    setPlusView(null);
  }

  /** 技能启用/停用（PATCH /api/skills/:id/enabled）。 */
  async function togglePlusSkill(row: PlusSkill) {
    const enabled = !(row.enabled ?? true);
    try {
      await sfFetch(`/api/skills/${encodeURIComponent(row.skill_id)}/enabled`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setPlusSkills(
        (cur) => cur?.map((s) => (s.skill_id === row.skill_id ? { ...s, enabled } : s)) ?? null,
      );
    } catch {
      /* 失败保持原状态 */
    }
  }

  /** 连接器启用/停用（POST /api/connectors/:id/policy，执行前裁定+留痕）。 */
  async function togglePlusConnector(row: PlusConnector) {
    const enabled = !(row.policy?.enabled ?? true);
    try {
      await sfFetch(`/api/connectors/${encodeURIComponent(row.id)}/policy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setPlusConnectors(
        (cur) =>
          cur && {
            ...cur,
            connectors: cur.connectors.map((c) =>
              c.id === row.id ? { ...c, policy: { ...(c.policy ?? {}), enabled } } : c,
            ),
          },
      );
    } catch {
      /* 失败保持原状态 */
    }
  }

  /**
   * 拖拽接管（2026-11-09 修复「拖入就没反应」）：除 Files 外，还接受携带
   * text/uri-list / text/html 的图片拖拽（微信/浏览器/网页/Word 拖图时
   * dataTransfer 没有 Files，此前守卫静默返回 → 遮罩与 drop 全部失效）。
   * enter/leave 计数防闪烁。
   */
  function onChatDragEnter(event: ReactDragEvent) {
    if (!isChatDragAccepted(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }

  function onChatDragOver(event: ReactDragEvent) {
    if (!isChatDragAccepted(event.dataTransfer)) return;
    event.preventDefault(); // 必须阻止默认行为，否则浏览器直接打开文件/图片
    event.dataTransfer.dropEffect = "copy";
  }

  function onChatDragLeave(event: ReactDragEvent) {
    if (!isChatDragAccepted(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }

  /**
   * 拖放处理：优先 dataTransfer.files；为空则从 text/uri-list / text/html 解析
   * 图片 URL，fetch 拿 blob 转 File 后走既有 addChatFiles。取不到图/识别不了
   * 都给可见内联提示，不许静默。
   */
  function onChatDrop(event: ReactDragEvent) {
    const dt = event.dataTransfer;
    const files = Array.from(dt.files ?? []);
    const urls = files.length === 0 ? extractDragUrls(dt) : [];
    dragDepthRef.current = 0;
    setDragOver(false);
    if (files.length === 0 && urls.length === 0) {
      // 无文件也无 URL（纯文本拖放）：只提示不接管，交还浏览器默认行为
      //（如向输入框插入文字，preventDefault 会把这类插入一并吞掉）
      if (isChatDragAccepted(dt)) {
        showNotice(t("未识别到可上传的图片，请改用回形针按钮或截图后粘贴"));
      }
      return;
    }
    event.preventDefault(); // 必须阻止：否则浏览器直接打开/导航到拖入的图片 URL
    if (files.length > 0) {
      addChatFiles(files);
      return;
    }
    void (async () => {
      const converted: File[] = [];
      for (let i = 0; i < urls.length; i += 1) {
        try {
          converted.push(await dragUrlToFile(urls[i], i));
        } catch (err) {
          // 跨域取不到/内容不是图片 → 明确告诉用户换姿势，不许静默
          showNotice(
            err instanceof Error && err.message === "NOT_IMAGE"
              ? t("拖入的内容不是图片，仅支持图片文件")
              : t("无法获取该图片，请改用回形针按钮或截图后粘贴"),
          );
        }
      }
      if (converted.length > 0) addChatFiles(converted);
    })();
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    // 上传完成前不发送，防丢附件
    if (atts.some((a) => a.status === "uploading")) return;
    // 失败附件拦截发送（2026-11-09）：此前 error chip 被静默丢弃，用户以为图已发出
    if (atts.some((a) => a.status === "error")) {
      showNotice(t("有附件上传失败（红标），请移除后重试，或改用回形针重新上传"));
      return;
    }
    const ready = atts.flatMap((a) => (a.data ? [a.data] : []));
    if (!message.trim() && ready.length === 0) return;
    if (sendingRef.current) return; // 建群补发路径有异步窗口，防回车连发重复建群
    sendingRef.current = true;
    try {
      // 小红书徽标点亮时（2026-11-10）：发送自动套 [post] 标记，协议 JSON 不暴露给用户。
      // 已含 craft 标记的消息不重复包装；title 取首行（截 30 字），正文为全文。
      const raw = message.trim();
      const outbound =
        xhsChip && raw && !/\[(post|draft|link|order|ship|intake|report)\]/.test(raw)
          ? `[post] ${JSON.stringify({ platform: "小红书", title: raw.split("\n")[0].slice(0, 30), text: raw })}`
          : raw;
      // 发出/排入补发才清空 composer；失败保留输入与附件 chips 供重试（2026-11-08 主理人裁决）
      const ok = await sendText(outbound, ready.length > 0 ? ready : undefined);
      if (ok) {
        setMessage("");
        setXhsChip(false); // 一次性激活：发完即灭，防后续消息误发成笔记
        // 仅清理已发出的 done 附件，其余保留（2026-11-09，不再一刀切清空）
        setAtts((cur) => cur.filter((a) => a.status !== "done"));
        setNotice(null); // 发送成功即收起旧拦截提示，不再等 8 秒自动消失（2026-11-09 回归打磨）
      }
    } finally {
      sendingRef.current = false;
    }
  }

  function navigate(nextView: View) {
    setView(nextView);
    setMobileRailOpen(false);
  }

  return (
    <div className="sf-app">
      <aside className={`sf-rail ${mobileRailOpen ? "open" : ""}`}>
        <div className="sf-rail-head">
          <a className="sf-product-brand" href="#/" aria-label={t("返回 ShadowFlow 官网")}>
            <ProductLogo />
            <span>ShadowFlow</span>
          </a>
          <button
            className="sf-mobile-close"
            onClick={() => setMobileRailOpen(false)}
            aria-label={t("关闭导航")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="sf-dialogue-wrap">
          <button
            className={`sf-dialogue-button ${view === "chat" ? "active" : ""}`}
            onClick={() => {
              if (view !== "chat") {
                setView("chat");
                setPanelOpen(true);
              } else {
                setPanelOpen(!panelOpen);
              }
            }}
            aria-expanded={view === "chat" && panelOpen}
          >
            <MessageSquare size={17} />
            <span>{t("对话")}</span>
            <ChevronDown size={15} />
          </button>
        </div>

        <nav className="sf-primary-nav">
          <button className={view === "agents" ? "active" : ""} onClick={() => navigate("agents")}>
            <Users size={17} />
            <span>{t("Agent 团队")}</span>
            {agentsList.length > 0 && <span className="sf-count">{displayAgents(agentsList).length}</span>}
          </button>
          <button
            className={view === "knowledge" ? "active" : ""}
            onClick={() => navigate("knowledge")}
          >
            <BookOpen size={17} />
            <span>{t("知识库")}</span>
          </button>
          <button className={view === "biz" ? "active" : ""} onClick={() => navigate("biz")}>
            <Store size={17} />
            <span>{t("生意看板")}</span>
          </button>
        </nav>

        <div className="sf-rail-section">
          <p>{t("工作空间")}</p>
          <button
            className={view === "projects" ? "active" : ""}
            onClick={() => navigate("projects")}
          >
            <LayoutGrid size={15} />
            <span>{t("备忘")}</span>
          </button>
          <button
            className={view === "schedules" ? "active" : ""}
            onClick={() => navigate("schedules")}
          >
            <CalendarClock size={15} />
            <span>{t("定时任务")}</span>
          </button>
        </div>

        <div className="sf-rail-foot">
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings size={16} />
            <span>{t("设置")}</span>
          </button>
          {auth.user ? (
            <div className="sf-account sf-account--user" ref={accountRef}>
              <button
                className="sf-account-main"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-expanded={accountMenuOpen}
              >
                <span>{initialsOf(auth.user)}</span>
                <div>
                  <strong>{displayNameOf(auth.user)}</strong>
                  <small>{auth.user.email || auth.user.address || t("已登录")}</small>
                </div>
              </button>
              <button
                className="sf-account-dots"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-label={t("账号菜单")}
              >
                <MoreHorizontal size={15} />
              </button>
              {accountMenuOpen && (
                <div className="sf-account-menu" role="menu">
                  <p>{auth.user.email || auth.user.address}</p>
                  {auth.user.auth_type === "guest" && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        openAuth("login");
                      }}
                    >
                      <UserRound size={13} /> {t("登录 / 注册")}
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void authLogout();
                    }}
                  >
                    <LogOut size={13} /> {t("退出登录")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="sf-account sf-account--guest" onClick={() => openAuth("login")}>
              <span>
                <UserRound size={15} />
              </span>
              <div>
                <strong>{t("登录 / 注册")}</strong>
                <small>{t("当前为演示模式")}</small>
              </div>
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </aside>

      {view === "chat" && panelOpen && (
        <button
          className="sf-panel-overlay"
          onClick={() => setPanelOpen(false)}
          aria-label={t("关闭对话面板")}
        />
      )}

      {mobileRailOpen && (
        <button
          className="sf-mobile-overlay"
          onClick={() => setMobileRailOpen(false)}
          aria-label={t("关闭导航")}
        />
      )}

      <main className="sf-main">
        <header className="sf-topbar">
          <div>
            <button
              className="sf-mobile-menu"
              onClick={() => setMobileRailOpen(true)}
              aria-label={t("打开导航")}
            >
              <Menu size={19} />
            </button>
            {view === "chat" ? (
              <>
                <button className="sf-history" onClick={() => setPanelOpen(!panelOpen)}>
                  <ArrowLeft size={15} />
                </button>
                <div className="sf-title-block">
                  <strong>{t(activeTitle)}</strong>
                  <span>
                    <i /> {chatStatusText}
                  </span>
                </div>
              </>
            ) : (
              <div className="sf-title-block">
                <strong>{t(viewCopy[view].title)}</strong>
                <span>{t(viewCopy[view].subtitle)}</span>
              </div>
            )}
          </div>
          <div className="sf-top-actions">
            {view === "chat" && (
              <button className="sf-members">
                {(() => {
                  const group = groups.find((g) => g.group_id === activeGroupId);
                  const ids = group?.agent_ids ?? [];
                  const members = ids
                    .map((id) => agentsList.find((a) => a.agent_id === id))
                    .filter(Boolean)
                    .slice(0, 3) as AgentRecord[];
                  if (members.length === 0) return <span>{t("董")}</span>;
                  return members.map((m) => (
                    <span key={m.agent_id}>{(m.name || m.agent_id).slice(0, 1)}</span>
                  ));
                })()}
              </button>
            )}
            <button>
              <MoreHorizontal size={18} />
            </button>
            {view === "chat" && (
              <button className="sf-detail-toggle" onClick={() => setDetailOpen(!detailOpen)}>
                {t("执行详情")}
              </button>
            )}
          </div>
        </header>

        {auth.ready && !auth.user && (
          <div className="sf-login-banner" role="status">
            <ShieldCheck size={15} />
            <div>
              <strong>{t("请先登录以使用真实工作台数据")}</strong>
              <small>{t("当前为演示模式 —— 界面可浏览，数据将在登录后与后端打通")}</small>
            </div>
            <button onClick={() => void authGuest()}>{t("游客体验")}</button>
            <button onClick={() => openAuth("login")}>{t("登录")}</button>
            <button className="ghost" onClick={() => openAuth("register")}>
              {t("注册")}
            </button>
          </div>
        )}

        {view === "chat" && renderChatView({
          panelOpen,
          setPanelOpen,
          newMenuRef,
          setNewMenuOpen,
          newMenuOpen,
          newMenuView,
          setNewMenuView,
          creatingConversation,
          createConversation,
          handleCreateProject,
          creatingProject,
          searchRef,
          query,
          setQuery,
          ceoPinAvailable,
          activeTitle,
          openCeoDm,
          groupsState,
          reloadGroups,
          filteredConversations,
          groups,
          openGroup,
          deleteConversation,
          activeGroupId,
          projectsTree,
          agentsList,
          filteredProjects,
          filteredAgents,
          expandedProjects,
          setExpandedProjects,
          openAgentDm,
          onChatDragEnter,
          onChatDragOver,
          onChatDragLeave,
          onChatDrop,
          chat,
          sendText,
          openAuth,
          detailOpen,
          agentsState,
          setDetailOpen,
          submitMessage,
          notice,
          setNotice,
          atts,
          removeChatAtt,
          composerRef,
          message,
          setMessage,
          onChatPaste,
          plusView,
          setPlusView,
          xhsChip,
          setXhsChip,
          fileInputRef,
          addChatFiles,
          openPlusView,
          plusSkills,
          insertIntoComposer,
          togglePlusSkill,
          plusConnectors,
          togglePlusConnector,
          dragOver,
        })}
        {view === "agents" && <AgentsView />}
        {view === "knowledge" && <KnowledgeView />}
        {view === "biz" && (
          <BizView
            // 看板同步（2026-11-09）：run 状态签名变化（一轮干完/新任务开跑）→ 静默刷新
            runsSig={chat.runs.map((r) => `${r.session_id}:${r.status}`).join("|")}
          />
        )}
        {view === "projects" && <MemosView />}
        {view === "schedules" && <SchedulesView />}
        {view === "settings" && <SettingsView />}
      </main>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </div>
  );
}

function ProductLogo() {
  return (
    <span className="sf-logo">
      <i />
      <i />
      <i />
    </span>
  );
}
