/**
 * 设置页的「偏好类」栏目（2026-11-10）。
 *
 * 此前设置页有 7 个栏目（个人资料 / 主题与显示 / 语言 / Agent 画像 /
 * 交接与写回 / 通知 / 高级设置）全部落到同一个占位卡片：一个假的
 * 「保存设置」按钮，点了什么也不会发生。这里把它们逐个做成真功能：
 *
 *   - 个人资料  → POST /api/auth/profile 真改数据库里的 display_name
 *   - 主题与显示 → 写 localStorage + 落 <html data-sf-*>，CSS 立即响应
 *   - 语言      → locale / 时制 / 货币，落到 Intl 格式化与 <html lang>
 *   - Agent 画像 → GET/POST /api/memory/handoff/profiles/* 真读真写
 *   - 交接与写回 → GET /api/memory/handoff/stats + /context/reads 真实统计
 *   - 通知      → Notification API 真申请权限、真发测试通知
 *   - 高级设置  → 导出/重置本地偏好、清缓存（保留登录态）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  Copy,
  Download,
  Globe,
  History,
  Monitor,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { displayNameOf, initialsOf, refreshAuth, useAuthState } from "../auth";
import { ApiError, apiFetch } from "../chat-api";
import { SfLoadState, SfLoadTag, sfFetch } from "./shared";
import {
  currentPrefs,
  formatDateTime,
  formatMoney,
  formatNumber,
  resetPrefs,
  subscribePrefs,
  writePrefs,
  type SfPrefs,
} from "../settings-prefs";

type Note = { tone: "ok" | "err" | "info"; text: string } | null;

/**
 * 记忆库里两种时间戳口径并存：画像表写 `Date.now()`（毫秒），
 * 读取留痕写 `Math.floor(Date.now()/1000)`（秒）。按数量级判断，
 * 1e11 以上的必然是毫秒（1e11 ms ≈ 1973 年，秒级要到 5138 年才追上）。
 * 直接把秒当毫秒乘 1000 会显示成 58828 年 —— 这里统一收口。
 */
function epoch(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 1e11 ? value : value * 1000;
}

function NoteBar({ note }: { note: Note }) {
  if (!note) return null;
  return <p className={`sf-settings-note ${note.tone}`}>{note.text}</p>;
}

