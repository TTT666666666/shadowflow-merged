import { useState } from "react";
import { ArrowRight, BarChart3, Loader2, RotateCcw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useI18n } from "../i18n";
import { sfFetch } from "./shared";
import {
  CATEGORY_OPTIONS,
  DIM_LABEL,
  DIM_ORDER,
  GRADE_LABEL,
  ISSUE_COPY,
  PLATFORM_OPTIONS,
  SAMPLE_LISTING,
  SAMPLE_LISTING_FIXED,
  issueParams,
  type IssueDim,
  type IssueSeverity,
} from "../teardown-copy";

/**
 * 改前 / 改后对比。
 *
 * 为什么单独一页：单次诊断回答「现在怎么样」，甲方真正要看的是「你改完之后好了
 * 多少」。这一页就是代运营交差用的证据，也是复购钩子——免费诊断给出现状，
 * 对比证明价值，之后才谈订阅。
 *
 * 口径约束：两侧共用同一个类目与平台。否则「改前按食品、改后按美妆」，
 * 分差就没有意义了。
 */

interface Side {
  title: string;
  points: string;
  detail: string;
  price: string;
}

interface IssueItem {
  id: string;
  dim: IssueDim;
  severity: IssueSeverity;
  evidence: string;
  params: Record<string, string | number>;
}

interface Delta {
  total: { before: number; after: number; delta: number | null };
  grade: { before: string; after: string };
  can_list: { before: boolean; after: boolean };
  resolved: IssueItem[];
  remaining: IssueItem[];
  regressed: IssueItem[];
  dimensions: { key: IssueDim; before: number; after: number; delta: number | null }[];
}

interface CompareResponse {
  delta: Delta;
}

const EMPTY: Side = { title: "", points: "", detail: "", price: "" };

