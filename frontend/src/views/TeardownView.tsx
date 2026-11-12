/**
 * 商品诊断（Listing Doctor）视图。
 *
 * 产品定位：把「我东西卖不出去」翻译成一份**能照着改的清单**。
 * 这里不调用任何模型 —— 诊断由后端规则引擎给结论，本视图只负责
 * 「收集输入 → 展示可解释的扣分 → 给出填空式改写 → 导向改造服务」。
 *
 * 双语：所有界面文案走 `t()/tn()`；后端只回问题码，文案在 `teardown-copy.ts`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Layers,
  Loader2,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Store,
} from "lucide-react";
import { useI18n } from "../i18n";
import { sfFetch } from "./shared";
import { TeardownBatch } from "./TeardownBatch";
import {
  CATEGORY_OPTIONS,
  CONTACT_KIND_LABEL,
  PLATFORM_OPTIONS,
  DIM_LABEL,
  DIM_ORDER,
  GRADE_LABEL,
  ISSUE_COPY,
  NEED_LABEL,
  SAMPLE_LISTING,
  SEVERITY_LABEL,
  SLOT_LABEL,
  categoryLabel,
  platformLabel,
  platformLimits,
  type IssueDim,
  type IssueSeverity,
} from "../teardown-copy";

// ── 与后端 listing_doctor 的返回结构一一对应 ────────────────────────────────

interface DimScore {
  key: IssueDim;
  score: number;
  weight: number;
  issues: number;
}

interface IssueItem {
  id: string;
  dim: IssueDim;
  severity: IssueSeverity;
  evidence: string;
  params: Record<string, string | number>;
}

interface TitlePlan {
  key: string;
  text: string;
  /**
   * 每段骨架：value 为空就是待填的空位（按当前语言渲染成占位块）。
   * 可选 —— 2026-11-12 之前的落盘报告没有这个字段，历史回看时按 text 兜底，
   * 否则读旧报告会直接崩成白屏。
   */
  parts?: Array<{ slot: string; value: string }>;
  missing: string[];
}

interface Report {
  version: number;
  engine: string;
  category?: { key: string | null; label: string | null; detected: boolean };
  platform?: { key: string; label: string; title_max: number; points_max: number; bullet_max: number | null };
  score: { total: number; grade: string; dimensions: DimScore[] };
  gates: { can_list: boolean; blocked_by: string[]; score_cap: number | null };
  issues: IssueItem[];
  titles: TitlePlan[];
  plan: { bullets: Array<{ from: string; needs: string }>; faq: string[] };
  counts: { issues: number; high: number; medium: number; low: number };
}

interface HistoryItem {
  report_id: string;
  created_at: string | null;
  title: string;
  total: number | null;
  grade: string | null;
  can_list: boolean | null;
}

/** 勾选项：勾上 = 明确声明「我有」，不勾 = 交给引擎按词表自动识别。 */
const FLAGS: Array<{ key: string; label: string }> = [
  { key: "material", label: "材质或工艺" },
  { key: "proof", label: "检测 / 资质 / 实拍口碑" },
  { key: "after_sale", label: "售后承诺" },
  { key: "shipping", label: "发货时效" },
  { key: "anchor", label: "对比价或套餐档" },
  { key: "bundle", label: "赠品或包邮" },
  { key: "cta", label: "明确的行动指令" },
  { key: "contact", label: "联系方式 / 客服入口" },
];

const DIM_TONE: Record<IssueDim, string> = {
  title: "#ff5e3a",
  points: "#d97b38",
  trust: "#0ea5a4",
  pricing: "#7c5cff",
  conversion: "#2777e8",
  compliance: "#c64f7d",
};

function scoreTone(total: number): string {
  if (total >= 85) return "#0ea5a4";
  if (total >= 70) return "#2777e8";
  if (total >= 55) return "#d97b38";
  return "#c64f7d";
}

