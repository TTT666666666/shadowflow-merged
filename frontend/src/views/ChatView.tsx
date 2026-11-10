import {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
  AlertTriangle,
  Clock,
  Download,
  Pin,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import {
  chatAssetUrl,
  decideApproval,
  getGroupDag,
  getTeamDag,
  getTeams,
  listPendingApprovals,
  listRunSessionsByGroup,
  retryRunStep,
  type AgentRecord,
  type GroupRecord,
  type PendingApprovalItem,
  type RunSessionItem,
  type SfTeamDag as ApiTeamDag,
  type TimelineMessage,
  type UserAttachment,
} from "../chat-api";
import {
  type GroupChat,
} from "../useGroupChat";
import {
  isTerminalRunStatus,
} from "../message-patches";
import {
  TimelineList,
} from "../TimelineView";
import {
  AgentAvatar,
} from "../avatar";
import {
  TurnRail,
} from "../TurnRail";
import {
  SfLoadState,
  SfLoadTag,
  fmtRelativeTime,
  groupPreview,
  groupActivityIso,
  agents,
  displayAgents,
  ComposerAtt,
  PlusView,
  PlusSkill,
  PlusConnector,
  PlusPublishAccount,
  PolicyMatrix,
  SfTeamDag,
  SfProject,
  SF_PALETTE,
} from "./shared";
import { agentSubtitle, translate, translateN, useI18n } from "../i18n";

// ── chat 视图闭包管道（行为保持拆分）─────────────────────────────────
// ProductApp 顶层 state/handler 经 ChatViewScope 值传递注入；
// renderChatView 内 JSX 与原 ProductApp 内联块（1186-1704）逐字节一致。

export interface ChatViewScope {
  panelOpen: boolean;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  newMenuRef: RefObject<HTMLDivElement | null>;
  setNewMenuOpen: Dispatch<SetStateAction<boolean>>;
  newMenuOpen: boolean;
  newMenuView: "root" | "project";
  setNewMenuView: Dispatch<SetStateAction<"root" | "project">>;
  creatingConversation: boolean;
  createConversation: () => Promise<void>;
  handleCreateProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  creatingProject: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  ceoPinAvailable: boolean;
  activeTitle: string;
  openCeoDm: () => Promise<void>;
  groupsState: "loading" | "ready" | "error";
  reloadGroups: () => Promise<void>;
  filteredConversations: GroupRecord[];
  groups: GroupRecord[];
  openGroup: (group: GroupRecord) => void;
  /** 删除会话（右键菜单触发；后端 204，删完由调用方刷新列表）。 */
  deleteConversation: (group: GroupRecord) => Promise<void>;
  activeGroupId: string | null;
  projectsTree: SfProject[];
  agentsList: AgentRecord[];
  filteredProjects: SfProject[];
  filteredAgents: AgentRecord[];
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  openAgentDm: (agent: AgentRecord) => Promise<void>;
  onChatDragEnter: (event: ReactDragEvent) => void;
  onChatDragOver: (event: ReactDragEvent) => void;
  onChatDragLeave: (event: ReactDragEvent) => void;
  onChatDrop: (event: ReactDragEvent) => void;
  chat: GroupChat;
  sendText: (text: string, attachments?: UserAttachment[], opts?: { executor?: string; model?: string }) => Promise<boolean>;
  openAuth: (mode: "login" | "register") => void;
  detailOpen: boolean;
  agentsState: SfLoadState;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  submitMessage: (event: FormEvent) => Promise<void>;
  notice: string | null;
  setNotice: Dispatch<SetStateAction<string | null>>;
  atts: ComposerAtt[];
  removeChatAtt: (id: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  onChatPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  plusView: PlusView | null;
  setPlusView: Dispatch<SetStateAction<PlusView | null>>;
  xhsChip: boolean;
  setXhsChip: Dispatch<SetStateAction<boolean>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  addChatFiles: (files: File[]) => void;
  openPlusView: (view: "skills" | "connectors") => void;
  plusSkills: PlusSkill[] | null;
  insertIntoComposer: (text: string) => void;
  togglePlusSkill: (row: PlusSkill) => Promise<void>;
  plusConnectors: { connectors: PlusConnector[]; accounts: PlusPublishAccount[] } | null;
  togglePlusConnector: (row: PlusConnector) => Promise<void>;
  dragOver: boolean;
}

/**
 * 会话列表行（2026-11-10）。
 *
 * 抽成独立组件只为承载「右键删除」：菜单的开合、坐标、二次确认都是行内状态，
 * 放在 renderChatView 顶层会被任意一次列表刷新重置。
 *
 * 菜单用 fixed 定位 + 全屏透明遮罩关闭，避免被侧栏 overflow 裁掉；
 * 删除走两步（「删除对话」→「确认删除」），与页面内其他危险操作口径一致。
 * Fragment 不产生 DOM 节点，因此既有的 `.sf-thread-panel button` 结构选择器不受影响。
 */
function ConversationRow({
  group,
  active,
  onOpen,
  onDelete,
}: {
  group: GroupRecord;
  active: boolean;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { t } = useI18n();

  const closeMenu = useCallback(() => {
    setMenuAt(null);
    setConfirming(false);
  }, []);

  useEffect(() => {
    if (!menuAt) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAt, closeMenu]);

  return (
    <>
      <button
        className={active ? "active" : ""}
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          // 菜单约 176×96，贴右/下边时向内收，避免超出视口
          setConfirming(false);
          setMenuAt({
            x: Math.min(event.clientX, Math.max(8, window.innerWidth - 192)),
            y: Math.min(event.clientY, Math.max(8, window.innerHeight - 112)),
          });
        }}
      >
        <span className="sf-conversation-icon">
          <MessageSquare size={12} />
          {group.kind === "dm" && <i />}
        </span>
        <span>
          <strong>{group.name || t("未命名会话")}</strong>
          <small>{groupPreview(group)}</small>
        </span>
        <time>{fmtRelativeTime(groupActivityIso(group))}</time>
      </button>
      {menuAt && (
        <>
          <div
            className="sf-ctx-backdrop"
            onClick={closeMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeMenu();
            }}
          />
          <div className="sf-ctx-menu" style={{ left: menuAt.x, top: menuAt.y }} role="menu">
            {confirming ? (
              <>
                <p className="sf-ctx-warn">{t("删除后聊天记录不可恢复")}</p>
                <button
                  className="sf-ctx-danger"
                  role="menuitem"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    void onDelete().finally(() => {
                      setDeleting(false);
                      closeMenu();
                    });
                  }}
                >
                  <Trash2 size={13} />
                  {deleting ? t("删除中…") : t("确认删除")}
                </button>
                <button role="menuitem" onClick={closeMenu}>
                  {t("取消")}
                </button>
              </>
            ) : (
              <button className="sf-ctx-danger" role="menuitem" onClick={() => setConfirming(true)}>
                <Trash2 size={13} />
                {t("删除对话")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function renderChatView(scope: ChatViewScope) {
  const {
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
  } = scope;
  // render-function 不能调 hook：直读当前偏好。调用方 ProductApp 订阅了偏好变化，
  // 切语言会整树重渲染，因此这里取到的永远是新语言（2026-11-10）。
  const t = translate;
  const tn = translateN;
  return (
          <div
            className={`sf-chat-layout ${panelOpen ? "" : "panel-closed"}`}
          >
            {panelOpen && (
              <aside className="sf-thread-panel">
                <div className="sf-drawer-head">
                  <div>
                    <span>
                      <MessageSquare size={14} />
                    </span>
                    <div>
                      <strong>{t("对话")}</strong>
                      <small>{t("搜索、新建或继续任何会话")}</small>
                    </div>
                  </div>
                  <button onClick={() => setPanelOpen(false)} aria-label={t("收起对话面板")}>
                    <X size={15} />
                  </button>
                </div>
                <div className="sf-new-wrap" ref={newMenuRef}>
                  <button
                    className="sf-new-chat"
                    onClick={() => setNewMenuOpen((v) => !v)}
                    aria-expanded={newMenuOpen}
                    aria-haspopup="menu"
                  >
                    <Plus size={12} />
                    <span>{t("新建")}</span>
                    <ChevronDown size={12} className="sf-new-caret" />
                  </button>
                  {newMenuOpen && (
                    <>
                      <button
                        className="sf-plus-backdrop"
                        aria-label={t("关闭新建菜单")}
                        onClick={() => {
                          setNewMenuOpen(false);
                          setNewMenuView("root");
                        }}
                      />
                      <div className="sf-new-menu" role="menu">
                        {newMenuView === "root" ? (
                          <>
                            <button
                              type="button"
                              className="sf-plus-item"
                              role="menuitem"
                              disabled={creatingConversation}
                              onClick={() => void createConversation()}
                            >
                              <MessageSquare size={14} />
                              <span>{creatingConversation ? t("创建中…") : t("新建对话")}</span>
                            </button>
                            <button
                              type="button"
                              className="sf-plus-item"
                              role="menuitem"
                              onClick={() => setNewMenuView("project")}
                            >
                              <Folder size={14} />
                              <span>{t("新建项目")}</span>
                              <ChevronRight size={13} className="sf-plus-chev" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="sf-plus-item sf-plus-head"
                              onClick={() => setNewMenuView("root")}
                            >
                              <ChevronLeft size={13} />
                              <span>{t("新建项目")}</span>
                            </button>
                            <form className="sf-new-form" onSubmit={handleCreateProject}>
                              <input
                                autoFocus
                                required
                                name="newProjectName"
                                maxLength={60}
                                placeholder={t("输入项目名称")}
                                disabled={creatingProject}
                              />
                              <button type="submit" disabled={creatingProject}>
                                {creatingProject ? t("创建中…") : t("创建")}
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <label className="sf-search">
                  <Search size={13} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("搜索对话、项目或 Agent")}
                  />
                  <kbd>⌘K</kbd>
                </label>
                {ceoPinAvailable && (
                  <button
                    className={`sf-ceo-pin ${activeTitle === "董事长" ? "active" : ""}`}
                    onClick={() => void openCeoDm()}
                  >
                    <AgentAvatar label="CEO" color="#ff5e3a" size="lg" />
                    <div>
                      <strong>{t("董事长")}</strong>
                      <small>{t("全局调度 · 任务拆解与决策")}</small>
                    </div>
                    <i />
                  </button>
                )}
                <p>{t("最近对话")}</p>
                <div className="sf-conversation-list">
                  {groupsState === "loading" && <p className="sf-thread-hint">{t("正在加载会话…")}</p>}
                  {groupsState === "error" && (
                    <p className="sf-thread-hint">
                      <button type="button" className="sf-link-btn" onClick={() => void reloadGroups()}>
                        {t("重试")}
                      </button>
                    </p>
                  )}
                  {groupsState === "ready" && filteredConversations.length === 0 && (
                    <p className="sf-thread-hint">
                      {groups.length === 0
                        ? t("还没有会话 —— 点「新建」或用下面的快捷指令开始。")
                        : t("没有匹配的会话")}
                    </p>
                  )}
                  {filteredConversations.map((group) => (
                    <ConversationRow
                      key={group.group_id}
                      group={group}
                      active={activeGroupId === group.group_id}
                      onOpen={() => openGroup(group)}
                      onDelete={() => deleteConversation(group)}
                    />
                  ))}
                </div>
                <p>{t("项目与 Agent")}</p>
                <div className="sf-project-tree">
                  {projectsTree.length === 0 && agentsList.length === 0 && (
                    <p className="sf-thread-hint">{t("暂无项目与 Agent（尚未创建）")}</p>
                  )}
                  {query.trim() &&
                    projectsTree.length + agentsList.length > 0 &&
                    filteredProjects.length === 0 &&
                    filteredAgents.length === 0 && (
                      <p className="sf-thread-hint">{t("没有匹配的项目或 Agent")}</p>
                    )}
                  {filteredProjects.map((project) => {
                    const expanded = !!expandedProjects[project.project_id];
                    const sessions = Array.isArray(project.sessions) ? project.sessions : [];
                    return (
                      <Fragment key={project.project_id}>
                        <button
                          className="sf-folder-row"
                          onClick={() =>
                            setExpandedProjects((all) => ({
                              ...all,
                              [project.project_id]: !expanded,
                            }))
                          }
                          aria-expanded={expanded}
                        >
                          <ChevronRight size={12} className={expanded ? "sf-rot90" : ""} />
                          <Folder size={13} />
                          <span>{project.name || project.project_id}</span>
                          {sessions.length > 0 && <em className="sf-tree-count">{sessions.length}</em>}
                        </button>
                        {expanded &&
                          (sessions.length === 0 ? (
                            <p className="sf-thread-hint sf-tree-empty">{t("暂无会话")}</p>
                          ) : (
                            sessions.map((session, idx) => {
                              const s = session as { session_id?: string; status?: string; title?: string };
                              return (
                                <div className="sf-session-row" key={s.session_id ?? idx}>
                                  <span />
                                  <p>
                                    {s.title || s.session_id || tn("会话 {n}", { n: idx + 1 })}
                                    {s.status ? ` · ${s.status}` : ""}
                                  </p>
                                </div>
                              );
                            })
                          ))}
                      </Fragment>
                    );
                  })}
                  {filteredAgents.map((agent) => (
                    <button
                      className="sf-agent-tree-row"
                      key={agent.agent_id ?? agent.name}
                      onClick={() => void openAgentDm(agent)}
                      title={t("点击打开单聊")}
                    >
                      <AgentAvatar
                        label={(agent.name || agent.agent_id || "?").slice(0, 2).toUpperCase()}
                        color={
                          agents.find((a) => a.name === agent.name)?.color ??
                          SF_PALETTE[(agent.name ?? "").length % SF_PALETTE.length]
                        }
                        small
                      />
                      <span>
                        <strong>{t(agent.name || agent.agent_id)}</strong>
                        <small>{agentSubtitle(agent.name, t)}</small>
                      </span>
                      <i className={agent.status === "执行中" ? "working" : ""} />
                    </button>
                  ))}
                </div>
              </aside>
            )}
            <section
              className="sf-chat"
              onDragEnter={onChatDragEnter}
              onDragOver={onChatDragOver}
              onDragLeave={onChatDragLeave}
              onDrop={onChatDrop}
            >
              <div className="sf-chat-scroll sf-thread-enter" key={activeGroupId ?? "none"}>
                <ChatThread chat={chat} onQuick={sendText} onLogin={() => openAuth("login")} />
              </div>

              <TurnRail messages={chat.messages} />

              {/* 任务面板 + 输入框一体化底座（2026-11-08 UI 改造）：
                  上层任务执行状态面板（受顶栏「执行详情」开关联动），下层原输入框 */}
              <div className="sf-composer-dock">
                {detailOpen && (
                  <TaskStatusPanel
                    groupId={activeGroupId}
                    groupName={activeTitle}
                    chat={chat}
                    agentsList={agentsList}
                    agentsState={agentsState}
                    onClose={() => setDetailOpen(false)}
                  />
                )}
              <form className="sf-composer" onSubmit={submitMessage}>
                {notice && (
                  <p className="sf-composer-notice" role="alert">
                    <AlertTriangle size={12} />
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice(null)} aria-label={t("关闭提示")}>
                      <X size={11} />
                    </button>
                  </p>
                )}
                {atts.length > 0 && (
                  <div className="sf-composer-atts">
                    {atts.map((a) => (
                      <div key={a.id} className={`sf-att-chip ${a.status}`}>
                        {a.data?.is_image ? (
                          <img src={chatAssetUrl(a.data.url)} alt="" />
                        ) : a.status === "uploading" && a.isImage && a.previewUrl ? (
                          <img src={a.previewUrl} alt="" />
                        ) : (
                          <FileText size={13} />
                        )}
                        <span title={a.name}>{a.name}</span>
                        {a.status === "uploading" && <em className="sf-att-up">{t("上传中…")}</em>}
                        {a.status === "error" && (
                          <em className="sf-att-err" title={a.error}>
                            {a.error || t("失败")}
                          </em>
                        )}
                        <button
                          type="button"
                          onClick={() => removeChatAtt(a.id)}
                          aria-label={tn("移除附件 {name}", { name: a.name })}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onPaste={onChatPaste}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    activeGroupId
                      ? t("继续这个会话，或给团队下发新任务…")
                      : t("告诉团队接下来要做什么…")
                  }
                />
                <div>
                  <span className="sf-composer-tools">
                    {/* 加号置最左（2026-11-10）；连接器激活后旁侧显示小红书徽标（参考 WorkBuddy +GitHub 形式） */}
                    <button
                      type="button"
                      aria-label={t("更多")}
                      className={plusView ? "sf-plus-trigger open" : "sf-plus-trigger"}
                      onClick={() => setPlusView(plusView ? null : "root")}
                    >
                      <Plus size={15} />
                    </button>
                    {xhsChip && (
                      <button
                        type="button"
                        className="sf-conn-chip"
                        aria-label={t("小红书发布已就绪（点击移除）")}
                        title={t("小红书发布已就绪 · 点击移除")}
                        onClick={() => setXhsChip(false)}
                      >
                        <XhsIcon size={17} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t("添加附件")}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={16} />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(event) => {
                        const picked = Array.from(event.currentTarget.files ?? []);
                        if (picked.length > 0) addChatFiles(picked);
                        event.currentTarget.value = ""; // 允许重复选同一文件
                      }}
                    />
                    {plusView && (
                      <>
                        <div
                          className="sf-plus-backdrop"
                          aria-hidden="true"
                          onClick={() => setPlusView(null)}
                        />
                        <div className="sf-plus-menu" role="menu">
                          {plusView === "root" && (
                            <>
                              <button
                                type="button"
                                className="sf-plus-item"
                                role="menuitem"
                                onClick={() => openPlusView("skills")}
                              >
                                <Sparkles size={14} />
                                <span>{t("技能")}</span>
                                <ChevronRight size={13} className="sf-plus-chev" />
                              </button>
                              <button
                                type="button"
                                className="sf-plus-item"
                                role="menuitem"
                                onClick={() => openPlusView("connectors")}
                              >
                                <Link2 size={14} />
                                <span>{t("连接器")}</span>
                                <ChevronRight size={13} className="sf-plus-chev" />
                              </button>
                            </>
                          )}
                          {plusView === "skills" && (
                            <>
                              <button
                                type="button"
                                className="sf-plus-item sf-plus-head"
                                onClick={() => setPlusView("root")}
                              >
                                <ChevronLeft size={13} />
                                <span>{t("技能")}</span>
                              </button>
                              {plusSkills === null && <p className="sf-plus-note">{t("加载中…")}</p>}
                              {plusSkills?.length === 0 && <p className="sf-plus-note">{t("暂无技能")}</p>}
                              {plusSkills?.map((s) => (
                                <div key={s.skill_id} className="sf-plus-row">
                                  <button
                                    type="button"
                                    className="sf-plus-row-main"
                                    title={s.description || s.skill_id}
                                    onClick={() =>
                                      insertIntoComposer(
                                        s.example_prompt?.trim() ||
                                          tn("【技能】{name}", { name: s.name || s.skill_id }),
                                      )
                                    }
                                  >
                                    <strong>{s.name || s.skill_id}</strong>
                                    <small>{s.description || s.skill_id}</small>
                                  </button>
                                  <button
                                    type="button"
                                    className={s.enabled === false ? "sf-plus-tag off" : "sf-plus-tag"}
                                    title={s.enabled === false ? t("点击启用") : t("点击停用")}
                                    onClick={() => void togglePlusSkill(s)}
                                  >
                                    {s.enabled === false ? t("停用") : t("启用")}
                                  </button>
                                </div>
                              ))}
                            </>
                          )}
                          {plusView === "connectors" && (
                            <>
                              <button
                                type="button"
                                className="sf-plus-item sf-plus-head"
                                onClick={() => setPlusView("root")}
                              >
                                <ChevronLeft size={13} />
                                <span>{t("连接器")}</span>
                              </button>
                              <p className="sf-plus-group">{t("发布通道")}</p>
                              {plusConnectors === null && <p className="sf-plus-note">{t("加载中…")}</p>}
                              {(() => {
                                const xhsAccounts = plusConnectors?.accounts.filter((a) =>
                                  a.platform.includes("xiaohongshu"),
                                );
                                const xhs =
                                  xhsAccounts?.find((a) => a.auth_mode === "real") ?? xhsAccounts?.[0];
                                const xhsStatus = xhs
                                  ? `${xhs.auth_mode === "real" ? t("真实发布") : t("mock 演示")}${xhs.account_name ? ` · ${xhs.account_name}` : ""}`
                                  : t("未配置账号 · 默认 mock 演示");
                                return (
                                  <div className="sf-plus-row">
                                    <button
                                      type="button"
                                      className="sf-plus-row-main"
                                      title={t(
                                        "点亮后，输入的内容将以小红书笔记直接发布（不再显示协议文本）",
                                      )}
                                      onClick={() => {
                                        setXhsChip(true); // 只点亮徽标，不往输入框塞 [post] JSON（2026-11-10）
                                        setPlusView(null);
                                      }}
                                    >
                                      <strong>{t("小红书发布")}</strong>
                                      <small>{xhsStatus}</small>
                                    </button>
                                    <span className="sf-plus-tag">{t("发帖")}</span>
                                  </div>
                                );
                              })()}
                              <p className="sf-plus-group">MCP / ACP</p>
                              {plusConnectors?.connectors.length === 0 && (
                                <p className="sf-plus-note">{t("未检测到连接器")}</p>
                              )}
                              {plusConnectors?.connectors.map((c) => {
                                const on = c.policy?.enabled ?? true;
                                return (
                                  <div key={c.id} className="sf-plus-row">
                                    <div className="sf-plus-row-main static" title={c.id}>
                                      <strong>{c.name || c.id}</strong>
                                      <small>
                                        {c.kind ?? "connector"} · {c.status ?? t("未知状态")} ·{" "}
                                        {c.policy?.approval_mode ?? "auto"}
                                      </small>
                                    </div>
                                    <button
                                      type="button"
                                      className={on ? "sf-plus-tag" : "sf-plus-tag off"}
                                      title={on ? t("点击停用") : t("点击启用")}
                                      onClick={() => void togglePlusConnector(c)}
                                    >
                                      {on ? t("启用") : t("停用")}
                                    </button>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </span>
                  <span>
                    <small>{t("Enter 发送 · Shift + Enter 换行")}</small>
                    <button
                      className="sf-send"
                      type="submit"
                      disabled={
                        (!message.trim() && !atts.some((a) => a.status === "done")) ||
                        atts.some((a) => a.status === "uploading")
                      }
                      aria-label={t("发送")}
                    >
                      <Send size={15} />
                    </button>
                  </span>
                </div>
              </form>
              </div>

              {dragOver && (
                <div className="sf-drop-overlay" aria-hidden="true">
                  <Paperclip size={22} />
                  <strong>{t("松开以上传")}</strong>
                  <small>{t("单个文件不超过 8MB")}</small>
                </div>
              )}
            </section>
          </div>
  );
}

const quickPrompts = [
  "制定 Atlas 新品发布计划",
  "分析竞品并输出简报",
  "查看团队执行状态",
  "创建一个定时任务",
];

/** 运行状态 → 展示文案（中文原文即 key，随界面语言）。未知状态原样返回。 */
function runStatusText(status: string): string {
  const ZH: Record<string, string> = {
    done: "已完成",
    running: "执行中",
    pending: "等待中",
    failed: "失败",
  };
  return translate(ZH[status] ?? status);
}

type RunStep = {
  name: string;
  status: "done" | "running" | "pending" | "failed";
  meta: string;
  substeps: { agent: string; slot: string; status: "done" | "running" | "pending" | "failed" }[];
};

type ApprovalItem = {
  id: string;
  /** 审批节点 id（POST /api/groups/:id/approvals/:nodeId 的 :nodeId）。 */
  nodeId?: string;
  from: string;
  label: string;
  color: string;
  summary: string;
  when: string;
  state: "pending" | "approved" | "rejected";
  /** 驳回原因（可选） */
  reason?: string;
  /** 通过时附带的补充命令 / 说明（可选） */
  note?: string;
  /** 审批对象 —— 明确「到底在审批什么」 */
  kind: string;
  target: string;
  detail: string;
  impact: string;
};

type ArtifactItem = {
  id: string;
  name: string;
  type: string;
  summary: string;
  size: string;
  pinned: boolean;
  url?: string;
};

function fmtElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** timeline step_panel/plan_card → 步骤列表（无运行数据 → 空数组=空态）。
 *  status 归一：done/running/failed 保留，其余（pending/blocked）按等待处理。 */
export function deriveSteps(messages: TimelineMessage[]): RunStep[] {
  const mapStatus = (s: string | undefined): RunStep["status"] =>
    s === "done" ? "done" : s === "running" ? "running" : s === "failed" ? "failed" : "pending";
  const panel = [...messages]
    .reverse()
    .find((m) => m.kind === "step_panel" && (m.steps ?? []).length > 0);
  if (panel) {
    return (panel.steps ?? []).map((s) => {
      const status = mapStatus(s.status);
      return {
        name: s.name,
        status,
        meta: s.elapsed_ms != null
          ? fmtElapsed(s.elapsed_ms)
          : status === "pending"
            ? translate("等待中")
            : status === "failed"
              ? translate("失败")
              : "",
        substeps: (s.substeps ?? []).map((sub) => ({
          agent: sub.name,
          slot: "",
          status: mapStatus(sub.status),
        })),
      };
    });
  }
  const plan = [...messages]
    .reverse()
    .find((m) => m.kind === "plan_card" && (m.tasks ?? []).length > 0);
  if (plan) {
    return (plan.tasks ?? []).map((t) => ({
      name: t.title,
      status: mapStatus(t.status),
      meta: t.assignee || t.agent_id || "",
      substeps: [],
    }));
  }
  return [];
}

/** timeline diff/commit/artifact 归并为产物列表。 */
export function deriveArtifacts(messages: TimelineMessage[]): ArtifactItem[] {
  const out: ArtifactItem[] = [];
  for (const m of messages) {
    if (m.kind === "diff_panel" || m.kind === "file_diff") {
      out.push({
        id: m.id,
        name: m.filename ?? m.path ?? "diff",
        type: "diff",
        summary: `+${m.added ?? 0} −${m.removed ?? 0}`,
        size: translateN("{n} 行", { n: (m.lines ?? []).length }),
        pinned: false,
      });
    } else if (m.kind === "commit_record") {
      out.push({
        id: m.id,
        name: `${m.short_sha ?? ""} ${m.message ?? ""}`.trim() || "commit",
        type: "commit",
        summary: `${m.repo ?? ""}${m.author ? ` · ${m.author}` : ""}`,
        size: translateN("{n} 文件", { n: m.files_changed ?? 0 }),
        pinned: false,
        url: m.url,
      });
    } else if (m.kind === "artifact_card") {
      out.push({
        id: m.id,
        name: m.filename ?? m.title ?? "artifact",
        type: m.artifact_type ?? "file",
        summary: m.note ?? "",
        size: "",
        pinned: false,
        url: m.url,
      });
    }
  }
  return out;
}

/** msg_foot/status_line/tool_call 归并为运行统计。 */
function deriveRunStats(messages: TimelineMessage[]): {
  status: string;
  elapsedMs: number;
  tools: number;
  tokens: number;
  cost: number;
} {
  const foot = [...messages].reverse().find((m) => m.kind === "msg_foot");
  const statusLine = [...messages].reverse().find((m) => m.kind === "status_line");
  const toolCount = messages.filter((m) => m.kind === "tool_call").length;
  return {
    status: foot?.status === "done" ? "done" : statusLine && !statusLine.terminal ? "running" : (foot?.status ?? "idle"),
    elapsedMs: foot?.elapsed_ms ?? (statusLine?.elapsed_s != null ? statusLine.elapsed_s * 1000 : 0),
    tools: foot?.tools ?? toolCount,
    tokens: foot?.tokens ?? 0,
    cost: foot?.cost_cny ?? 0,
  };
}

/** apiGet 的宽接口 DAG → 本地强类型 DAG（mode 归一、字段兜底）。 */
export function normalizeDag(d: ApiTeamDag): SfTeamDag {
  return {
    team_id: d.team_id ?? "",
    name: d.name ?? "",
    members: d.members ?? [],
    resolved_agents: (d.resolved_agents ?? []).map((a) => ({
      id: a.id,
      title: a.title ?? a.id,
      sub: a.sub,
    })),
    edges: (d.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      mode: e.mode ?? e.data?.mode,
      data: e.data,
    })),
    policy: (d.policy ?? null) as PolicyMatrix | null,
  };
}

/** GET /api/groups/:id/approvals/pending 的条目 → UI 审批卡。 */
function normalizeApproval(item: PendingApprovalItem, idx: number): ApprovalItem {
  const id = String(item.approval_id ?? item.id ?? item.gate_id ?? item.node_id ?? `ap-${idx}`);
  const nodeId = String(item.node_id ?? item.gate_id ?? item.approval_id ?? id);
  const name = item.submitter_name || "Agent";
  return {
    id,
    nodeId,
    from: name,
    label: name.slice(0, 2).toUpperCase(),
    color: SF_PALETTE[name.length % SF_PALETTE.length],
    summary: item.summary || `${item.kind ?? translate("审批")} · ${item.target ?? id}`,
    when:
      item.waiting_seconds != null
        ? translateN("已等待 {t}", { t: fmtElapsed(item.waiting_seconds * 1000) })
        : translate("等待中"),
    state: "pending",
    kind: String(item.kind ?? translate("审批")),
    target: String(item.target ?? id),
    detail: String(item.detail ?? ""),
    impact: String(item.impact ?? ""),
  };
}

/** 群 DAG（或回落团队 DAG）的紧凑竖排渲染（复用 sf-dag-rail 样式）。 */
function SfDagRail({ dag }: { dag: SfTeamDag }) {
  const nodes = dag.resolved_agents.length
    ? dag.resolved_agents
    : (dag.members ?? []).map((id) => ({ id, title: id }));
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  return (
    <div className="sf-dag-rail">
      {nodes.map((node, idx) => {
        const outs = dag.edges.filter((e) => e.source === node.id);
        return (
          <div key={node.id}>
            <div className="sf-dag-node">
              <span className={idx === 0 ? "entry" : ""} />
              <strong>{node.title || node.id}</strong>
              <em>{outs.some((e) => (e.mode ?? e.data?.mode) === "approve") ? `approve · ${translate("人工门")}` : "task"}</em>
            </div>
            {outs.map((e, i) => (
              <p className="sf-dag-edge" key={`${e.target}-${i}`}>
                ↓ {e.mode ?? e.data?.mode ?? "direct"} · {titleOf(e.target)}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 某 agent 在时间线里的最近活动（团队 tab 展开卡）。 */
function lastActivityOf(messages: TimelineMessage[], name: string): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.agent_name !== name && m.sender_name !== name) continue;
    if (m.kind === "tool_call")
      return `${m.name ?? translate("工具")}${m.status ? ` · ${m.status}` : ""}`;
    if (m.kind === "assistant_text") return translate("输出回复");
    if (m.kind === "thinking") return m.label || translate("思考中");
    return String(m.kind);
  }
  return "—";
}

/**
 * TaskStatusPanel —— 集成在对话输入框顶部的任务执行面板（2026-11-08 UI 改造）。
 * 三行结构：① 任务概览（状态/头像/任务名/进度/折叠）② 紧凑步骤列表 ③ 流程/团队/审批/产物四 Tab。
 * 数据全部来自真实后端（timeline 派生 + run-sessions + approvals + DAG），无假进度。
 */
function TaskStatusPanel({
  groupId,
  groupName,
  chat,
  agentsList,
  agentsState,
  onClose,
}: {
  groupId: string | null;
  groupName: string;
  chat: GroupChat;
  agentsList: AgentRecord[];
  agentsState: SfLoadState;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"flow" | "team" | "approval" | "artifacts">("flow");
  const [dagOpen, setDagOpen] = useState(false);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [opinions, setOpinions] = useState<Record<string, string>>({});
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [decided, setDecided] = useState<ApprovalItem[]>([]);
  const [approvalsLive, setApprovalsLive] = useState(false);
  const [dag, setDag] = useState<SfTeamDag | null>(null);
  const [artifactsPins, setArtifactsPins] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  // ── 任务面板状态机：空闲收起 / 执行中自动展开 / 完成与失败保留结果视图 ──
  const [expanded, setExpanded] = useState(false);
  // ── 多任务切换：真实 run 任务列表（goal=任务名），activeSid=null 为合并视图 ──
  const [sessions, setSessions] = useState<RunSessionItem[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const { t, tn } = useI18n();

  const messages = chat.messages;
  // 任务切片：选中具体任务时只归并该 session 的过程消息（消息↔任务关联来自 session_id 标签）
  const scoped = useMemo(
    () => (activeSid ? messages.filter((m) => m.session_id === activeSid) : messages),
    [messages, activeSid],
  );
  const steps = useMemo(() => deriveSteps(scoped), [scoped]);
  const artifacts = useMemo(() => deriveArtifacts(scoped), [scoped]);
  const stats = useMemo(() => deriveRunStats(scoped), [scoped]);
  const running =
    chat.runs.some((r) => !isTerminalRunStatus(r.status)) ||
    chat.awaitingReply ||
    chat.typing != null;
  const lastRun = [...chat.runs].reverse().find((r) => r.session_id);
  const runFailed = !running && lastRun?.status === "failed";
  const runSucceeded = !running && lastRun?.status === "succeeded";

  // 任务列表（真实数据）：群/运行状态变化时刷新
  const loadSessions = useCallback(async () => {
    if (!groupId) {
      setSessions([]);
      return;
    }
    try {
      const list = await listRunSessionsByGroup(groupId);
      setSessions(list);
    } catch {
      /* 接口不可达时保留旧列表，run 兜底仍可用 */
    }
  }, [groupId]);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions, chat.runs]);

  // 执行中自动展开实时步骤；会话切换复位（收起、回到合并视图、默认流程 Tab）
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);
  useEffect(() => {
    setExpanded(false);
    setActiveSid(null);
    setTab("flow");
  }, [groupId]);

  // 仅真实运行中才跳秒（不再伪造固定时长）
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const loadApprovals = useCallback(async () => {
    if (!groupId) return;
    try {
      const items = await listPendingApprovals(groupId);
      setApprovals(items.map((item, idx) => normalizeApproval(item, idx)));
      setApprovalsLive(true);
    } catch {
      setApprovals([]);
      setApprovalsLive(false);
    }
  }, [groupId]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals, tab]);

  // DAG：GET /api/groups/:id/dag → 回落 GET /api/teams/:id/dag → 空态
  useEffect(() => {
    if (!groupId) return;
    let dead = false;
    (async () => {
      try {
        const d = await getGroupDag(groupId);
        if (!dead && d && Array.isArray(d.edges)) setDag(normalizeDag(d));
      } catch {
        try {
          const teams = await getTeams();
          const tid = teams[0]?.team_id ?? teams[0]?.id;
          if (!tid) throw new Error("no team");
          const d = await getTeamDag(tid);
          if (!dead && d && Array.isArray(d.edges)) setDag(normalizeDag(d));
        } catch {
          if (!dead) setDag(null);
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [groupId, groupName]);

  const elapsedText = fmtElapsed(stats.elapsedMs);
  // 运行中且 msg_foot 尚未给出耗时 → 从最后一个 user_turn 起真实跳秒
  const turnStart = useMemo(() => {
    const lastUser = [...scoped].reverse().find((m) => m.kind === "user_turn");
    return lastUser?.ts ?? 0;
  }, [scoped]);
  const liveElapsed =
    running && stats.elapsedMs <= 0 && turnStart > 0 ? fmtElapsed(nowMs - turnStart) : elapsedText;
  const pendingCount = approvals.filter((a) => a.state === "pending").length;
  const doneSteps = steps.filter((s) => s.status === "done").length;
  // 概览行：任务名 = 选中任务的 goal（真实 run 目标），回落群名；Agent = 正在输入/最近发言者
  const activeSession = activeSid ? sessions.find((s) => s.session_id === activeSid) : null;
  const taskName = activeSession?.goal || groupName;
  const activeAgentName =
    chat.typing ??
    [...scoped].reverse().find((m) => m.agent_name)?.agent_name ??
    t("Agent 团队");
  const progressPct = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

  /** 步骤级重跑：优先调 run-sessions step retry，再消息重下发（无假动画）。 */
  const retryStep = async (name: string, index: number) => {
    const run = [...chat.runs].reverse().find((r) => r.session_id);
    if (run) {
      try {
        await retryRunStep(run.session_id, index);
      } catch {
        /* retry 接口不可用 → 仅消息重下发 */
      }
    }
    await chat.send(tn("重跑步骤「{name}」", { name }));
  };

  const rerunAll = () => {
    void chat.rerun();
  };

  const resolveApproval = async (id: string, state: "approved" | "rejected") => {
    const item = approvals.find((a) => a.id === id);
    const comment = (opinions[id] ?? "").trim();
    const decidedItem: ApprovalItem = {
      ...(item ?? {
        id,
        from: "Agent",
        label: "AG",
        color: "#999",
        summary: id,
        kind: t("审批"),
        target: id,
        detail: "",
        impact: "",
      }),
      state,
      when: t("刚刚"),
      note: state === "approved" ? comment || undefined : undefined,
      reason: state === "rejected" ? comment || undefined : undefined,
    };
    setApprovals((all) => all.filter((x) => x.id !== id));
    setDecided((all) => [decidedItem, ...all]);
    setOpinions((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    try {
      await decideApproval(groupId ?? "", item?.nodeId ?? id, state === "approved" ? "approve" : "reject");
    } catch {
      // 409（无挂起）/ 404 / 网络失败 → 重拉 pending 与真实状态对齐
      void loadApprovals();
    }
  };

  return (
    <div className="sf-task-panel">
      {/* Row 1 · 任务概览（收起时仅保留这一行摘要，不占多余空间） */}
      <div className="sf-task-head">
        <span
          className={`sf-task-status ${running ? "running" : runFailed ? "failed" : runSucceeded ? "done" : "idle"}`}
          title={
            running
              ? t("执行中")
              : runFailed
                ? t("任务失败")
                : runSucceeded
                  ? t("任务完成")
                  : t("空闲")
          }
        >
          {running ? (
            <RotateCcw size={11} className="sf-spin" />
          ) : runFailed ? (
            <X size={11} />
          ) : runSucceeded ? (
            <Check size={11} />
          ) : (
            <Zap size={11} />
          )}
        </span>
        <AgentAvatar
          label={activeAgentName.slice(0, 2).toUpperCase()}
          color={SF_PALETTE[activeAgentName.length % SF_PALETTE.length]}
          small
        />
        <div className="sf-task-title">
          <strong title={taskName}>{t(taskName)}</strong>
          <small>
            {activeAgentName}
            {running
              ? ` · ${t("执行中")}`
              : runFailed
                ? ` · ${t("失败")}`
                : runSucceeded
                  ? ` · ${t("已完成")}`
                  : ""}
          </small>
        </div>
        {steps.length > 0 && (
          <div
            className="sf-task-progress"
            title={tn("{done} / {total} 个步骤已完成", { done: doneSteps, total: steps.length })}
          >
            <span className="sf-task-progress-track">
              <i style={{ width: `${progressPct}%` }} />
            </span>
            <em>{progressPct}%</em>
          </div>
        )}
        <div className="sf-run-meta">
          <span className={`sf-run-pill ${running ? "running" : runFailed ? "failed" : "stopped"}`}>
            {running
              ? t("运行中")
              : runFailed
                ? t("失败")
                : runSucceeded
                  ? t("已完成")
                  : t("空闲")}
          </span>
          {(stats.elapsedMs > 0 || (running && turnStart > 0)) && (
            <span className="sf-run-ticker">
              <Clock size={9} />
              {liveElapsed}
            </span>
          )}
          {stats.cost > 0 && <span className="sf-run-cost">¥{stats.cost.toFixed(3)}</span>}
        </div>
        <div className="sf-run-actions">
          {running && groupId ? (
            <button
              className="sf-mini-btn danger"
              onClick={() => void chat.stop()}
              title={t("停止当前任务")}
            >
              <Square size={8} /> {t("停止")}
            </button>
          ) : runFailed ? (
            <button className="sf-mini-btn ok" onClick={rerunAll} title={t("重试失败的任务")}>
              <RotateCcw size={8} /> {t("重试")}
            </button>
          ) : runSucceeded ? (
            <button
              className="sf-mini-btn ok"
              onClick={() => {
                setExpanded(true);
                setTab("artifacts");
              }}
              title={t("查看任务产物")}
            >
              <FileText size={8} /> {t("产物")}
            </button>
          ) : (
            <button className="sf-mini-btn ok" onClick={rerunAll} title={t("重跑上一轮任务")}>
              <Play size={8} /> {t("重跑上一轮")}
            </button>
          )}
        </div>
        <button
          className={`sf-task-chevron ${expanded ? "open" : ""}`}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t("收起任务面板") : t("展开任务面板")}
          title={expanded ? t("收起") : t("展开")}
        >
          <ChevronDown size={13} />
        </button>
        <button
          className="sf-task-chevron"
          onClick={onClose}
          aria-label={t("隐藏任务面板")}
          title={t("隐藏（顶栏可再打开）")}
        >
          <X size={12} />
        </button>
      </div>

      {expanded && (
        <div className="sf-task-body">
          {/* 多任务切换：多个后台任务可区分切换（goal=真实任务名） */}
          {sessions.length > 1 && (
            <div className="sf-task-chips">
              <button
                className={activeSid === null ? "on" : ""}
                onClick={() => setActiveSid(null)}
              >
                {t("全部")}
              </button>
              {sessions.map((s) => (
                <button
                  key={s.session_id}
                  className={`${activeSid === s.session_id ? "on" : ""} ${
                    !isTerminalRunStatus(s.status) ? "live" : ""
                  }`}
                  onClick={() => setActiveSid(s.session_id === activeSid ? null : s.session_id)}
                  title={`${s.goal || s.session_id} · ${s.status}`}
                >
                  {!isTerminalRunStatus(s.status) && <i className="sf-chip-dot" />}
                  {s.goal || s.session_id.slice(0, 8)}
                </button>
              ))}
            </div>
          )}

          {/* Row 2 · 紧凑任务执行列表（绿勾 / 动态加载 / 灰等待 / 红错） */}
          <div className="sf-task-steps">
            <div className="sf-task-steps-title">
              <span>
                {t("执行步骤")}
                {steps.length > 0 ? ` · ${doneSteps}/${steps.length}` : ""}
              </span>
              {running && <em className="sf-step-live">{t("实时更新")}</em>}
            </div>
            {steps.length === 0 ? (
              <p className="sf-empty">
                {t("暂无运行记录 —— 在对话里给团队下发任务后，这里会实时显示执行步骤。")}
              </p>
            ) : (
              <ol className="sf-task-step-list">
                {steps.map((step, idx) => (
                  <li key={`${step.name}-${idx}`} className={`sf-task-step ${step.status}`}>
                    <span className="sf-task-step-icon">
                      {step.status === "done" ? (
                        <Check size={9} />
                      ) : step.status === "running" ? (
                        <RotateCcw size={9} className="sf-spin" />
                      ) : step.status === "failed" ? (
                        <X size={9} />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <strong>{step.name}</strong>
                    <small>
                      {step.meta || (runStatusText(step.status))}
                    </small>
                    {step.substeps.length > 0 && (
                      <span className="sf-task-sub-chips">
                        {step.substeps.map((sub, si) => (
                          <em key={`${sub.agent}-${si}`} className={sub.status}>
                            {sub.agent}
                            {sub.slot ? ` · ${sub.slot}` : ""} ·{" "}
                            {runStatusText(sub.status)}
                          </em>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

      <div className="sf-run-tabs">
        <button className={tab === "flow" ? "on" : ""} onClick={() => setTab("flow")}>
          {t("过程")}
        </button>
        <button className={tab === "team" ? "on" : ""} onClick={() => setTab("team")}>
          {t("团队")}
        </button>
        <button className={tab === "approval" ? "on" : ""} onClick={() => setTab("approval")}>
          {t("审批")}
          {pendingCount > 0 ? <em>{pendingCount}</em> : null}
        </button>
        <button className={tab === "artifacts" ? "on" : ""} onClick={() => setTab("artifacts")}>
          {t("产物")}
        </button>
      </div>

      {tab === "flow" && (
        <div className="sf-panel-section">
          <div className="sf-panel-title">
            <span>
              {t("步骤")}
              {steps.length > 0 ? ` · ${steps.length}` : ""}
            </span>
            <button onClick={() => setDagOpen(!dagOpen)}>{dagOpen ? t("收起 DAG") : t("查看 DAG")}</button>
          </div>
          {steps.length === 0 ? (
            <p className="sf-empty">
              {t("暂无运行记录 —— 在对话里给团队下发任务后，这里会实时显示执行步骤。")}
            </p>
          ) : (
            <div className="sf-step-tree">
              {steps.map((step, idx) => (
                <div key={`${step.name}-${idx}`}>
                  <div className={`sf-step-row ${step.status}`}>
                    <span className="sf-step-dot">
                      {step.status === "done" ? (
                        <Check size={9} />
                      ) : step.status === "running" ? (
                        <RotateCcw size={9} className="sf-spin" />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <div>
                      <strong>{step.name}</strong>
                      <small>{step.meta}</small>
                    </div>
                    {step.status === "done" && groupId && (
                      <button className="sf-retry" onClick={() => void retryStep(step.name, idx)}>
                        <RotateCcw size={8} /> {t("重跑")}
                      </button>
                    )}
                    {step.status === "running" && (
                      <span className="sf-step-live">{t("执行中")}</span>
                    )}
                  </div>
                  {step.substeps.map((sub, si) => (
                    <div className="sf-step-sub" key={`${sub.agent}-${si}`}>
                      <span />
                      <p>
                        {sub.agent}
                        {sub.slot ? ` · ${sub.slot}` : ""}
                      </p>
                      <em className={sub.status}>{runStatusText(sub.status)}</em>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {dagOpen &&
            (dag ? (
              <SfDagRail dag={dag} />
            ) : (
              <p className="sf-empty">{t("暂无 DAG 数据（接口未就绪或该会话尚未运行）")}</p>
            ))}
        </div>
      )}

      {tab === "team" && (
        <div className="sf-panel-section">
          <div className="sf-panel-title">
            <span>{t("当前团队")}</span>
          </div>
          {(agentsList.length > 0
            ? displayAgents(agentsList).map((a) => ({
                key: a.agent_id,
                name: a.name || a.agent_id,
                role: agentSubtitle(a.name, t),
                initials: (a.name || a.agent_id).slice(0, 2).toUpperCase(),
                color:
                  agents.find((x) => x.name === a.name)?.color ??
                  SF_PALETTE[(a.name ?? a.agent_id).length % SF_PALETTE.length],
                status: a.status ?? t("在线"),
                live: lastActivityOf(messages, a.name || a.agent_id),
              }))
            : agents.map((a) => ({
                key: a.name,
                name: a.name,
                role: a.role,
                initials: a.initials,
                color: a.color,
                status: a.status,
                live: t("暂无最近活动"),
              }))
          ).map((row) => (
            <div key={row.key}>
              <button
                className="sf-agent-row"
                onClick={() => setOpenAgent(openAgent === row.name ? null : row.name)}
              >
                <AgentAvatar label={t(row.initials)} color={row.color} small />
                <div>
                  <strong>{t(row.name)}</strong>
                  <small>{t(row.role)}</small>
                </div>
                <span className={row.status === "执行中" || row.status === "running" ? "running" : ""}>
                  {t(row.status)}
                </span>
              </button>
              {openAgent === row.name && (
                <div className="sf-expand-card">
                  <p>{tn("当前：{v}", { v: row.live })}</p>
                </div>
              )}
            </div>
          ))}
          <SfLoadTag state={agentsState} okText={t("已连接后端")} />
        </div>
      )}

      {tab === "approval" && (
        <div className="sf-panel-section">
          <div className="sf-panel-title">
            <span>{t("人工审批门")}</span>
            <button onClick={() => void loadApprovals()}>
              {tn("{n} 项待审批 · 刷新", { n: pendingCount })}
            </button>
          </div>
          <p className="sf-appr-hint">
            {t(
              "每张卡片写明正在等待审批的具体对象与影响。可直接通过 / 驳回，也可以在意见框里补充命令或说明原因。",
            )}
          </p>
          {!approvalsLive && approvals.length === 0 && (
            <p className="sf-empty">
              {t("暂无待审批事项（审批接口不可达或该会话没有挂起的审批门）。")}
            </p>
          )}
          {approvalsLive && approvals.length === 0 && decided.length === 0 && (
            <p className="sf-empty">{t("暂无待审批事项 —— Agent 交接触发审批门时会出现在这里。")}</p>
          )}
          {[...approvals, ...decided].map((ap) => (
            <div className={`sf-appr-card ${ap.state}`} key={ap.id}>
              <div className="sf-appr-head">
                <AgentAvatar label={ap.label} color={ap.color} small />
                <div>
                  <strong>{ap.summary}</strong>
                  <small>
                    {ap.from} · {ap.when}
                  </small>
                </div>
              </div>
              <div className="sf-appr-target">
                <p>
                  <em>{t("审批对象")}</em>
                  <b>{ap.kind}</b>
                </p>
                <strong>{ap.target}</strong>
                {ap.detail && <small>{ap.detail}</small>}
                {ap.impact && (
                  <small className="sf-appr-impact">{tn("通过后：{v}", { v: ap.impact })}</small>
                )}
              </div>
              {ap.state === "pending" ? (
                <>
                  <textarea
                    className="sf-appr-opinion"
                    rows={2}
                    value={opinions[ap.id] ?? ""}
                    onChange={(e: FormEvent<HTMLTextAreaElement>) =>
                      setOpinions((all) => ({ ...all, [ap.id]: e.currentTarget.value }))
                    }
                    placeholder={t(
                      "意见（可选）：留空可直接通过 / 驳回；通过时可补充命令，驳回时请说明原因",
                    )}
                  />
                  <div className="sf-appr-actions">
                    <button className="ok" onClick={() => void resolveApproval(ap.id, "approved")}>
                      <Check size={9} />{" "}
                      {(opinions[ap.id] ?? "").trim() ? t("通过并附意见") : t("通过")}
                    </button>
                    <button className="no" onClick={() => void resolveApproval(ap.id, "rejected")}>
                      <X size={9} />{" "}
                      {(opinions[ap.id] ?? "").trim() ? t("驳回并说明") : t("驳回")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="sf-appr-log">
                  {ap.state === "approved" ? t("✅ 已批准") : t("❌ 已驳回")}
                  {ap.note ? ` · ${t("补充命令：")}${ap.note}` : ""}
                  {ap.reason ? ` · ${t("原因：")}${ap.reason}` : ""}
                </div>
              )}
            </div>
          ))}
          <div className="sf-policy-note">
            <ShieldCheck size={16} />
            <div>
              <strong>{t("人工审核已开启")}</strong>
              <small>{t("关键策略不会未经确认直接执行")}</small>
            </div>
          </div>
        </div>
      )}

      {tab === "artifacts" && (
        <div className="sf-panel-section">
          <div className="sf-panel-title">
            <span>{tn("产物 · {n}", { n: artifacts.length })}</span>
            <button onClick={() => chat.reload()}>{t("刷新")}</button>
          </div>
          {artifacts.length === 0 && (
            <p className="sf-empty">
              {t("暂无产物 —— 运行产出的 diff、提交与文件会归并到这里。")}
            </p>
          )}
          {artifacts.map((art) => (
            <div className="sf-art-row" key={art.id}>
              <span className="sf-art-icon">
                <FileText size={11} />
              </span>
              <div>
                <strong>{art.name}</strong>
                <small>
                  {art.type}
                  {art.size ? ` · ${art.size}` : ""}
                  {art.summary ? ` · ${art.summary}` : ""}
                </small>
              </div>
              <div className="sf-art-actions">
                <button
                  className={artifactsPins[art.id] ? "pin on" : "pin"}
                  title={artifactsPins[art.id] ? t("取消置顶") : t("置顶")}
                  onClick={() =>
                    setArtifactsPins((all) => ({ ...all, [art.id]: !all[art.id] }))
                  }
                >
                  <Pin size={9} />
                </button>
                {art.url ? (
                  <a href={art.url} target="_blank" rel="noreferrer" title={t("打开")}>
                    <Download size={9} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sf-run-foot">
        {stats.tools} tools · {(stats.tokens / 1000).toFixed(1)}k tokens · ¥{stats.cost.toFixed(3)}
      </div>
        </div>
      )}
    </div>
  );
}

function CeoHero({ onQuick }: { onQuick: (text: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="sf-ceo-hero">
      <AgentAvatar label="CEO" color="#ff5e3a" size="xl" />
      <h2>{t("董事长")}</h2>
      <p>
        <i /> {t("在线 · 全局调度、任务拆解与决策")}
      </p>
      <div className="sf-ceo-chips">
        {quickPrompts.map((prompt) => (
          <button type="button" key={prompt} onClick={() => onQuick(t(prompt))}>
            {t(prompt)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 真实时间线渲染入口：GET /api/groups/:id/timeline + SSE/run 流增量。
 *  状态覆盖：加载 / 错误重试 / 空态（CeoHero + 快捷指令）/ 正常时间线 / 流式指示。 */
function ChatThread({
  chat,
  onQuick,
  onLogin,
}: {
  chat: GroupChat;
  onQuick: (text: string) => void;
  onLogin: () => void;
}) {
  const hasMessages = chat.messages.length > 0;
  const { t } = useI18n();
  // 有 run 在飞 = 团队真在干活（spinner 状态细分 2026-11-09：转圈不再只会说「拆解中」）。
  const runsActive = chat.runs.some((r) => !isTerminalRunStatus(r.status));

  // 加载态：首次进入拉取 timeline
  if (chat.status === "loading" && !hasMessages) {
    return (
      <div className="sf-empty">
        <span className="sf-empty-spinner" />
        <p>{t("正在加载会话记录…")}</p>
      </div>
    );
  }

  // 错误态：拉取失败 → 重试 / 登录引导
  if (chat.status === "error" && !hasMessages) {
    return (
      <div className="sf-empty">
        <div className="sf-empty-actions">
          <button type="button" className="sf-link-btn" onClick={() => chat.reload()}>
            {t("重试")}
          </button>
          <button type="button" className="sf-link-btn" onClick={onLogin}>
            {t("登录 / 注册")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 空态：无消息时给引导与快捷指令，不渲染空时间线 */}
      {!hasMessages && (
        <>
          <CeoHero onQuick={onQuick} />
          <p className="sf-thread-hint">
            {t("还没有消息 —— 试试上面的快捷指令，或直接输入你的第一个任务。")}
          </p>
        </>
      )}
      {/* 正常态：真实时间线（全部 TimelineMessage kind） */}
      <TimelineList messages={chat.messages} />
      {/* 增量加载失败但已有内容：行内错误条，保留已渲染消息 */}
      {chat.error && hasMessages && (
        <div className="sf-inline-error">
          <button type="button" className="sf-link-btn" onClick={() => chat.reload()}>
            {t("重试")}
          </button>
        </div>
      )}
      {/* 流式指示（2026-11-09 状态细分）：正在生成 / 等待你审批 / 团队执行中 / 拆解调度中。
          一轮干完（run 全终态或收到回复）即收起，不再干挂转圈。 */}
      {(chat.typing || chat.awaitingReply || chat.waitingApproval || runsActive) && (
        <div className="sf-working">
          <span />
          <span />
          <span />
          <p>
            {chat.typing ? (
              <>
                <strong>{chat.typing}</strong> {t("正在生成回复")}
              </>
            ) : chat.waitingApproval ? (
              <>
                <strong>{t("等待你审批")}</strong> · {t("团队已暂停，批/拒后继续（任务面板可操作）")}
              </>
            ) : runsActive ? (
              <>
                <strong>{t("Agent 团队")}</strong> {t("执行中，过程卡实时推进")}
              </>
            ) : (
              <>
                <strong>Agent</strong> {t("正在拆解任务并调度团队")}
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}

/** 小红书 Logo（2026-11-10）：红底圆角方块 + 白色「小红书」字样，加号旁连接器徽标。 */
function XhsIcon({ size = 16 }: { size?: number }) {
  const { t } = useI18n();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={t("小红书")}
      style={{ display: "block", borderRadius: 5 }}
    >
      <rect width="24" height="24" rx="5" fill="#ff2442" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize="8.2"
        fontWeight={700}
        fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
      >
        小红书
      </text>
    </svg>
  );
}