export default function TeardownCompare() {
  const { t, tn } = useI18n();
  const [before, setBefore] = useState<Side>(EMPTY);
  const [after, setAfter] = useState<Side>(EMPTY);
  const [category, setCategory] = useState("auto");
  const [platform, setPlatform] = useState("generic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CompareResponse | null>(null);

  const ready =
    (before.title.trim() !== "" || before.points.trim() !== "") &&
    (after.title.trim() !== "" || after.points.trim() !== "");

  async function run() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const pack = (side: Side) => ({
        title: side.title.trim(),
        points: side.points
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        detail: side.detail.trim(),
        price_cents: side.price.trim() === "" ? null : Math.round(Number(side.price) * 100),
        category,
        platform,
      });
      const res = await sfFetch<CompareResponse>("/api/teardown/compare", {
        method: "POST",
        body: JSON.stringify({ before: pack(before), after: pack(after) }),
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function fillSample() {
    setBefore({ ...SAMPLE_LISTING });
    setAfter({ ...SAMPLE_LISTING_FIXED });
    setData(null);
    setError("");
  }

  function reset() {
    setBefore(EMPTY);
    setAfter(EMPTY);
    setData(null);
    setError("");
  }

  const delta = data?.delta;

  return (
    <>
      <div className="sf-cmp-actions">
        <button className="sf-doctor-run" type="button" onClick={() => void run()} disabled={!ready || busy}>
          {busy ? <Loader2 className="spin" size={14} /> : <BarChart3 size={14} />}
          {busy ? t("对比中") : t("开始对比")}
        </button>
        <button onClick={fillSample} type="button">
          <Sparkles size={15} /> {t("示例")}
        </button>
        <button onClick={reset} type="button">
          <RotateCcw size={15} /> {t("清空")}
        </button>
      </div>

      <p className="sf-batch-hint">
        {t("两侧共用同一个类目与平台：口径不同的话，分差没有意义。")}
        <span>{t("只改文案、不改产品，差值就是文案值多少分。")}</span>
      </p>

      <div className="sf-cmp-form">
        <div className="sf-batch-meta">
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
          <label className="sf-doctor-field">
            <span>{t("目标平台（决定跑哪套平台规则）")}</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORM_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="sf-cmp-sides">
          {(
            [
              ["before", t("改前"), before, setBefore],
              ["after", t("改后"), after, setAfter],
            ] as const
          ).map(([key, label, side, setSide]) => (
            <section key={key} className={`sf-cmp-side sf-cmp-side--${key}`}>
              <header>
                <span className={`sf-cmp-badge ${key}`}>{label}</span>
              </header>
              <label className="sf-doctor-field">
                <span>{t("商品标题")}</span>
                <input
                  value={side.title}
                  onChange={(e) => setSide({ ...side, title: e.target.value })}
                  maxLength={300}
                />
              </label>
              <label className="sf-doctor-field">
                <span>{t("卖点（一行一条）")}</span>
                <textarea
                  value={side.points}
                  onChange={(e) => setSide({ ...side, points: e.target.value })}
                  rows={4}
                />
              </label>
              <label className="sf-doctor-field">
                <span>{t("详情 / 描述")}</span>
                <textarea
                  value={side.detail}
                  onChange={(e) => setSide({ ...side, detail: e.target.value })}
                  rows={4}
                />
              </label>
              <label className="sf-doctor-field sf-doctor-field--short">
                <span>{t("价格（元）")}</span>
                <input
                  value={side.price}
                  onChange={(e) => setSide({ ...side, price: e.target.value.replace(/[^\d.]/g, "") })}
                  inputMode="decimal"
                />
              </label>
            </section>
          ))}
        </div>
      </div>

      {error && (
        <p className="sf-doctor-error" role="alert">
          {error}
        </p>
      )}

      {delta ? (
        <div className="sf-cmp-result">
          <div className="sf-cmp-score">
            <div className="sf-cmp-score-side">
              <span>{t("改前")}</span>
              <strong>{delta.total.before}</strong>
              <em>{t(GRADE_LABEL[delta.grade.before] ?? delta.grade.before)}</em>
            </div>
            <ArrowRight size={20} className="sf-cmp-arrow" />
            <div className="sf-cmp-score-side after">
              <span>{t("改后")}</span>
              <strong>{delta.total.after}</strong>
              <em>{t(GRADE_LABEL[delta.grade.after] ?? delta.grade.after)}</em>
            </div>
            <div className={`sf-cmp-delta ${(delta.total.delta ?? 0) > 0 ? "up" : (delta.total.delta ?? 0) < 0 ? "down" : "flat"}`}>
              {(delta.total.delta ?? 0) > 0 ? <TrendingUp size={15} /> : (delta.total.delta ?? 0) < 0 ? <TrendingDown size={15} /> : null}
              {delta.total.delta == null
                ? "—"
                : delta.total.delta > 0
                  ? tn("提升 {n} 分", { n: delta.total.delta })
                  : delta.total.delta < 0
                    ? tn("下降 {n} 分", { n: Math.abs(delta.total.delta) })
                    : t("分数没有变化")}
            </div>
          </div>

          <p className="sf-cmp-gate">
            {delta.can_list.before === delta.can_list.after
              ? delta.can_list.after
                ? t("改前改后都能上架")
                : t("改前改后都还上不了架")
              : delta.can_list.after
                ? t("改前上不了架，现在可以上架")
                : t("改前能上架，现在不行了")}
          </p>

          <div className="sf-cmp-dims">
            {DIM_ORDER.map((dim) => {
              const item = delta.dimensions.find((d) => d.key === dim);
              if (!item) return null;
              const diff = item.delta ?? 0;
              return (
                <div key={dim} className="sf-cmp-dim">
                  <span>{t(DIM_LABEL[dim])}</span>
                  <div className="sf-cmp-dim-bar">
                    <i style={{ width: `${item.before}%` }} className="before" />
                    <i style={{ width: `${item.after}%` }} className="after" />
                  </div>
                  <em className={diff > 0 ? "up" : diff < 0 ? "down" : ""}>
                    {diff > 0 ? `+${diff}` : diff}
                  </em>
                </div>
              );
            })}
          </div>

          <div className="sf-cmp-lists">
            {(
              [
                ["resolved", t("已解决"), delta.resolved],
                ["remaining", t("仍存在"), delta.remaining],
                ["regressed", t("新增问题"), delta.regressed],
              ] as const
            ).map(([key, label, items]) => (
              <div key={key} className={`sf-cmp-list sf-cmp-list--${key}`}>
                <p>
                  {label} <b>{items.length}</b>
                </p>
                <ul>
                  {items.length === 0 && <li className="empty">{t("无")}</li>}
                  {items.map((issue) => {
                    const copy = ISSUE_COPY[issue.id];
                    return (
                      <li key={issue.id}>
                        <i className={`dot ${issue.severity}`} />
                        <span>{copy ? tn(copy.title, issueParams(issue, t)) : issue.id}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sf-doctor-empty">
          <BarChart3 size={22} />
          <strong>{t("还没有对比结果")}</strong>
          <span>{t("填好改前和改后，点「开始对比」——差多少分、哪几条被改掉了都会列出来。")}</span>
        </div>
      )}
    </>
  );
}
