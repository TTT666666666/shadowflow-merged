import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BarChart3,
  Bot,
  Link2,
  Server,
  Settings,
  ShieldCheck,
  Users,
  X,
  Zap,
  AlertTriangle,
} from "lucide-react";
import EmbeddingSection from "../EmbeddingSection";
import CreditsUsageSection from "../CreditsUsageSection";
import { useI18n } from "../i18n";
import {
  useAuthState,
} from "../auth";
import {
  ApiError,
  apiFetch,
} from "../chat-api";
import {
  SfLoadState,
  SfLoadTag,
  agents,
  sfFetch,
} from "./shared";
import {
  AdvancedSection,
  AgentProfileSection,
  AppearanceSection,
  HandoffSection,
  LanguageSection,
  NotificationSection,
  ProfileSection,
} from "./settings-sections";

type ByokProviderData = {
  apiKey: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  type?: string;
  syncedModels?: string[];
  manualModels?: string[];
};
type ByokStoreData = {
  providers: Record<string, ByokProviderData>;
  defaultModel: string | null;
  routingPriority: string;
};

const BYOK_META: Record<
  string,
  { name: string; short: string; tint: string; monogram: string; defaultUrl: string; keyPlaceholder: string; noKey: boolean; docsUrl: string }
> = {
  mimo:      { name: "Xiaomi MiMo",     short: "MiMo V2.6 / V2.5",    tint: "#FF6900", monogram: "MI", defaultUrl: "https://api.xiaomimimo.com/v1",                     keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://platform.xiaomimimo.com/" },
  anthropic: { name: "Anthropic",       short: "Claude family",       tint: "#D97706", monogram: "A",  defaultUrl: "https://api.anthropic.com",                         keyPlaceholder: "sk-ant-…", noKey: false, docsUrl: "https://console.anthropic.com/settings/keys" },
  openai:    { name: "OpenAI",          short: "GPT family",          tint: "#10B981", monogram: "O",  defaultUrl: "https://api.openai.com/v1",                         keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://platform.openai.com/api-keys" },
  google:    { name: "Google Gemini",   short: "Gemini family",       tint: "#4285F4", monogram: "G",  defaultUrl: "https://generativelanguage.googleapis.com/v1beta",  keyPlaceholder: "AIza…", noKey: false, docsUrl: "https://aistudio.google.com/app/apikey" },
  deepseek:  { name: "DeepSeek",        short: "V3 / R1",             tint: "#3D8BFD", monogram: "DS", defaultUrl: "https://api.deepseek.com",                          keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://platform.deepseek.com/api_keys" },
  zhipu:     { name: "Zhipu GLM",       short: "GLM-4 family",        tint: "#1447E6", monogram: "ZP", defaultUrl: "https://open.bigmodel.cn/api/paas/v4",              keyPlaceholder: "xxxx.yyyyyy", noKey: false, docsUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  qwen:      { name: "Qwen · Alibaba",  short: "Alibaba Bailian",     tint: "#1447E6", monogram: "Qw", defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://bailian.console.aliyun.com/?apiKey=1" },
  moonshot:  { name: "Moonshot · Kimi", short: "K2 / K1.5",           tint: "#06B6D4", monogram: "MK", defaultUrl: "https://api.moonshot.cn/v1",                        keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://platform.moonshot.cn/console/api-keys" },
  mistral:   { name: "Mistral",         short: "Large 2 · Codestral", tint: "#FB923C", monogram: "Mi", defaultUrl: "https://api.mistral.ai/v1",                         keyPlaceholder: "sk-…",  noKey: false, docsUrl: "https://console.mistral.ai/api-keys/" },
  groq:      { name: "Groq",            short: "LPU inference",       tint: "#F97316", monogram: "Gr", defaultUrl: "https://api.groq.com/openai/v1",                    keyPlaceholder: "gsk_…", noKey: false, docsUrl: "https://console.groq.com/keys" },
  azure:     { name: "Azure OpenAI",    short: "Enterprise",          tint: "#0078D4", monogram: "Az", defaultUrl: "https://{deployment}.openai.azure.com",             keyPlaceholder: "…",     noKey: false, docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/openai/" },
  ollama:    { name: "Ollama",          short: "Local",               tint: "#A1A1AA", monogram: "Ol", defaultUrl: "http://localhost:11434/v1",                         keyPlaceholder: "",      noKey: true,  docsUrl: "https://ollama.com" },
  lmstudio:  { name: "LM Studio",       short: "Local",               tint: "#22C55E", monogram: "LM", defaultUrl: "http://localhost:1234/v1",                          keyPlaceholder: "",      noKey: true,  docsUrl: "https://lmstudio.ai" },
};
const BYOK_ORDER = ["mimo", "anthropic", "openai", "google", "deepseek", "zhipu", "qwen", "moonshot", "mistral", "groq", "azure", "ollama", "lmstudio"];

const DEMO_BYOK: ByokStoreData = {
  providers: {
    mimo: { apiKey: "sk-demo", baseUrl: "https://api.xiaomimimo.com/v1", models: ["mimo-v2.6-pro", "mimo-v2.6-flash"], enabled: true, syncedModels: ["mimo-v2.6-pro", "mimo-v2.6-flash"], manualModels: [] },
    zhipu: { apiKey: "xxxx.demo", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-plus", "glm-4-flash"], enabled: false, syncedModels: [], manualModels: ["glm-4-plus"] },
  },
  defaultModel: "mimo-v2.6-pro",
  routingPriority: "fallback",
};

function ModelKeysSection() {
  const [store, setStore] = useState<ByokStoreData>(DEMO_BYOK);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  const [selected, setSelected] = useState("mimo");
  const [keyDraft, setKeyDraft] = useState("");
  const [baseDraft, setBaseDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sfFetch<Partial<ByokStoreData>>("/api/settings/byok")
      .then((data) => {
        setStore({
          providers: data.providers ?? {},
          defaultModel: data.defaultModel ?? null,
          routingPriority: data.routingPriority ?? "fallback",
        });
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, []);

  const provider = store.providers[selected] ?? null;
  const meta = BYOK_META[selected];
  const defaultModelOptions = useMemo(() => {
    const out: Array<{ provider: string; id: string }> = [];
    for (const pid of BYOK_ORDER) {
      const p = store.providers[pid];
      if (!p?.enabled) continue;
      for (const m of p.models) out.push({ provider: pid, id: m });
    }
    return out;
  }, [store.providers]);

  const BLANK_PROVIDER: ByokProviderData = { apiKey: "", baseUrl: "", models: [], enabled: false };

  function updateSelected(patch: Partial<ByokProviderData>) {
    setStore((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [selected]: { ...BLANK_PROVIDER, ...(prev.providers[selected] ?? {}), ...patch },
      },
    }));
  }

  async function saveProvider(override?: Partial<ByokProviderData>) {
    const cur: ByokProviderData = { ...BLANK_PROVIDER, ...(provider ?? {}), ...(override ?? {}) };
    const body: Record<string, unknown> = {
      baseUrl: baseDraft.trim() || cur.baseUrl || meta.defaultUrl,
      models: cur.models,
      enabled: cur.enabled,
      syncedModels: cur.syncedModels ?? [],
      manualModels: cur.manualModels ?? [],
      routingPriority: store.routingPriority,
    };
    if (keyDraft.trim()) body.apiKey = keyDraft.trim();
    if (store.defaultModel) body.defaultModel = store.defaultModel;
    setBusy(true);
    try {
      await sfFetch(`/api/settings/byok/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setKeyDraft("");
      setNotice({ tone: "ok", text: `已保存 ${meta.name} 配置` });
    } catch {
      setNotice({ tone: "err", text: "保存失败，请稍后重试" });
    }
    setBusy(false);
  }

  async function pullRemote() {
    setBusy(true);
    try {
      const j = await sfFetch<{ models?: Array<string | { id?: string }> }>(`/api/settings/byok/${selected}/models/remote`);
      const ids = (j.models ?? []).map((m) => (typeof m === "string" ? m : (m.id ?? ""))).filter(Boolean);
      const merged = Array.from(new Set([...(provider?.models ?? []), ...ids]));
      const synced = Array.from(new Set([...(provider?.syncedModels ?? []), ...ids]));
      updateSelected({ models: merged, syncedModels: synced });
      setNotice({ tone: "ok", text: `已拉取 ${ids.length} 个远端模型，点击「保存配置」入库` });
    } catch {
      setNotice({ tone: "err", text: "远端拉取失败：请先填写密钥与 Base URL 并保存" });
    }
    setBusy(false);
  }

  async function checkConn() {
    setBusy(true);
    try {
      const j = await sfFetch<{ overall?: string }>(`/api/settings/byok/${selected}/check`, { method: "POST" });
      setNotice({ tone: j.overall === "ok" ? "ok" : "err", text: j.overall === "ok" ? "连接正常，密钥有效" : `连接检查结果：${j.overall ?? "失败"}` });
    } catch {
      setNotice({ tone: "err", text: "连接检查失败（先保存密钥与 Base URL）" });
    }
    setBusy(false);
  }

  async function revealKey() {
    if (revealedKey !== null) {
      setRevealedKey(null);
      return;
    }
    try {
      const j = await sfFetch<{ apiKey?: string }>(`/api/settings/byok/${selected}/reveal`);
      setRevealedKey(j.apiKey ?? "");
    } catch {
      setNotice({ tone: "err", text: "无法读取密钥（该提供商尚未配置）" });
    }
  }

  async function removeProvider() {
    setBusy(true);
    try {
      await sfFetch(`/api/settings/byok/${selected}`, { method: "DELETE" });
      setStore((prev) => {
        const next = { ...prev.providers };
        delete next[selected];
        return { ...prev, providers: next };
      });
      setNotice({ tone: "ok", text: `已删除 ${meta.name} 配置` });
    } catch {
      setNotice({ tone: "err", text: "删除失败，请稍后重试" });
    }
    setBusy(false);
  }

  function addModel() {
    const id = modelDraft.trim();
    if (!id) return;
    const models = provider?.models ?? [];
    if (models.includes(id)) {
      setNotice({ tone: "info", text: "该模型已在列表中" });
      return;
    }
    updateSelected({ models: [...models, id], manualModels: Array.from(new Set([...(provider?.manualModels ?? []), id])) });
    setModelDraft("");
    setNotice({ tone: "info", text: `已添加自定义模型 ${id}，点击「保存配置」入库` });
  }

  function removeModel(id: string) {
    updateSelected({
      models: (provider?.models ?? []).filter((m) => m !== id),
      manualModels: (provider?.manualModels ?? []).filter((m) => m !== id),
      syncedModels: (provider?.syncedModels ?? []).filter((m) => m !== id),
    });
  }

  async function persistDefaults(patch: Partial<ByokStoreData>) {
    const next = { ...store, ...patch };
    setStore(next);
    try {
      await sfFetch(`/api/settings/byok/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultModel: next.defaultModel ?? undefined,
          routingPriority: next.routingPriority,
        }),
      });
    } catch {
      /* 演示态忽略 */
    }
  }

  return (
    <div className="sf-byok">
      <div className="sf-byok-top">
        <div className="sf-setting-block">
          <div>
            <span>
              <Server />
            </span>
            <div>
              <strong>默认模型</strong>
              <small>新对话与 Agent 的默认推理模型</small>
            </div>
          </div>
          <select
            className="sf-select"
            value={store.defaultModel ?? ""}
            onChange={(e) => persistDefaults({ defaultModel: e.target.value || null })}
          >
            <option value="">未设置</option>
            {defaultModelOptions.map((o) => (
              <option key={`${o.provider}:${o.id}`} value={o.id}>
                {BYOK_META[o.provider]?.name ?? o.provider} · {o.id}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-setting-block">
          <div>
            <span>
              <Link2 />
            </span>
            <div>
              <strong>模型回退链</strong>
              <small>主模型不可用时自动切换</small>
            </div>
          </div>
          <button
            type="button"
            className={`sf-switch ${store.routingPriority === "fallback" ? "on" : ""}`}
            onClick={() => persistDefaults({ routingPriority: store.routingPriority === "fallback" ? "off" : "fallback" })}
            aria-label="切换模型回退链"
          >
            <i />
          </button>
        </div>
      </div>
      <SfLoadTag state={loadState} />
      <div className="sf-byok-layout">
        <aside className="sf-byok-rail">
          {BYOK_ORDER.map((pid) => {
            const p = store.providers[pid];
            const m = BYOK_META[pid];
            return (
              <button
                key={pid}
                type="button"
                className={selected === pid ? "active" : ""}
                onClick={() => {
                  setSelected(pid);
                  setKeyDraft("");
                  setBaseDraft("");
                  setModelDraft("");
                  setRevealedKey(null);
                  setNotice(null);
                }}
              >
                <i style={{ background: m.tint }}>{m.monogram}</i>
                <div>
                  <strong>{m.name}</strong>
                  <small>{p?.apiKey ? (p.enabled ? "已启用" : "已配置") : m.short}</small>
                </div>
                {p?.enabled ? <b /> : null}
              </button>
            );
          })}
        </aside>
        <div className="sf-byok-detail">
          <header>
            <div>
              <h2>{meta.name}</h2>
              <span>{meta.short} · {meta.defaultUrl}</span>
            </div>
            <button
              type="button"
              className={`sf-switch ${provider?.enabled ? "on" : ""}`}
              onClick={() => {
                const next = !provider?.enabled;
                updateSelected({ enabled: next });
                saveProvider({ enabled: next });
              }}
              aria-label="启用该提供商"
            >
              <i />
            </button>
          </header>
          <label className="sf-byok-field">
            <span>API 密钥</span>
            <div>
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={provider?.apiKey ? provider.apiKey : meta.keyPlaceholder}
                autoComplete="off"
              />
              <button type="button" onClick={revealKey}>
                {revealedKey !== null ? "隐藏" : "显示"}
              </button>
            </div>
            {revealedKey !== null && <code className="sf-byok-reveal">{revealedKey || "(空)"}</code>}
            <small>
              密钥仅保存在你的工作空间中 · <a href={meta.docsUrl} target="_blank" rel="noreferrer">点击这里获取密钥</a>
            </small>
          </label>
          <label className="sf-byok-field">
            <span>Base URL</span>
            <div>
              <input
                value={baseDraft || provider?.baseUrl || ""}
                onChange={(e) => setBaseDraft(e.target.value)}
                placeholder={meta.defaultUrl}
                disabled={meta.noKey && !provider?.baseUrl ? false : undefined}
              />
            </div>
            <small>OpenAI 兼容接口地址，留空使用官方默认端点</small>
          </label>
          <div className="sf-byok-field">
            <span>
              模型列表 <em>支持自定义模型</em>
            </span>
            <div className="sf-byok-models">
              {(provider?.models ?? []).map((mid) => (
                <button key={mid} type="button" className="sf-model-chip" onClick={() => removeModel(mid)} title="点击移除">
                  {mid} <X size={11} />
                </button>
              ))}
              {(provider?.models ?? []).length === 0 && (
                <em className="sf-byok-empty">暂无模型：可在下方手动添加自定义模型，或从远端拉取</em>
              )}
            </div>
            <div className="sf-byok-add">
              <input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addModel();
                  }
                }}
                placeholder="输入模型 ID，如 mimo-v2.6-pro 或任意自定义模型"
              />
              <button type="button" onClick={addModel}>
                添加模型
              </button>
              <button type="button" onClick={pullRemote} disabled={busy}>
                拉取远端模型
              </button>
            </div>
          </div>
          <div className="sf-byok-actions">
            <button type="button" className="sf-primary" onClick={() => saveProvider()} disabled={busy}>
              保存配置
            </button>
            <button type="button" onClick={checkConn} disabled={busy}>
              测试连接
            </button>
            <button type="button" onClick={revealKey} disabled={busy}>
              {revealedKey !== null ? "隐藏密钥" : "显示密钥"}
            </button>
            <button type="button" className="sf-danger" onClick={removeProvider} disabled={busy}>
              删除配置
            </button>
          </div>
          {notice && <p className={`sf-byok-notice ${notice.tone}`}>{notice.text}</p>}
        </div>
      </div>
    </div>
  );
}

function SkillsSettingsList() {
  type Row = { skill_id: string; name: string; description?: string; enabled?: boolean; source?: string };
  const [items, setItems] = useState<Row[] | null>(null);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  useEffect(() => {
    sfFetch<Row[]>("/api/skills")
      .then((list) => {
        setItems(Array.isArray(list) ? list : []);
        setLoadState("ready");
      })
      .catch(() => {
        setItems(null);
        setLoadState("error");
      });
  }, []);
  return (
    <div className="sf-settings-list">
      <SfLoadTag state={loadState} />
      {(items ?? []).map((row) => (
        <article key={row.skill_id}>
          <strong>{row.name || row.skill_id}</strong>
          <p>{row.description ?? row.skill_id}</p>
          <span>
            {row.source ?? "builtin"}
            {row.enabled === false ? " · 已停用" : " · 已启用"}
          </span>
        </article>
      ))}
      {items !== null && items.length === 0 && <em className="sf-byok-empty">暂无技能数据</em>}
    </div>
  );
}

function CliProvidersSection() {
  type Row = { id: string; name?: string; version?: string | null; installed?: boolean };
  const [items, setItems] = useState<Row[] | null>(null);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  useEffect(() => {
    sfFetch<{ agents?: Row[] }>("/api/settings/agents/detect")
      .then((j) => {
        setItems((j.agents ?? []).filter((a) => a.installed !== false));
        setLoadState("ready");
      })
      .catch(() => {
        setItems(null);
        setLoadState("error");
      });
  }, []);
  return (
    <div className="sf-settings-list">
      <SfLoadTag state={loadState} />
      {(items ?? []).map((row) => (
        <article key={row.id}>
          <strong>{row.name || row.id}</strong>
          <p>本地 CLI 执行器 · {row.version || "版本未知"}</p>
          <span>{row.installed ? "已安装" : "未安装"}</span>
        </article>
      ))}
      {items !== null && items.length === 0 && <em className="sf-byok-empty">未检测到本地 CLI 执行器</em>}
    </div>
  );
}

function ConnectorsSection({ mcp }: { mcp?: boolean }) {
  type Row = {
    id: string;
    name: string;
    kind?: string;
    transport?: string;
    status?: string;
    policy?: { enabled?: boolean; approval_mode?: string };
  };
  const [items, setItems] = useState<Row[] | null>(null);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  useEffect(() => {
    sfFetch<{ items?: Row[] }>("/api/connectors")
      .then((j) => {
        const list = j.items ?? [];
        setItems(mcp ? list.filter((c) => c.transport === "stdio" || c.transport === "http") : list);
        setLoadState("ready");
      })
      .catch(() => {
        setItems(null);
        setLoadState("error");
      });
  }, [mcp]);

  // 策略操作（POST /api/connectors/:id/policy）：启用/停用 + 审批模式循环
  const APPROVAL_CYCLE = ["auto", "prompt", "block"] as const;
  async function patchPolicy(row: Row, patch: { enabled?: boolean; approval_mode?: string }) {
    try {
      await sfFetch(`/api/connectors/${encodeURIComponent(row.id)}/policy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setItems((cur) =>
        (cur ?? []).map((c) =>
          c.id === row.id ? { ...c, policy: { ...(c.policy ?? {}), ...patch } } : c,
        ),
      );
    } catch {
      /* 失败保持原状态 */
    }
  }
  function cycleApproval(row: Row) {
    const cur = row.policy?.approval_mode ?? "auto";
    const next = APPROVAL_CYCLE[(APPROVAL_CYCLE.indexOf(cur as (typeof APPROVAL_CYCLE)[number]) + 1) % APPROVAL_CYCLE.length];
    void patchPolicy(row, { approval_mode: next });
  }

  return (
    <div className="sf-settings-list">
      <SfLoadTag state={loadState} />
      {(items ?? []).map((row) => {
        const on = row.policy?.enabled !== false;
        return (
          <article key={row.id}>
            <strong>{row.name || row.id}</strong>
            <p>
              {row.kind ?? "connector"} · {row.transport ?? "stdio"} · {row.status ?? "未知状态"}
            </p>
            <span>
              {on ? "已启用" : "已禁用"} · 审批 {row.policy?.approval_mode ?? "auto"}
              <button
                type="button"
                className="sf-settings-act"
                onClick={() => void patchPolicy(row, { enabled: !on })}
              >
                {on ? "停用" : "启用"}
              </button>
              <button
                type="button"
                className="sf-settings-act"
                title="切换审批模式 auto → prompt → block"
                onClick={() => cycleApproval(row)}
              >
                切换审批
              </button>
            </span>
          </article>
        );
      })}
      {items !== null && items.length === 0 && <em className="sf-byok-empty">暂无{mcp ? " MCP " : " "}连接器</em>}
    </div>
  );
}

function MemoryEntriesSection() {
  type Row = { id: string; scope?: string; title?: string; content?: string; created_at?: string };
  const [items, setItems] = useState<Row[] | null>(null);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    sfFetch<Row[]>("/api/memory-entries")
      .then((list) => {
        setItems(Array.isArray(list) ? list : []);
        setLoadState("ready");
      })
      .catch(() => {
        setItems(null);
        setLoadState("error");
      });
    sfFetch<{ enabled?: boolean }>("/api/memory-entries/settings")
      .then((j) => setEnabled(j.enabled !== false))
      .catch(() => undefined);
  }, []);
  function toggleMemory() {
    const next = !enabled;
    setEnabled(next);
    sfFetch("/api/memory-entries/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => undefined);
  }
  return (
    <div className="sf-settings-list">
      <div className="sf-setting-block">
        <div>
          <span>
            <Bot />
          </span>
          <div>
            <strong>记忆写回</strong>
            <small>允许 Agent 把经验沉淀为记忆条目</small>
          </div>
        </div>
        <button type="button" className={`sf-switch ${enabled ? "on" : ""}`} onClick={toggleMemory} aria-label="切换记忆写回">
          <i />
        </button>
      </div>
      <SfLoadTag state={loadState} />
      {(items ?? []).slice(0, 12).map((row) => (
        <article key={row.id}>
          <strong>{row.title || row.id.slice(0, 8)}</strong>
          <p>{(row.content ?? "").slice(0, 90) || "（无内容）"}</p>
          <span>
            {row.scope ?? "user"} · {row.created_at ? String(row.created_at).slice(0, 10) : ""}
          </span>
        </article>
      ))}
      {items !== null && items.length === 0 && <em className="sf-byok-empty">暂无记忆条目</em>}
    </div>
  );
}

type AdminUserRow = {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  auth_type?: string;
  role?: string | null;
  disabled?: boolean;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  resource_count?: number;
};

/** 管理员用户管理：GET /api/admin/users（{users:[…]} 信封）+ PATCH 角色/停用 + DELETE。
 *  403 = 无管理员权限，404 = 接口未就绪 → 分别给出引导（待联调）。 */
function AdminUsersSection() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "forbidden" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setNotice(null);
    try {
      const json = await apiFetch<{ data?: AdminUserRow[]; users?: AdminUserRow[] } | AdminUserRow[]>(
        "/api/admin/users",
      );
      const list = Array.isArray(json)
        ? json
        : ((json?.data ?? json?.users ?? []) as AdminUserRow[]);
      setRows(list);
      setState("ready");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 403) {
        setState("forbidden");
      } else if (status === 404) {
        setState("unavailable");
      } else {
        setState("error");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchUser(userId: string, patch: { role?: string; disabled?: boolean }) {
    setBusyId(userId);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
      setNotice("已更新");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(userId: string) {
    if (!window.confirm("确认删除该用户？此操作不可撤销。")) return;
    setBusyId(userId);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      await load();
      setNotice("已删除");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  if (state === "loading") return <p className="sf-live-tag">正在加载用户列表…</p>;
  if (state === "forbidden") {
    return (
      <div className="sf-settings-placeholder">
        <ShieldCheck size={25} />
        <strong>无管理员权限</strong>
        <p>当前账号不是管理员，无法查看用户列表（后端返回 403 FORBIDDEN）。</p>
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="sf-settings-placeholder">
        <ShieldCheck size={25} />
        <strong>管理员接口未就绪</strong>
        <p>后端 /api/admin/users 返回 404，用户管理暂不可用（待后端联调）。</p>
        <button type="button" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="sf-settings-placeholder">
        <AlertTriangle size={25} />
        <button type="button" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="sf-admin-users">
      <div className="sf-admin-users-head">
        <span>共 {(rows ?? []).length} 个用户</span>
        <button type="button" className="sf-link-btn" onClick={() => void load()}>
          刷新
        </button>
        {notice && <em className="sf-admin-notice">{notice}</em>}
      </div>
      {(rows ?? []).length === 0 && <em className="sf-byok-empty">暂无用户</em>}
      {(rows ?? []).map((row) => (
        <article key={row.user_id}>
          <div>
            <strong>{row.display_name || row.email || row.user_id.slice(0, 8)}</strong>
            <small>
              {row.email ?? ""} · {row.auth_type ?? "email"} · {row.role ?? "user"}
              {row.disabled ? " · 已停用" : ""}
              {row.resource_count != null ? ` · ${row.resource_count} 个资源` : ""}
            </small>
          </div>
          <div className="sf-admin-actions">
            <button
              type="button"
              disabled={busyId === row.user_id}
              onClick={() =>
                void patchUser(row.user_id, { role: row.role === "admin" ? "user" : "admin" })
              }
            >
              {row.role === "admin" ? "取消管理员" : "设为管理员"}
            </button>
            <button
              type="button"
              disabled={busyId === row.user_id}
              onClick={() => void patchUser(row.user_id, { disabled: !row.disabled })}
            >
              {row.disabled ? "启用" : "停用"}
            </button>
            <button
              type="button"
              className="sf-danger-btn"
              disabled={busyId === row.user_id}
              onClick={() => void deleteUser(row.user_id)}
            >
              删除
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SettingsView() {
  const auth = useAuthState();
  const isAdmin = auth.user?.role === "admin";
  const [section, setSection] = useState("模型与密钥");
  /* 界面文案中英切换（2026-11-10）：此前切 English 只有日期/货币格式变，文案全是中文。
     现在导航与分区标题走 t()，切语言即时生效（订阅偏好，无需刷新）。 */
  const { t } = useI18n();
  const groups: Array<[string, string[]]> = [
    ["账户", ["个人资料"]],
    ["外观", ["主题与显示", "语言"]],
    ["集成", ["Skills", "模型与密钥", "向量模型", "工具提供商", "连接器", "MCP 集成"]],
    ["记忆", ["记忆条目", "Agent 画像", "交接与写回"]],
    ["计费", ["用量"]],
    ["数据", ["通知", "高级设置"]],
  ];
  if (isAdmin) groups.push(["管理员", ["用户管理"]]);
  return (
    <section className="sf-settings">
      <aside>
        {groups.map(([group, items]) => (
          <div key={group}>
            <p>{t(group)}</p>
            {items.map((item) => (
              <button
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => setSection(item)}
              >
                {item === "模型与密钥" ? (
                  <Server size={15} />
                ) : item === "向量模型" ? (
                  <Zap size={15} />
                ) : item === "用量" ? (
                  <BarChart3 size={15} />
                ) : item === "个人资料" ? (
                  <Users size={15} />
                ) : item === "用户管理" ? (
                  <ShieldCheck size={15} />
                ) : item.includes("记忆") ? (
                  <Bot size={15} />
                ) : (
                  <Settings size={15} />
                )}
                {t(item)}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <div className="sf-settings-content">
        <p>SETTINGS</p>
        <h1>{section}</h1>
        {section === "模型与密钥" ? (
          <ModelKeysSection />
        ) : section === "向量模型" ? (
          <EmbeddingSection />
        ) : section === "Skills" ? (
          <SkillsSettingsList />
        ) : section === "工具提供商" ? (
          <CliProvidersSection />
        ) : section === "连接器" ? (
          <ConnectorsSection />
        ) : section === "MCP 集成" ? (
          <ConnectorsSection mcp />
        ) : section === "记忆条目" ? (
          <MemoryEntriesSection />
        ) : section === "用量" ? (
          <CreditsUsageSection />
        ) : section === "用户管理" ? (
          <AdminUsersSection />
        ) : section === "个人资料" ? (
          <ProfileSection />
        ) : section === "主题与显示" ? (
          <AppearanceSection />
        ) : section === "语言" ? (
          <LanguageSection />
        ) : section === "Agent 画像" ? (
          <AgentProfileSection />
        ) : section === "交接与写回" ? (
          <HandoffSection />
        ) : section === "通知" ? (
          <NotificationSection />
        ) : section === "高级设置" ? (
          <AdvancedSection />
        ) : (
          <div className="sf-settings-placeholder">
            <Settings size={25} />
            <strong>{section}</strong>
            <p>在这里管理 {section} 相关配置。所有修改会应用到当前工作空间。</p>
            <button>保存设置</button>
          </div>
        )}
      </div>
    </section>
  );
}