export function TeardownView({ onGoBiz }: { onGoBiz?: () => void }) {
  const { t, tn } = useI18n();

  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [detail, setDetail] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("auto");
  const [platform, setPlatform] = useState("generic");
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState<string>("");
  const [tab, setTab] = useState<"single" | "batch">("single");

  const mounted = useRef(true);
  useEffect(() => {
    // 必须在这里重新置 true：React StrictMode 在开发态会「挂载→清理→再挂载」，
    // 只在清理里置 false 会让 ref 永久失效，请求回来后被当成已卸载直接丢弃
    // （表现为：点了诊断没反应、按钮一直停在「诊断中…」）。
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reloadHistory = useCallback(async () => {
    try {
      const data = await sfFetch<{ items: HistoryItem[] }>("/api/teardown/reports?limit=8");
      if (mounted.current) setHistory(data.items ?? []);
    } catch {
      // 历史是增强项：取不到就空着，不打断主流程
    }
  }, []);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  const canSubmit = useMemo(
    () => !busy && (title.trim() !== "" || points.trim() !== ""),
    [busy, title, points],
  );

  async function runDiagnosis() {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        points: points
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        detail: detail.trim(),
        price_cents: price.trim() === "" ? null : Math.round(Number(price) * 100),
        category,
        platform,
        flags,
      };
      const res = await sfFetch<{ report_id: string; report: Report }>(
        "/api/teardown/analyze",
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!mounted.current) return;
      setReport(res.report);
      void reloadHistory();
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function fillSample() {
    setTitle(SAMPLE_LISTING.title);
    setPoints(SAMPLE_LISTING.points);
    setDetail(SAMPLE_LISTING.detail);
    setPrice(SAMPLE_LISTING.price);
    setCategory("auto");
    setFlags({});
    setReport(null);
    setError("");
  }

  function reset() {
    setTitle("");
    setPoints("");
    setDetail("");
    setPrice("");
    setCategory("auto");
    setFlags({});
    setReport(null);
    setError("");
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }

  const total = report?.score.total ?? 0;
  const tone = scoreTone(total);
  const ring = 2 * Math.PI * 42;
  // 等级词表兜底：不认识的新等级按「待改」处理（不写字面量，避免漏包扫描）
  const gradeLabel = GRADE_LABEL[report?.score.grade ?? ""] ?? GRADE_LABEL.needs_work;

  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>LISTING DOCTOR</p>
          <h1>{t("商品诊断")}</h1>
          <span>{t("贴一份商品页，拿到可执行的改造清单")}</span>
        </div>
        {tab === "single" && (
          <button onClick={fillSample} type="button">
            <Sparkles size={15} /> {t("示例")}
          </button>
        )}
      </div>

      <div className="sf-doctor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "single"}
          className={tab === "single" ? "on" : ""}
          onClick={() => setTab("single")}
        >
          <ScanSearch size={14} /> {t("单条诊断")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "batch"}
          className={tab === "batch" ? "on" : ""}
          onClick={() => setTab("batch")}
        >
          <Layers size={14} /> {t("批量诊断")}
        </button>
      </div>

      {tab === "batch" ? (
        <TeardownBatch
          onOpenReport={(id) => {
            setTab("single");
            void openHistory(id);
          }}
        />
      ) : (
      <div className="sf-doctor">
        <section className="sf-doctor-form">
          <div className="sf-doctor-head">
            <div>
              <strong>{t("贴一份商品页")}</strong>
              <span>{t("规则引擎，离线可跑，结论可复现")}</span>
            </div>
          </div>

        <label className="sf-doctor-field">
          <span>{t("标题")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("标题")}
            maxLength={200}
          />
        </label>

        <label className="sf-doctor-field">
          <span>{t("卖点（一行一条）")}</span>
          <textarea
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            rows={4}
            placeholder={t("卖点（一行一条）")}
          />
        </label>

        <label className="sf-doctor-field">
          <span>{t("详情 / 描述")}</span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={4}
            placeholder={t("详情 / 描述")}
          />
        </label>

        <div className="sf-doctor-inline">
          <label className="sf-doctor-field sf-doctor-field--short">
            <span>{t("价格（元）")}</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder={t("价格（元）")}
            />
          </label>

          <label className="sf-doctor-field">
            <span>{t("类目（决定用哪套合规词库）")}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="sf-doctor-field">
          <span>{t("目标平台（决定跑哪套平台规则）")}</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {t(opt.label)}
              </option>
            ))}
          </select>
          {platform !== "generic" && (
            <em className="sf-doctor-hint">
              {tn("标题上限 {max} 字符 · 卖点最多 {n} 条", {
                max: platformLimits(platform).titleMax,
                n: platformLimits(platform).pointsMax,
              })}
            </em>
          )}
        </label>

        <div className="sf-doctor-flags">
          <p>{t("已有素材（勾了就按有算）")}</p>
          <div>
            {FLAGS.map((flag) => (
              <label key={flag.key} className={flags[flag.key] ? "on" : ""}>
                <input
                  type="checkbox"
                  checked={Boolean(flags[flag.key])}
                  onChange={(e) =>
                    setFlags((prev) => ({ ...prev, [flag.key]: e.target.checked }))
                  }
                />
                <span>{t(flag.label)}</span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="sf-doctor-error" role="alert">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        <div className="sf-doctor-actions">
          <button className="sf-doctor-run" onClick={() => void runDiagnosis()} disabled={!canSubmit}>
            {busy ? <Loader2 className="spin" size={14} /> : <ScanSearch size={14} />}
            {busy ? t("诊断中…") : t("开始诊断")}
          </button>
          <button className="sf-doctor-ghost" onClick={reset} type="button">
            <RotateCcw size={13} /> {t("清空")}
          </button>
        </div>

        {history.length > 0 && (
          <div className="sf-doctor-history">
            <p>{t("最近的诊断")}</p>
            {history.map((item) => (
              <button
                key={item.report_id}
                type="button"
                onClick={() => void openHistory(item.report_id)}
              >
                <span>{item.title || item.report_id}</span>
                <b style={{ color: scoreTone(item.total ?? 0) }}>{item.total ?? "—"}</b>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="sf-doctor-result">
        {!report ? (
          <div className="sf-doctor-empty">
            <ScanSearch size={26} />
            <strong>{t("贴一份商品页，拿到可执行的改造清单")}</strong>
            <span>{t("规则引擎，离线可跑，结论可复现")}</span>
          </div>
        ) : (
          <>
            <div className="sf-doctor-score">
              <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#efe9de" strokeWidth="9" />
                {total > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke={tone}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(ring * total) / 100} ${ring}`}
                    transform="rotate(-90 50 50)"
                  />
                )}
                <text x="50" y="56" textAnchor="middle" fontSize="26" fontWeight="700" fill={tone}>
                  {total}
                </text>
              </svg>
              <div>
                <div className="sf-doctor-grade" style={{ color: tone }}>
                  {t(gradeLabel)}
                </div>
                <p className="sf-doctor-count">
                  {tn("{n} 个问题 · 致命 {high} · 次要 {medium} · 打磨 {low}", {
                    n: report.counts.issues,
                    high: report.counts.high,
                    medium: report.counts.medium,
                    low: report.counts.low,
                  })}
                </p>
                <span className={`sf-doctor-gate ${report.gates.can_list ? "ok" : "blocked"}`}>
                  {report.gates.can_list ? <Check size={12} /> : <ShieldAlert size={12} />}
                  {report.gates.can_list ? t("可以上架") : t("先别上架")}
                </span>
                {report.category?.key && (
                  <span className="sf-doctor-cat">
                    {report.category.detected
                      ? tn("自动识别为「{name}」类目", {
                          name: t(categoryLabel(report.category.key)),
                        })
                      : tn("按「{name}」类目校验", {
                          name: t(categoryLabel(report.category.key)),
                        })}
                  </span>
                )}
                {report.platform && report.platform.key !== "generic" && (
                  <span className="sf-doctor-cat">
                    {tn("按「{name}」平台规则校验", {
                      name: t(platformLabel(report.platform.key)),
                    })}
                  </span>
                )}
                {report.gates.score_cap != null && (
                  <p className="sf-doctor-cap">
                    {tn("命中合规红线，总分封顶 {cap} 分", { cap: report.gates.score_cap })}
                  </p>
                )}
              </div>
            </div>

            <div className="sf-doctor-dims">
              {DIM_ORDER.map((dim) => {
                const item = report.score.dimensions.find((d) => d.key === dim);
                const value = item?.score ?? 0;
                return (
                  <div key={dim} className="sf-doctor-dim">
                    <span>{t(DIM_LABEL[dim])}</span>
                    <div className="sf-doctor-bar">
                      <i
                        style={{
                          width: `${value}%`,
                          background: DIM_TONE[dim],
                          opacity: value >= 70 ? 1 : 0.55,
                        }}
                      />
                    </div>
                    <b>{value}</b>
                  </div>
                );
              })}
            </div>

            <div className="sf-doctor-issues">
              <p className="sf-doctor-sub">{t("怎么改")}</p>
              {report.issues.length === 0 && (
                <p className="sf-doctor-clear">
                  <Check size={13} /> {t("可以上架")}
                </p>
              )}
              {report.issues.map((issue, index) => {
                const copy = ISSUE_COPY[issue.id];
                // 后端只回 kind=email/url/phone，渲染前换成当前语言的说法
                const params =
                  issue.id === "platform.contact"
                    ? {
                        ...issue.params,
                        kind: t(
                          CONTACT_KIND_LABEL[String(issue.params.kind)] ?? CONTACT_KIND_LABEL.email,
                        ),
                      }
                    : issue.params;
                return (
                  <article key={`${issue.id}-${index}`} className={`sf-doctor-issue lv-${issue.severity}`}>
                    <header>
                      <i style={{ background: DIM_TONE[issue.dim] }} />
                      <span className="dim">{t(DIM_LABEL[issue.dim])}</span>
                      <span className={`sev ${issue.severity}`}>{t(SEVERITY_LABEL[issue.severity])}</span>
                    </header>
                    <strong>{copy ? tn(copy.title, params) : issue.id}</strong>
                    {copy && <p>{t(copy.fix)}</p>}
                    {issue.evidence && (
                      <blockquote>
                        <span>{t("证据")}</span>
                        {issue.evidence}
                      </blockquote>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="sf-doctor-titles">
              <p className="sf-doctor-sub">{t("标题改写（填空版）")}</p>
              {report.titles.map((plan, index) => (
                <div key={plan.key} className="sf-doctor-title-card">
                  <div>
                    <span className="idx">{index + 1}</span>
                    <strong className="compose">
                      {(plan.parts ?? [{ slot: "name", value: plan.text }]).map((part, partIndex) => (
                        <span key={part.slot}>
                          {partIndex > 0 && <i className="sep">｜</i>}
                          {part.value ? (
                            <span className="filled">{part.value}</span>
                          ) : (
                            <em className="slot">{t(SLOT_LABEL[part.slot] ?? part.slot)}</em>
                          )}
                        </span>
                      ))}
                    </strong>
                  </div>
                  <div className="meta">
                    {plan.missing.length > 0 && (
                      <span className="missing">
                        {tn("缺：{slots}", {
                          slots: plan.missing.map((m) => t(SLOT_LABEL[m] ?? m)).join(" / "),
                        })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void copyText(plan.key, plan.text)}
                      disabled={!plan.text}
                    >
                      <ClipboardCopy size={12} />
                      {copied === plan.key ? t("已复制") : t("复制")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {(report.plan.bullets.length > 0 || report.plan.faq.length > 0) && (
              <div className="sf-doctor-plan">
                <p className="sf-doctor-sub">{t("待补清单")}</p>
                {report.plan.bullets.map((bullet, index) => (
                  <div key={`bullet-${index}`} className="sf-doctor-plan-row">
                    <span>{t("卖点补一句")}</span>
                    <code>{bullet.from}</code>
                    <em>{t(NEED_LABEL[bullet.needs] ?? bullet.needs)}</em>
                  </div>
                ))}
                {report.plan.faq.map((need) => (
                  <div key={`faq-${need}`} className="sf-doctor-plan-row">
                    <span>{t("待补清单")}</span>
                    <code>FAQ</code>
                    <em>{t(NEED_LABEL[need] ?? need)}</em>
                  </div>
                ))}
              </div>
            )}

            <div className="sf-doctor-cta">
              <div>
                <strong>{t("把这份清单变成交付")}</strong>
                <span>{t("让团队按清单改一遍文案、主图和详情，交付可用的成稿")}</span>
              </div>
              <button type="button" onClick={onGoBiz}>
                <Store size={14} /> {t("去生意看板下单")}
              </button>
            </div>

            <p className="sf-doctor-engine">
              {t("引擎")}: {report.engine === "rules+llm" ? t("规则 + 模型") : t("规则引擎 v1")}
            </p>
          </>
        )}
        </section>
      </div>
      )}
    </section>
  );

  async function openHistory(reportId: string) {
    try {
      const data = await sfFetch<{ report: Report; title?: string }>(
        `/api/teardown/reports/${reportId}`,
      );
      if (!mounted.current) return;
      setReport(data.report);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }
}