/** 统一的「选项条」：左标题说明，右一组互斥按钮。 */
function PrefRow<T extends string | number>({
  title,
  hint,
  value,
  options,
  onChange,
}: {
  title: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="sf-pref-row">
      <div>
        <strong>{title}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="sf-chip-row" role="group" aria-label={title}>
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={`sf-chip ${opt.value === value ? "on" : ""}`}
            aria-pressed={opt.value === value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 1. 个人资料 ───────────────────────────────────────────────────────────────

export function ProfileSection() {
  const auth = useAuthState();
  const user = auth.user;
  const [name, setName] = useState(user?.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(user?.display_name ?? "");
  }, [user?.display_name]);

  const isGuest = !user || user.auth_type === "guest";
  const dirty = (user?.display_name ?? "") !== name.trim();

  async function save() {
    if (!name.trim()) {
      setNote({ tone: "err", text: "显示名不能为空" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await apiFetch("/api/auth/profile", {
        method: "POST",
        body: JSON.stringify({ display_name: name.trim() }),
      });
      await refreshAuth();
      setNote({ tone: "ok", text: "显示名已保存" });
    } catch (err) {
      const detail =
        err instanceof ApiError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : "未知错误";
      setNote({ tone: "err", text: `保存失败：${detail}` });
    } finally {
      setBusy(false);
    }
  }

  async function copyId() {
    const id = user?.user_id || user?.address || "";
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNote({ tone: "err", text: "复制失败：浏览器拒绝了剪贴板权限" });
    }
  }

  if (!user) {
    return (
      <div className="sf-settings-list">
        <SfLoadTag state={auth.ready ? "error" : "loading"} />
        <p className="sf-settings-empty">未登录或会话已过期，请重新登录后再查看个人资料。</p>
      </div>
    );
  }

  return (
    <div className="sf-settings-list">
      <div className="sf-profile-card">
        <span className="sf-profile-avatar">{initialsOf(user)}</span>
        <div>
          <strong>{displayNameOf(user)}</strong>
          <small>
            {user.email || user.address}
            {" · "}
            {user.auth_type === "email" ? "邮箱账号" : user.auth_type === "wallet" ? "钱包账号" : "游客"}
            {user.role === "admin" ? " · 管理员" : ""}
          </small>
        </div>
      </div>

      <div className="sf-setting-block sf-setting-block-form">
        <div>
          <span>
            <User size={15} />
          </span>
          <div>
            <strong>显示名</strong>
            <small>就是你在这里看到的名字，改完立即同步到整个界面</small>
          </div>
        </div>
        <div className="sf-inline-form">
          <input
            value={name}
            maxLength={80}
            disabled={isGuest || busy}
            placeholder={isGuest ? "游客账号不支持修改" : "输入显示名"}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className="sf-primary-btn" disabled={isGuest || busy || !dirty} onClick={() => void save()}>
            <Save size={13} />
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {isGuest && (
        <p className="sf-settings-hint">
          当前是游客身份（浏览器本地会话）。注册或登录后，显示名才会写进服务器并在其他设备生效。
        </p>
      )}

      <dl className="sf-kv">
        <div>
          <dt>账号 ID</dt>
          <dd>
            <code>{user.user_id || "—"}</code>
            <button type="button" className="sf-mini-btn" onClick={() => void copyId()}>
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "已复制" : "复制"}
            </button>
          </dd>
        </div>
        <div>
          <dt>登录方式</dt>
          <dd>{user.auth_type}</dd>
        </div>
        <div>
          <dt>角色</dt>
          <dd>{user.role || "user"}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{user.disabled ? "已停用" : "正常"}</dd>
        </div>
      </dl>

      <NoteBar note={note} />
    </div>
  );
}

// ── 2. 主题与显示 ─────────────────────────────────────────────────────────────

export function AppearanceSection() {
  const [prefs, setPrefs] = useState<SfPrefs>(() => currentPrefs());
  useEffect(() => subscribePrefs(setPrefs), []);
  const patch = useCallback((next: Partial<SfPrefs>) => setPrefs(writePrefs(next)), []);

  return (
    <div className="sf-settings-list">
      <p className="sf-settings-hint">
        这里的每一项都即时生效并保存在本机（localStorage），不需要点保存。换设备不会同步——观感是「这台机器」的偏好。
      </p>

      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Monitor size={15} />
          <strong>界面</strong>
        </div>
        <PrefRow
          title="界面缩放"
          hint="紧凑 = 0.94 倍，一屏多放一点内容"
          value={prefs.zoom}
          options={[
            { value: "compact", label: "紧凑" },
            { value: "standard", label: "标准" },
          ]}
          onChange={(next) => patch({ zoom: next })}
        />
        <PrefRow
          title="左侧栏宽度"
          hint="对话 / 项目列表中文字较长时可以放宽"
          value={prefs.railWidth}
          options={[
            { value: 196, label: "窄" },
            { value: 224, label: "标准" },
            { value: 252, label: "宽" },
          ]}
          onChange={(next) => patch({ railWidth: next })}
        />
        <PrefRow
          title="列表密度"
          hint="紧凑会缩小列表项与卡片内边距"
          value={prefs.density}
          options={[
            { value: "comfortable", label: "宽松" },
            { value: "compact", label: "紧凑" },
          ]}
          onChange={(next) => patch({ density: next })}
        />
        <PrefRow
          title="动效"
          hint="减少动效会关掉过渡与动画，降低视觉干扰"
          value={prefs.motion}
          options={[
            { value: "full", label: "标准" },
            { value: "reduce", label: "减少" },
          ]}
          onChange={(next) => patch({ motion: next })}
        />
      </div>

      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Palette size={15} />
          <strong>强调色</strong>
        </div>
        <div className="sf-accent-row">
          {(
            [
              { value: "coral", label: "珊瑚", color: "#ff5e3a" },
              { value: "violet", label: "紫罗兰", color: "#8e6cff" },
              { value: "teal", label: "青绿", color: "#14b8a6" },
              { value: "ink", label: "墨黑", color: "#2f2e2b" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`sf-accent ${prefs.accent === item.value ? "on" : ""}`}
              aria-pressed={prefs.accent === item.value}
              onClick={() => patch({ accent: item.value })}
            >
              <i style={{ background: item.color }} />
              {item.label}
              {prefs.accent === item.value ? <Check size={12} /> : null}
            </button>
          ))}
        </div>
        <p className="sf-settings-hint">
          强调色作用于主按钮、选中态与高亮标记。深色主题尚未交付：现有样式表里的颜色是逐条硬编码的，需要先做一轮变量化迁移，硬切会大面积出现「深底黑字」。
        </p>
      </div>
    </div>
  );
}

// ── 3. 语言 ───────────────────────────────────────────────────────────────────

export function LanguageSection() {
  const [prefs, setPrefs] = useState<SfPrefs>(() => currentPrefs());
  useEffect(() => subscribePrefs(setPrefs), []);
  const patch = useCallback((next: Partial<SfPrefs>) => setPrefs(writePrefs(next)), []);

  const sample = useMemo(() => {
    const now = new Date();
    return {
      datetime: formatDateTime(now, prefs),
      money: formatMoney(128800, prefs),
      number: formatNumber(1234567, prefs),
    };
  }, [prefs]);

  return (
    <div className="sf-settings-list">
      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Globe size={15} />
          <strong>区域与格式</strong>
        </div>
        <PrefRow
          title="界面语言"
          hint="影响日期、时间、货币与数字的显示格式（界面文案的中英全量翻译尚未交付）"
          value={prefs.locale}
          options={[
            { value: "zh-CN", label: "简体中文" },
            { value: "en-US", label: "English" },
          ]}
          onChange={(next) => patch({ locale: next })}
        />
        <PrefRow
          title="时间制"
          hint="12 小时制会显示 AM / PM"
          value={prefs.hour12 ? "h12" : "h24"}
          options={[
            { value: "h24", label: "24 小时" },
            { value: "h12", label: "12 小时" },
          ]}
          onChange={(next) => patch({ hour12: next === "h12" })}
        />
        <PrefRow
          title="货币"
          hint="看板里的金额按这个币种显示（不做汇率换算，只换符号与格式）"
          value={prefs.currency}
          options={[
            { value: "CNY", label: "人民币 ¥" },
            { value: "USD", label: "美元 $" },
          ]}
          onChange={(next) => patch({ currency: next })}
        />
      </div>

      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <History size={15} />
          <strong>格式预览</strong>
        </div>
        <dl className="sf-kv">
          <div>
            <dt>日期时间</dt>
            <dd>{sample.datetime}</dd>
          </div>
          <div>
            <dt>金额</dt>
            <dd>{sample.money}</dd>
          </div>
          <div>
            <dt>数字</dt>
            <dd>{sample.number}</dd>
          </div>
        </dl>
        <p className="sf-settings-hint">
          预览就是真实格式化函数的输出（Intl），新界面元素已经在用它；历史页面里写死的格式会在后续迁移时逐个替换。
        </p>
      </div>
    </div>
  );
}

// ── 4. 通知 ───────────────────────────────────────────────────────────────────

export function NotificationSection() {
  const [prefs, setPrefs] = useState<SfPrefs>(() => currentPrefs());
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [note, setNote] = useState<Note>(null);
  useEffect(() => subscribePrefs(setPrefs), []);
  const patch = useCallback((next: Partial<SfPrefs>) => setPrefs(writePrefs(next)), []);

  async function askPermission() {
    if (typeof Notification === "undefined") {
      setNote({ tone: "err", text: "当前浏览器不支持桌面通知" });
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      patch({ notifyDesktop: true });
      setNote({ tone: "ok", text: "已获得通知权限" });
    } else if (result === "denied") {
      setNote({ tone: "err", text: "权限被拒绝。需要在浏览器地址栏的站点设置里手动改回允许" });
    }
  }

  function testNotify() {
    if (typeof Notification === "undefined") {
      setNote({ tone: "err", text: "当前浏览器不支持桌面通知" });
      return;
    }
    if (Notification.permission !== "granted") {
      setNote({ tone: "err", text: "还没有通知权限，先点上面的「申请权限」" });
      return;
    }
    new Notification("ShadowFlow 测试通知", {
      body: "看到这条说明桌面通知已经通了。",
      tag: "sf-test",
    });
    setNote({ tone: "ok", text: "已发送一条测试通知" });
  }

  const permissionLabel =
    permission === "unsupported"
      ? "浏览器不支持"
      : permission === "granted"
        ? "已允许"
        : permission === "denied"
          ? "已被拒绝"
          : "尚未询问";

  return (
    <div className="sf-settings-list">
      <div className="sf-setting-block">
        <div>
          <span>
            <Bell size={15} />
          </span>
          <div>
            <strong>桌面通知</strong>
            <small>浏览器通知权限：{permissionLabel}</small>
          </div>
        </div>
        <div className="sf-inline-actions">
          <button type="button" className="sf-secondary-btn" onClick={() => void askPermission()}>
            申请权限
          </button>
          <button type="button" className="sf-secondary-btn" onClick={testNotify}>
            发测试通知
          </button>
        </div>
      </div>

      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Bell size={15} />
          <strong>提醒范围</strong>
        </div>
        {(
          [
            {
              key: "notifyDesktop",
              title: "任务完成时弹桌面通知",
              hint: "团队跑完一轮任务后提醒你去查看结果",
            },
            {
              key: "notifyOnRunDone",
              title: "只提醒真正结束的任务",
              hint: "关掉后连中间步骤的完成也会提醒（更吵）",
            },
            {
              key: "notifySound",
              title: "同时播放提示音",
              hint: "用浏览器内置的提示音，不需要额外音频文件",
            },
          ] as const
        ).map((row) => (
          <div className="sf-setting-block" key={row.key}>
            <div>
              <span>
                <Bell size={15} />
              </span>
              <div>
                <strong>{row.title}</strong>
                <small>{row.hint}</small>
              </div>
            </div>
            <button
              type="button"
              className={`sf-switch ${prefs[row.key] ? "on" : ""}`}
              aria-label={row.title}
              aria-pressed={prefs[row.key]}
              onClick={() => patch({ [row.key]: !prefs[row.key] } as Partial<SfPrefs>)}
            >
              <i />
            </button>
          </div>
        ))}
      </div>

      <NoteBar note={note} />
    </div>
  );
}

// ── 5. Agent 画像 ─────────────────────────────────────────────────────────────

type ProfileValue = {
  key: string;
  value: string;
  confidence: number;
  source: string;
  evidence: string;
  updated_at: number;
};
type ProfileHistory = {
  key: string;
  old_value: string | null;
  new_value: string;
  action: string;
  confidence: number;
  source: string;
  actor: string;
  created_at: number;
};
type ProfilePayload = {
  subject: { type: string; id: string };
  profile: ProfileValue[];
  history: ProfileHistory[];
  writes: number;
  conflicts: number;
  pending_conflicts: number;
};

export function AgentProfileSection() {
  const [subjectType, setSubjectType] = useState<"customer" | "agent" | "user">("customer");
  const [subjectId, setSubjectId] = useState("default");
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [state, setState] = useState<SfLoadState>("loading");
  const [note, setNote] = useState<Note>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [draftConfidence, setDraftConfidence] = useState(70);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = await sfFetch<ProfilePayload>(
        `/api/memory/handoff/profiles/${encodeURIComponent(subjectId)}?subject_type=${subjectType}`,
      );
      setData(payload);
      setState("ready");
    } catch {
      setData(null);
      setState("error");
    }
  }, [subjectId, subjectType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function writeback() {
    if (!draftKey.trim() || !draftValue.trim()) {
      setNote({ tone: "err", text: "key 与 value 都要填" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await apiFetch("/api/memory/handoff/profiles/writeback", {
        method: "POST",
        body: JSON.stringify({
          subject_type: subjectType,
          subject_id: subjectId,
          key: draftKey.trim(),
          value: draftValue.trim(),
          confidence: draftConfidence / 100,
          source: "manual",
          actor: "settings",
        }),
      });
      setDraftKey("");
      setDraftValue("");
      setNote({ tone: "ok", text: "已写回一条画像" });
      await load();
    } catch (err) {
      const detail =
        err instanceof ApiError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : "未知错误";
      setNote({ tone: "err", text: `写回失败：${detail}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-settings-list">
      <div className="sf-setting-block sf-setting-block-form">
        <div>
          <span>
            <Bot size={15} />
          </span>
          <div>
            <strong>选择画像主体</strong>
            <small>客户画像、Agent 自身画像、用户画像共用同一张表，用 type + id 区分</small>
          </div>
        </div>
        <div className="sf-inline-form">
          <select value={subjectType} onChange={(event) => setSubjectType(event.target.value as "customer" | "agent" | "user")}>
            <option value="customer">客户 customer</option>
            <option value="agent">Agent</option>
            <option value="user">用户 user</option>
          </select>
          <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="subject id" />
          <button type="button" className="sf-secondary-btn" onClick={() => void load()}>
            <RefreshCw size={13} />
            刷新
          </button>
        </div>
      </div>

      <SfLoadTag state={state} />

      {data && (
        <>
          <div className="sf-kpi-inline">
            <div>
              <small>画像条目</small>
              <strong>{data.profile.length}</strong>
            </div>
            <div>
              <small>累计写回</small>
              <strong>{data.writes}</strong>
            </div>
            <div>
              <small>待裁决冲突</small>
              <strong className={data.pending_conflicts > 0 ? "warn" : ""}>{data.pending_conflicts}</strong>
            </div>
            <div>
              <small>历史冲突</small>
              <strong>{data.conflicts}</strong>
            </div>
          </div>

          {data.pending_conflicts > 0 && (
            <p className="sf-settings-hint warn">
              <AlertTriangle size={13} /> 有 {data.pending_conflicts} 条冲突待裁决（新值与旧值置信度接近）。裁决入口在
              「交接与写回」页的冲突列表。
            </p>
          )}

          {data.profile.length === 0 ? (
            <p className="sf-settings-empty">这个主体还没有画像条目 —— 用下面的表单写第一条。</p>
          ) : (
            <div className="sf-table-wrap">
              <table className="sf-mini-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>值</th>
                    <th>置信度</th>
                    <th>来源</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.profile.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <code>{row.key}</code>
                      </td>
                      <td title={row.evidence || row.value}>{row.value}</td>
                      <td>{Math.round(row.confidence * 100)}%</td>
                      <td>{row.source}</td>
                      <td>{formatDateTime(epoch(row.updated_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sf-pref-group">
            <div className="sf-pref-group-head">
              <Bot size={15} />
              <strong>写回一条</strong>
            </div>
            <div className="sf-inline-form wrap">
              <input placeholder="key，如 budget" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} />
              <input placeholder="value，如 5000" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
              <label className="sf-slider">
                置信度 {draftConfidence}%
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={draftConfidence}
                  onChange={(event) => setDraftConfidence(Number(event.target.value))}
                />
              </label>
              <button type="button" className="sf-primary-btn" disabled={busy} onClick={() => void writeback()}>
                <Save size={13} />
                {busy ? "写入中…" : "写回"}
              </button>
            </div>
            <p className="sf-settings-hint">
              置信度低于已有条目时不会直接覆盖，会进入「待裁决冲突」，由人工在上面的冲突列表里定夺。
            </p>
          </div>

          {data.history.length > 0 && (
            <div className="sf-pref-group">
              <div className="sf-pref-group-head">
                <History size={15} />
                <strong>变更流水（append-only，最近 10 条）</strong>
              </div>
              <ul className="sf-history">
                {data.history.slice(-10).reverse().map((row, idx) => (
                  <li key={`${row.key}-${row.created_at}-${idx}`}>
                    <code>{row.key}</code>
                    <span className="sf-history-act">{row.action}</span>
                    <span>{row.new_value}</span>
                    <small>
                      {row.actor} · {formatDateTime(epoch(row.created_at))}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <NoteBar note={note} />
    </div>
  );
}

// ── 6. 交接与写回 ─────────────────────────────────────────────────────────────

type HandoffStats = {
  handoffs: number;
  pending: number;
  accepted: number;
  handoff_items: number;
  profiles: number;
  profile_events: number;
  conflicts: number;
  pending_conflicts: number;
  feedback_total: number;
  feedback_pending: number;
  feedback_failed: number;
  context_reads: number;
};
type ContextRead = {
  id?: number;
  agent?: string;
  scope_key?: string;
  task_type?: string;
  sources?: string[] | string;
  created_at?: number;
};
type ContextReadsPayload = { total: number; by_agent: Record<string, number>; items: ContextRead[] };

export function HandoffSection() {
  const [stats, setStats] = useState<HandoffStats | null>(null);
  const [reads, setReads] = useState<ContextReadsPayload | null>(null);
  const [state, setState] = useState<SfLoadState>("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [s, r] = await Promise.all([
        sfFetch<HandoffStats>("/api/memory/handoff/stats"),
        sfFetch<ContextReadsPayload>("/api/memory/handoff/context/reads?limit=12"),
      ]);
      setStats(s);
      setReads(r);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="sf-settings-list">
      <p className="sf-settings-hint">
        这一页是记忆系统的可观测窗口：跑过多少轮交接、沉淀了多少画像、Agent 真正读走过多少次记忆。数据来自 Node 侧 SQLite，只读。
      </p>

      <div className="sf-inline-actions">
        <button type="button" className="sf-secondary-btn" onClick={() => void load()}>
          <RefreshCw size={13} />
          刷新
        </button>
      </div>

      <SfLoadTag state={state} />

      {stats && (
        <div className="sf-kpi-inline">
          <div>
            <small>交接轮次</small>
            <strong>{stats.handoffs}</strong>
          </div>
          <div>
            <small>待处理条目</small>
            <strong>{stats.pending}</strong>
          </div>
          <div>
            <small>已采纳</small>
            <strong>{stats.accepted}</strong>
          </div>
          <div>
            <small>画像主体</small>
            <strong>{stats.profiles}</strong>
          </div>
          <div>
            <small>画像变更流水</small>
            <strong>{stats.profile_events}</strong>
          </div>
          <div>
            <small>待裁决冲突</small>
            <strong className={stats.pending_conflicts > 0 ? "warn" : ""}>{stats.pending_conflicts}</strong>
          </div>
          <div>
            <small>反馈队列（待/失败）</small>
            <strong>
              {stats.feedback_pending}/{stats.feedback_failed}
            </strong>
          </div>
          <div>
            <small>记忆被读取次数</small>
            <strong>{stats.context_reads}</strong>
          </div>
        </div>
      )}

      {reads && reads.items.length > 0 ? (
        <div className="sf-pref-group">
          <div className="sf-pref-group-head">
            <History size={15} />
            <strong>最近读取留痕</strong>
          </div>
          <div className="sf-table-wrap">
            <table className="sf-mini-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>作用域</th>
                  <th>任务类型</th>
                  <th>读走的来源</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {reads.items.map((row, idx) => (
                  <tr key={row.id ?? idx}>
                    <td>{row.agent || "—"}</td>
                    <td>{row.scope_key || "—"}</td>
                    <td>{row.task_type || "—"}</td>
                    <td>{Array.isArray(row.sources) ? row.sources.join(", ") : row.sources || "—"}</td>
                    <td>{row.created_at ? formatDateTime(epoch(row.created_at)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        reads && <p className="sf-settings-empty">还没有读取留痕 —— Agent 一旦在任务里召回记忆，这里就会出现记录。</p>
      )}

      <p className="sf-settings-hint">
        「写回」是 Agent 把结论沉淀成画像的动作，入口在上面「Agent 画像」页；这里只做观测，不提供直接改写，避免绕过置信度与冲突裁决。
      </p>
    </div>
  );
}

// ── 7. 高级设置 ───────────────────────────────────────────────────────────────

export function AdvancedSection() {
  const [prefs, setPrefs] = useState<SfPrefs>(() => currentPrefs());
  const [note, setNote] = useState<Note>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => subscribePrefs(setPrefs), []);

  function exportPrefs() {
    const blob = new Blob([JSON.stringify(prefs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shadowflow-prefs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote({ tone: "ok", text: "已导出当前偏好" });
  }

  function doReset() {
    resetPrefs();
    setConfirmReset(false);
    setNote({ tone: "ok", text: "偏好已恢复默认值" });
  }

  function clearCaches() {
    // 只清「界面缓存」，登录 token（sf_auth_token）必须保留，否则等于强制登出。
    const keep = new Set(["sf_auth_token"]);
    let removed = 0;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && !keep.has(key)) keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
      removed += 1;
    }
    setNote({ tone: "ok", text: `已清掉 ${removed} 项本地缓存，登录状态保留。建议刷新页面。` });
  }

  return (
    <div className="sf-settings-list">
      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Monitor size={15} />
          <strong>诊断</strong>
        </div>
        <div className="sf-setting-block">
          <div>
            <span>
              <AlertTriangle size={15} />
            </span>
            <div>
              <strong>显示内部提示</strong>
              <small>在界面上额外显示 ID、原始状态等排查信息</small>
            </div>
          </div>
          <button
            type="button"
            className={`sf-switch ${prefs.debugHints ? "on" : ""}`}
            aria-label="显示内部提示"
            aria-pressed={prefs.debugHints}
            onClick={() => void writePrefs({ debugHints: !prefs.debugHints })}
          >
            <i />
          </button>
        </div>
        <dl className="sf-kv">
          <div>
            <dt>页面来源</dt>
            <dd>
              <code>{typeof location !== "undefined" ? location.origin : "—"}</code>
            </dd>
          </div>
          <div>
            <dt>API 基址</dt>
            <dd>
              <code>{(import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE || "（同源，走网关）"}</code>
            </dd>
          </div>
          <div>
            <dt>屏幕</dt>
            <dd>
              {typeof window !== "undefined" ? `${window.innerWidth} × ${window.innerHeight}` : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="sf-pref-group">
        <div className="sf-pref-group-head">
          <Download size={15} />
          <strong>本地数据</strong>
        </div>
        <div className="sf-setting-block">
          <div>
            <span>
              <Download size={15} />
            </span>
            <div>
              <strong>导出偏好</strong>
              <small>下载一份 JSON，便于备份或拷到另一台机器</small>
            </div>
          </div>
          <button type="button" className="sf-secondary-btn" onClick={exportPrefs}>
            导出
          </button>
        </div>
        <div className="sf-setting-block">
          <div>
            <span>
              <Trash2 size={15} />
            </span>
            <div>
              <strong>清空界面缓存</strong>
              <small>清掉除登录态以外的 localStorage 项，页面设置会回到默认</small>
            </div>
          </div>
          <button type="button" className="sf-secondary-btn" onClick={clearCaches}>
            清空
          </button>
        </div>
        <div className="sf-setting-block danger">
          <div>
            <span>
              <RotateCcw size={15} />
            </span>
            <div>
              <strong>恢复默认偏好</strong>
              <small>缩放、密度、强调色、区域格式、通知开关全部回到出厂值</small>
            </div>
          </div>
          {confirmReset ? (
            <div className="sf-inline-actions">
              <button type="button" className="sf-danger-btn" onClick={doReset}>
                确认恢复
              </button>
              <button type="button" className="sf-secondary-btn" onClick={() => setConfirmReset(false)}>
                取消
              </button>
            </div>
          ) : (
            <button type="button" className="sf-secondary-btn" onClick={() => setConfirmReset(true)}>
              恢复默认
            </button>
          )}
        </div>
      </div>

      <NoteBar note={note} />
    </div>
  );
}
