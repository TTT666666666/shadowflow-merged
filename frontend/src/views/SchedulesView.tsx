import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CalendarClock,
  Plus,
  Trash2,
} from "lucide-react";
import {
  listAgents,
  listGroups,
  type AgentRecord,
  type GroupRecord,
} from "../chat-api";
import {
  SfLoadState,
  SfLoadTag,
  agents,
  sfFetch,
} from "./shared";
import { useI18n } from "../i18n";

type SfScheduleRow = {
  schedule_id: string;
  task_description: string;
  group_id?: string | null;
  agent_id?: string | null;
  cron_expression?: string | null;
  start_at?: string | null;
  next_run_time?: string | null;
  enabled: boolean;
};

/** 定时任务：列表接 GET /api/schedules，创建接 POST /api/schedules，
 *  启停接 PATCH、删除接 DELETE（此前假数据 + 死按钮，2026-11-08 接真）。 */
export function SchedulesView() {
  const [rows, setRows] = useState<SfScheduleRow[]>([]);
  const [loadState, setLoadState] = useState<SfLoadState>("loading");
  const [reload, setReload] = useState(0);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<"cron" | "once">("cron");
  const { t, tn } = useI18n();

  const agentNames = useMemo(
    () => new Map(agents.map((a) => [String(a.agent_id), a.name || String(a.agent_id)])),
    [agents],
  );

  useEffect(() => {
    sfFetch<SfScheduleRow[]>("/api/schedules")
      .then((list) => {
        if (!Array.isArray(list)) {
          setLoadState("error");
          return;
        }
        setRows(list);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [reload]);

  useEffect(() => {
    listGroups("all").then(setGroups).catch(() => setGroups([]));
    listAgents().then(setAgents).catch(() => setAgents([]));
  }, []);

  function toggle(index: number) {
    const row = rows[index];
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r)));
    sfFetch(`/api/schedules/${row.schedule_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !row.enabled }),
    }).catch(() => setRows((prev) => prev.map((r, i) => (i === index ? row : r))));
  }

  function removeRow(id: string) {
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.schedule_id !== id));
    sfFetch(`/api/schedules/${id}`, { method: "DELETE" }).catch(() => setRows(prev));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const desc = (form.elements.namedItem("taskDescription") as HTMLInputElement | null)?.value.trim();
    const groupId = (form.elements.namedItem("groupId") as HTMLSelectElement | null)?.value;
    const agentId = (form.elements.namedItem("agentId") as HTMLSelectElement | null)?.value;
    if (!desc || !groupId) return;
    const body: Record<string, unknown> = { group_id: groupId, task_description: desc };
    if (agentId) body.agent_id = agentId;
    if (trigger === "cron") {
      const cron = (form.elements.namedItem("cronExpr") as HTMLInputElement | null)?.value.trim();
      if (!cron) return;
      body.cron_expression = cron;
    } else {
      const at = (form.elements.namedItem("startAt") as HTMLInputElement | null)?.value;
      if (!at) return;
      body.start_at = new Date(at).toISOString();
    }
    setCreating(true);
    setCreateError(null);
    try {
      await sfFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowCreate(false);
      setReload((n) => n + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("创建失败，请重试"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>AUTOMATIONS</p>
          <h1>{t("定时任务")}</h1>
          <span>{t("全部 Agent 的周期与一次性执行计划。")}</span>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}>
          <Plus size={15} /> {t("创建定时任务")}
        </button>
      </div>
      <SfLoadTag state={loadState} />
      {showCreate && (
        <form className="sf-schedule-create" onSubmit={handleCreate}>
          <label>
            {t("任务描述")}
            <input
              autoFocus
              required
              name="taskDescription"
              maxLength={500}
              placeholder={t("例如：每天生成竞品动态简报")}
              disabled={creating}
            />
          </label>
          <label>
            {t("触发方式")}
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value === "once" ? "once" : "cron")}
              disabled={creating}
            >
              <option value="cron">{t("周期（cron）")}</option>
              <option value="once">{t("一次性")}</option>
            </select>
          </label>
          {trigger === "cron" ? (
            <label>
              {t("cron 表达式")}
              <input
                name="cronExpr"
                required
                placeholder={t("0 9 * * *（分 时 日 月 周）")}
                disabled={creating}
              />
            </label>
          ) : (
            <label>
              {t("执行时间")}
              <input name="startAt" type="datetime-local" required disabled={creating} />
            </label>
          )}
          <label>
            {t("执行群组")}
            <select name="groupId" required defaultValue="" disabled={creating}>
              <option value="" disabled>
                {t("选择群组…")}
              </option>
              {groups.map((g) => (
                <option key={g.group_id} value={g.group_id}>
                  {g.name || g.group_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("指定 Agent（可选）")}
            <select name="agentId" defaultValue="" disabled={creating}>
              <option value="">{t("自动调度")}</option>
              {agents.map((a) => (
                <option key={String(a.agent_id)} value={String(a.agent_id)}>
                  {t(a.name || a.agent_id)}
                </option>
              ))}
            </select>
          </label>
          <div className="sf-schedule-create-actions">
            <button type="submit" disabled={creating}>
              {creating ? t("创建中…") : t("创建")}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} disabled={creating}>
              {t("取消")}
            </button>
            {createError && <span className="sf-schedule-create-error">{createError}</span>}
          </div>
        </form>
      )}
      {loadState === "ready" && rows.length === 0 && (
        <p className="sf-biz-empty">{t("还没有定时任务 —— 点右上角「创建定时任务」添加")}</p>
      )}
      <div className="sf-schedule-list">
        {rows.map((schedule, index) => (
          <article key={schedule.schedule_id} className={schedule.enabled ? "" : "disabled"}>
            <span className="sf-schedule-icon">
              <CalendarClock size={18} />
            </span>
            <div>
              <strong>{schedule.task_description || schedule.schedule_id}</strong>
              <p>
                <span>
                  {schedule.agent_id
                    ? (agentNames.get(String(schedule.agent_id)) ?? schedule.agent_id)
                    : t("自动调度")}
                </span>
                {" · "}
                {schedule.cron_expression
                  ? `cron · ${schedule.cron_expression}`
                  : `${t("一次性")} · ${String(schedule.start_at ?? "").slice(0, 16).replace("T", " ")}`}
                {" · "}
                {t("下次")}{" "}
                {schedule.next_run_time
                  ? String(schedule.next_run_time).slice(0, 16).replace("T", " ")
                  : t("待触发")}
              </p>
            </div>
            <span className={schedule.enabled ? "enabled" : ""}>
              {schedule.enabled ? t("运行中") : t("已停用")}
            </span>
            <button
              className={`sf-switch ${schedule.enabled ? "on" : ""}`}
              onClick={() => toggle(index)}
              aria-label={schedule.enabled ? t("停用任务") : t("启用任务")}
            >
              <i />
            </button>
            <button onClick={() => removeRow(schedule.schedule_id)} aria-label={t("删除任务")}>
              <Trash2 size={15} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
