import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  createMemo,
  listMemos,
  updateMemo,
  deleteMemo,
  type SfMemo,
} from "../chat-api";
import {
  SfLoadState,
  SfLoadTag,
} from "./shared";
import { translate, translateN, useI18n } from "../i18n";

/** 备忘日期徽标：逾期/今天/未来三态（类日程）。 */
function memoDueInfo(due: string | null): { label: string; tone: "over" | "today" | "future" } | null {
  if (!due) return null;
  const now = new Date();
  const t = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (due < t) return { label: translateN("已逾期 · {date}", { date: due }), tone: "over" };
  if (due === t) return { label: translateN("今天 · {date}", { date: due }), tone: "today" };
  return { label: due, tone: "future" };
}

/** 工作备忘（2026-11-08）：「项目」页改造成个人备忘/日程区，自由增删改。 */
export function MemosView() {
  const [memos, setMemos] = useState<SfMemo[] | null>(null);
  const [memosState, setMemosState] = useState<SfLoadState>("loading");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { t, tn } = useI18n();

  const loadMemos = useCallback(() => {
    setMemosState("loading");
    listMemos()
      .then((list) => {
        setMemos(list);
        setMemosState("ready");
      })
      .catch(() => {
        setMemos(null);
        setMemosState("error");
      });
  }, []);
  useEffect(() => {
    loadMemos();
  }, [loadMemos]);

  function resetForm() {
    setTitle("");
    setDue("");
    setNote("");
    setEditingId(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 局部变量原名 t（标题），与翻译函数 t 冲突 → 改名 titleText。
    const titleText = title.trim();
    if (!titleText) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await updateMemo(editingId, { title: titleText, note: note.trim(), due_at: due || null });
      } else {
        await createMemo({ title: titleText, note: note.trim(), due_at: due || null });
      }
      resetForm();
      loadMemos();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(m: SfMemo) {
    setEditingId(m.memo_id);
    setTitle(m.title);
    setDue(m.due_at ?? "");
    setNote(m.note);
    setFormError(null);
  }

  async function toggleDone(m: SfMemo) {
    try {
      await updateMemo(m.memo_id, { done: !m.done });
      loadMemos();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("更新失败，请重试"));
    }
  }

  async function removeMemo(m: SfMemo) {
    if (!window.confirm(tn("删除备忘「{title}」？", { title: m.title }))) return;
    try {
      await deleteMemo(m.memo_id);
      if (editingId === m.memo_id) resetForm();
      loadMemos();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("删除失败，请重试"));
    }
  }

  const list = memos ?? [];
  const openCount = list.filter((m) => !m.done).length;
  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>MEMO · SCHEDULE</p>
          <h1>{t("工作备忘")}</h1>
          <span>{t("个人日程与备忘，随手增删。")}</span>
        </div>
      </div>
      <SfLoadTag state={memosState} />
      <form className="sf-memo-form" onSubmit={handleSubmit}>
        <input
          autoFocus
          maxLength={200}
          placeholder={t("备忘标题（必填）")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          disabled={saving}
          title={t("日期（可选）")}
        />
        <input
          maxLength={2000}
          placeholder={t("备注（可选）")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
        />
        <button type="submit" disabled={saving || !title.trim()}>
          {saving ? t("保存中…") : editingId ? t("保存修改") : t("添加")}
        </button>
        {editingId && (
          <button type="button" onClick={resetForm} disabled={saving}>
            <X size={15} /> {t("取消")}
          </button>
        )}
        {formError && <span className="sf-inline-create-error">{formError}</span>}
      </form>
      {memosState === "ready" && (
        <p className="sf-memo-stats">
          {tn("共 {n} 条 · 待办 {a} 条 · 已完成 {b} 条", {
            n: list.length,
            a: openCount,
            b: list.length - openCount,
          })}
        </p>
      )}
      {memosState === "ready" && list.length === 0 && (
        <p className="sf-biz-empty">{t("还没有备忘 —— 在上方填一条，点「添加」")}</p>
      )}
      <ul className="sf-memo-list">
        {list.map((m) => {
          const dueInfo = memoDueInfo(m.due_at);
          return (
            <li key={m.memo_id} className={`sf-memo-item${m.done ? " done" : ""}`}>
              <button
                className="sf-memo-check"
                onClick={() => toggleDone(m)}
                title={m.done ? t("标记为待办") : t("标记完成")}
              >
                {m.done ? "✓" : ""}
              </button>
              <div className="sf-memo-main">
                <div className="sf-memo-head">
                  <h3>{m.title}</h3>
                  {dueInfo && <span className={`sf-memo-due ${dueInfo.tone}`}>{dueInfo.label}</span>}
                </div>
                {m.note && <p>{m.note}</p>}
              </div>
              <div className="sf-memo-actions">
                <button onClick={() => startEdit(m)} title={t("编辑")}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => removeMemo(m)} title={t("删除")}>
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
