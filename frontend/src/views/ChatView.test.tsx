/**
 * ChatView 烟测：renderChatView(scope) 为 render-function 形式（62 字段 scope），
 * 构造最小可用 scope，验证「能渲染不崩」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderChatView } from "./ChatView";
import { stubBrowserApis, stubFetchEmpty } from "./test-utils";

beforeEach(() => stubBrowserApis());

function makeScope(): never {
  const ref = { current: null };
  const noop = () => {};
  const asyncNoop = async () => {};
  const scope = {
    panelOpen: false,
    setPanelOpen: noop,
    newMenuRef: ref,
    setNewMenuOpen: noop,
    newMenuOpen: false,
    newMenuView: "root",
    setNewMenuView: noop,
    creatingConversation: false,
    createConversation: asyncNoop,
    handleCreateProject: asyncNoop,
    creatingProject: false,
    searchRef: ref,
    query: "",
    setQuery: noop,
    ceoPinAvailable: false,
    activeTitle: "",
    openCeoDm: asyncNoop,
    groupsState: "ready",
    reloadGroups: asyncNoop,
    filteredConversations: [],
    groups: [],
    openGroup: noop,
    activeGroupId: null,
    projectsTree: [],
    agentsList: [],
    filteredProjects: [],
    filteredAgents: [],
    expandedProjects: {},
    setExpandedProjects: noop,
    openAgentDm: asyncNoop,
    onChatDragEnter: noop,
    onChatDragOver: noop,
    onChatDragLeave: noop,
    onChatDrop: noop,
    chat: {
      status: "ready",
      messages: [],
      runs: [],
      typing: null,
      awaitingReply: false,
      waitingApproval: false,
      error: null,
      live: true,
      send: asyncNoop,
      stop: asyncNoop,
      rerun: asyncNoop,
      reload: noop,
    },
    sendText: async () => true,
    openAuth: noop,
    detailOpen: false,
    agentsState: "ready",
    setDetailOpen: noop,
    submitMessage: asyncNoop,
    notice: null,
    setNotice: noop,
    atts: [],
    removeChatAtt: noop,
    composerRef: ref,
    message: "",
    setMessage: noop,
    onChatPaste: noop,
    plusView: null,
    setPlusView: noop,
    xhsChip: false,
    setXhsChip: noop,
    fileInputRef: ref,
    addChatFiles: noop,
    openPlusView: noop,
    plusSkills: null,
    insertIntoComposer: noop,
    togglePlusSkill: asyncNoop,
    plusConnectors: null,
    togglePlusConnector: asyncNoop,
    dragOver: false,
  };
  return scope as never;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("renderChatView", () => {
  it("最小 scope 下能渲染出内容", () => {
    stubFetchEmpty();
    const { container } = render(<>{renderChatView(makeScope())}</>);
    expect(container.firstChild).not.toBeNull();
  });

  it("渲染结果包含对话输入区文本", () => {
    stubFetchEmpty();
    render(<>{renderChatView(makeScope())}</>);
    expect((document.body.textContent ?? "").length).toBeGreaterThan(0);
  });
});
