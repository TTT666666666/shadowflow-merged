/**
 * 批量诊断（P0：代运营 / 内容工作室）。
 *
 * 一次贴一份商品表，产出一份「可以交给甲方」的结果：逐条分数 + 合规门禁 +
 * 白标导出。所有判定仍由后端同一套规则引擎给出，这里不复制任何评分逻辑。
 *
 * 双语：界面文案一律走 t()/tn()；CSV 表头是用户提供的数据，不翻译。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  ScanSearch,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useI18n } from "../i18n";
import { getAuthSnapshot } from "../auth";
import { SF_API_BASE } from "../chat-api";
import { sfFetch } from "./shared";
import {
  BATCH_SAMPLE_CSV,
  BATCH_TEMPLATE_CSV,
  CATEGORY_OPTIONS,
  GRADE_LABEL,
} from "../teardown-copy";

interface BatchItem {
  row: number;
  title: string;
  report_id?: string;
  ok: boolean;
  total?: number | null;
  grade?: string | null;
  can_list?: boolean | null;
  blocked_by?: string[];
  high?: number;
  issues?: number;
  top_issues?: string[];
  error?: string;
}

interface BatchSummary {
  total: number;
  ok: number;
  failed: number;
  avg_total: number | null;
  blocked: number;
  high: number;
}

interface BatchRecord {
  batch_id: string;
  created_at: string;
  label: string;
  brand: string;
  summary: BatchSummary;
  items: BatchItem[];
}

interface BatchHistoryItem {
  batch_id: string;
  created_at: string | null;
  label: string;
  brand: string;
  summary: BatchSummary;
}

/** 公开行政处罚案例里最常见的一档金额，用来把「合规风险」换算成钱。 */
const PENALTY_PER_BLOCKED = 20000;

function scoreTone(total: number | null | undefined): string {
  const v = total ?? 0;
  if (v >= 85) return "#0ea5a4";
  if (v >= 70) return "#2777e8";
  if (v >= 55) return "#d97b38";
  return "#c64f7d";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TeardownBatch({ onOpenReport }: { onOpenReport?: (id: string) => void }) {
  const { t, tn, isEn } = useI18n();
  const [csv, setCsv] = useState("");
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BatchRecord | null>(null);
  const [history, setHistory] = useState<BatchHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    // 同 TeardownView：StrictMode 二次挂载后必须重新置 true，否则结果被丢弃。
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reloadHistory = useCallback(async () => {
    try {
      const data = await sfFetch<{ items: BatchHistoryItem[] }>("/api/teardown/batches?limit=8");
      if (mounted.current) setHistory(data.items ?? []);
    } catch {
      // 历史是增强项，取不到不打断主流程
    }
  }, []);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  async function run() {
    if (busy || !csv.trim()) {
      setError(t("请粘贴 CSV 或上传文件"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await sfFetch<BatchRecord>("/api/teardown/batch", {
        method: "POST",
        body: JSON.stringify({
          csv,
          label: label.trim(),
          brand: brand.trim(),
          category,
        }),
      });
      if (!mounted.current) return;
      setResult(res);
      void reloadHistory();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(t("只支持 .csv 文件"));
      return;
    }
    try {
      setCsv(await file.text());
      setError("");
    } catch {
      setError(t("文件读取失败"));
    }
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(BATCH_TEMPLATE_CSV);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function downloadExport(format: "csv" | "json") {
    if (!result) return;
    setError("");
    const token = getAuthSnapshot().token;
    try {
      const res = await fetch(
        `${SF_API_BASE}/api/teardown/batches/${encodeURIComponent(result.batch_id)}/export?format=${format}&lang=${isEn ? "en" : "zh"}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      downloadBlob(`listing-doctor-${result.batch_id}.${format}`, blob);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openBatch(id: string) {
    try {
      const record = await sfFetch<BatchRecord>(`/api/teardown/batches/${id}`);
      if (mounted.current) setResult(record);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }

  const summary = result?.summary;
  const exposure = (summary?.blocked ?? 0) * PENALTY_PER_BLOCKED;

  return (
    <div className="sf-batch">
      <section className="sf-batch-form">
        <div className="sf-doctor-head">
          <div>
            <strong>{t("贴一份商品表")}</strong>
            <span>{t("逐条复用同一套规则，脏数据不拖垮整批")}</span>
          </div>
        </div>

        <p className="sf-batch-hint">
          {t("CSV 列：标题 / 卖点 / 详情 / 价格 / 已有素材")}
          <br />
          {t("卖点用竖线分隔，价格按元填写")}
          <span> · {tn("单次最多 {n} 条", { n: 50 })}</span>
        </p>

        <div className="sf-batch-tools">
          <button type="button" onClick={() => { setCsv(BATCH_SAMPLE_CSV); setResult(null); }}>
            <FileSpreadsheet size={13} /> {t("填入示例表格")}
          </button>
          <button type="button" onClick={() => void copyTemplate()}>
            <ClipboardCopy size={13} /> {copied ? t("已复制") : t("复制空白模板")}
          </button>
          <label className="sf-batch-upload">
            <Upload size={13} /> {t("上传 CSV 文件")}
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={t("上传 CSV 文件")}
              onChange={(e) => void onUpload(e.target.files?.[0])}
            />
          </label>
        </div>

        <label className="sf-doctor-field">
          <span>{t("CSV 内容")}</span>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={BATCH_TEMPLATE_CSV.trim()}
          />
        </label>

        <div className="sf-batch-meta">
          <label className="sf-doctor-field sf-doctor-field--short">
            <span>{t("批次名称（选填）")}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
          </label>
          <label className="sf-doctor-field sf-doctor-field--short">
            <span>{t("白标抬头（选填）")}</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} />
          </label>
        </div>

        <label className="sf-doctor-field">
          <span>{t("默认类目（CSV 里没有「类目」列时用它）")}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {t(opt.label)}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="sf-doctor-error" role="alert">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        <div className="sf-doctor-actions">
          <button className="sf-doctor-run" type="button" onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 className="spin" size={14} /> : <Layers size={14} />}
            {busy ? t("诊断中…") : t("开始批量诊断")}
          </button>
          <button
            className="sf-doctor-ghost"
            type="button"
            onClick={() => { setCsv(""); setResult(null); setError(""); }}
          >
            {t("清空")}
          </button>
        </div>

        {history.length > 0 && (
          <div className="sf-doctor-history">
            <p>{t("历史批次")}</p>
            {history.map((item) => (
              <button key={item.batch_id} type="button" onClick={() => void openBatch(item.batch_id)}>
                <span>{item.label || t("未命名批次")}</span>
                <b>{tn("{n} 条", { n: item.summary?.total ?? 0 })}</b>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="sf-batch-result">
        {!result ? (
          <div className="sf-doctor-empty">
            <ScanSearch size={26} />
            <strong>{t("一次交一份可验收的报告")}</strong>
            <span>{t("规则引擎，离线可跑，结论可复现")}</span>
          </div>
        ) : (
          <>
            <div className="sf-batch-summary">
              <div>
                <span>{tn("共 {n} 条 · 成功 {ok} · 失败 {failed}", {
                  n: summary?.total ?? 0,
                  ok: summary?.ok ?? 0,
                  failed: summary?.failed ?? 0,
                })}</span>
                <strong>{tn("平均分 {avg}", { avg: summary?.avg_total ?? "—" })}</strong>
              </div>
              <div className="sf-batch-risk">
                <span><ShieldAlert size={13} /> {tn("被合规拦下 {n} 条", { n: summary?.blocked ?? 0 })}</span>
                <strong>{tn("潜在罚单敞口 ¥{amount}", { amount: exposure.toLocaleString() })}</strong>
                <em>{t("按公开处罚案例 2 万元/张估算")}</em>
              </div>
            </div>

            <div className="sf-batch-exports">
              <button type="button" onClick={() => void downloadExport("csv")}>
                <Download size={13} /> {t("导出 CSV")}
              </button>
              <button type="button" onClick={() => void downloadExport("json")}>
                <Download size={13} /> {t("导出 JSON")}
              </button>
              {result.brand && <span className="sf-batch-brand">{result.brand}</span>}
            </div>

            <div className="sf-batch-table-wrap">
              <table className="sf-batch-table">
                <thead>
                  <tr>
                    <th>{t("序号")}</th>
                    <th>{t("商品标题")}</th>
                    <th>{t("总分")}</th>
                    <th>{t("等级")}</th>
                    <th>{t("能否上架")}</th>
                    <th>{t("问题数")}</th>
                    <th>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={`${item.row}-${item.report_id ?? "failed"}`} className={item.ok ? "" : "failed"}>
                      <td>{item.row}</td>
                      <td className="title">
                        {item.title || t("未命名批次")}
                        {!item.ok && <em>{item.error || t("失败原因")}</em>}
                        {item.ok && item.top_issues && item.top_issues.length > 0 && (
                          <em>{item.top_issues.join(" · ")}</em>
                        )}
                      </td>
                      <td>
                        <b style={{ color: scoreTone(item.total) }}>{item.total ?? "—"}</b>
                      </td>
                      <td>{t(GRADE_LABEL[item.grade ?? ""] ?? GRADE_LABEL.needs_work)}</td>
                      <td>
                        <span className={`sf-batch-gate ${item.can_list ? "ok" : "blocked"}`}>
                          {item.can_list ? t("可以上架") : t("先别上架")}
                        </span>
                      </td>
                      <td>{item.issues ?? "—"}</td>
                      <td>
                        {item.report_id && (
                          <button type="button" onClick={() => onOpenReport?.(item.report_id ?? "")}>
                            {t("查看")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
