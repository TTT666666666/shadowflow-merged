/**
 * 宣称-证据对账。
 *
 * 和「商品诊断」的分工：诊断判断文案会不会被平台判违规；对账判断这些宣称
 * **你有没有资格说**——证书在不在、过期没、主体对不对、范围覆盖不覆盖。
 *
 * 判定全部在后端 `claim_evidence.reconcile()`，这里只负责收表单和渲染状态，
 * 不复制任何判断逻辑（尤其不要把「过期」这种判断放到前端，日期口径必须唯一）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, ScanLine, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { sfFetch } from "./shared";

interface EvidenceTypeOption {
  key: string;
  label: string;
  hint: string;
}

interface EvidenceDraft {
  type: string;
  code: string;
  expiry: string;
  subject: string;
  scope: string;
}

interface ClaimRow {
  type: string;
  type_label: string;
  text: string;
  need: string[];
  note: string;
  status: string;
  confidence: string;
  evidence?: { type?: string; code?: string; expiry?: string };
}

interface LedgerResult {
  counts: Record<string, number>;
  total: number;
  blocking: number;
  can_claim: boolean;
  claims: ClaimRow[];
  evidence_count: number;
  evidence_types: EvidenceTypeOption[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: "已覆盖",
  missing: "缺证据",
  expired: "已过期",
  bad_code: "编号格式不对",
  subject_mismatch: "证书主体不符",
  scope_mismatch: "证书范围不覆盖",
  unknown: "需人工核验",
};

// 后端取不到类型清单时的兜底；正常情况下用 /rules 返回的值，避免两处清单漂移。
const FALLBACK_TYPES: EvidenceTypeOption[] = [
  { key: "test_report", label: "检测报告", hint: "" },
  { key: "special_cosmetic", label: "特殊化妆品注册证", hint: "" },
  { key: "organic_cert", label: "有机产品认证", hint: "" },
  { key: "ccc", label: "3C 认证", hint: "" },
  { key: "food_production", label: "食品生产许可", hint: "" },
  { key: "health_food", label: "保健食品批号", hint: "" },
  { key: "medical_device", label: "医疗器械注册证", hint: "" },
  { key: "authorization", label: "品牌授权书", hint: "" },
];

const EMPTY_ROW: EvidenceDraft = { type: "test_report", code: "", expiry: "", subject: "", scope: "" };

const SAMPLE = {
  title: "有机棉男士短袖T恤 夏季薄款 圆领",
  points: "100%有机棉面料，亲肤透气\n7天无理由退换，含运费险",
  seller: "杭州甲纺织有限公司",
  evidences: [
    {
      type: "test_report",
      code: "CMA2020123456",
      expiry: "2021-06-30",
      subject: "杭州甲纺织有限公司",
      scope: "棉针织面料",
    },
  ] as EvidenceDraft[],
};

export default function TeardownLedger() {
  const { t, tn } = useI18n();
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [seller, setSeller] = useState("");
  const [evidences, setEvidences] = useState<EvidenceDraft[]>([{ ...EMPTY_ROW }]);
  const [types, setTypes] = useState<EvidenceTypeOption[]>(FALLBACK_TYPES);
  const [result, setResult] = useState<LedgerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    sfFetch<{ evidence_types?: EvidenceTypeOption[] }>("/api/teardown/rules")
      .then((data) => {
        if (mounted.current && data.evidence_types?.length) setTypes(data.evidence_types);
      })
      .catch(() => {
        // 取不到就用兜底清单，不打断主流程
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const typeLabel = useCallback(
    (key: string) => types.find((item) => item.key === key)?.label ?? key,
    [types],
  );

  function patchRow(index: number, patch: Partial<EvidenceDraft>) {
    setEvidences((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function fillSample() {
    setTitle(SAMPLE.title);
    setPoints(SAMPLE.points);
    setSeller(SAMPLE.seller);
    setEvidences(SAMPLE.evidences.map((row) => ({ ...row })));
    setResult(null);
    setError("");
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const data = await sfFetch<LedgerResult>("/api/teardown/ledger", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          points: points
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          seller_name: seller.trim(),
          evidences: evidences
            .filter((row) => row.type)
            .map((row) => ({
              type: row.type,
              code: row.code.trim(),
              expiry: row.expiry.trim(),
              subject: row.subject.trim(),
              scope: row.scope.trim(),
            })),
        }),
      });
      if (!mounted.current) return;
      setResult(data);
      if (data.evidence_types?.length) setTypes(data.evidence_types);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="sf-ledger">
      <div className="sf-ledger-form">
        <label className="sf-ledger-field">
          <span>{t("商品标题")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </label>
        <label className="sf-ledger-field">
          <span>{t("卖点（一行一条）")}</span>
          <textarea value={points} onChange={(e) => setPoints(e.target.value)} rows={3} />
        </label>
        <label className="sf-ledger-field">
          <span>{t("店铺主体（选填）")}</span>
          <input
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            placeholder={t("用于核对证书主体是不是你")}
            maxLength={200}
          />
        </label>

        <div className="sf-ledger-ev-head">
          <span>{t("证书台账")}</span>
          <div className="sf-ledger-ev-actions">
            <button type="button" className="ghost" onClick={fillSample}>
              {t("用示例填一遍")}
            </button>
            <button type="button" className="ghost" onClick={() => setEvidences((r) => [...r, { ...EMPTY_ROW }])}>
              <Plus size={14} /> {t("添加一条证据")}
            </button>
          </div>
        </div>

        {evidences.map((row, index) => (
          <div className="sf-ledger-ev-row" key={`ev-${index}`}>
            <select value={row.type} onChange={(e) => patchRow(index, { type: e.target.value })}>
              {types.map((item) => (
                <option key={item.key} value={item.key}>
                  {t(item.label)}
                </option>
              ))}
            </select>
            <input
              value={row.code}
              onChange={(e) => patchRow(index, { code: e.target.value })}
              placeholder={t("编号")}
              maxLength={200}
            />
            <input
              value={row.expiry}
              onChange={(e) => patchRow(index, { expiry: e.target.value })}
              placeholder={t("有效期 YYYY-MM-DD")}
              maxLength={20}
            />
            <input
              value={row.subject}
              onChange={(e) => patchRow(index, { subject: e.target.value })}
              placeholder={t("证书主体")}
              maxLength={200}
            />
            <input
              value={row.scope}
              onChange={(e) => patchRow(index, { scope: e.target.value })}
              placeholder={t("适用范围")}
              maxLength={200}
            />
            <button
              type="button"
              className="icon"
              aria-label={t("删除这一条")}
              onClick={() => setEvidences((rows) => (rows.length === 1 ? [{ ...EMPTY_ROW }] : rows.filter((_, i) => i !== index)))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        <div className="sf-ledger-actions">
          <button type="button" onClick={run} disabled={busy || !title.trim()}>
            {busy ? <Loader2 size={14} className="spin" /> : <ScanLine size={14} />}
            {busy ? t("对账中…") : t("开始对账")}
          </button>
        </div>
        {error && (
          <p className="sf-ledger-error">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
      </div>

      {result && (
        <div className="sf-ledger-result">
          <div className={result.can_claim ? "sf-ledger-verdict ok" : "sf-ledger-verdict warn"}>
            {result.can_claim ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <strong>
              {result.can_claim
                ? t("这些宣称都有证据支撑")
                : tn("有 {n} 条宣称缺证据支撑", { n: result.blocking })}
            </strong>
            <span>
              {tn("共 {n} 条宣称", { n: result.total })} · {tn("证据 {n} 份", { n: result.evidence_count })}
            </span>
          </div>

          {result.claims.length === 0 ? (
            <p className="sf-ledger-empty">{t("没有抽到需要资质的宣称")}</p>
          ) : (
            <table className="sf-ledger-table">
              <thead>
                <tr>
                  <th>{t("宣称")}</th>
                  <th>{t("类型")}</th>
                  <th>{t("需要的证据")}</th>
                  <th>{t("状态")}</th>
                </tr>
              </thead>
              <tbody>
                {result.claims.map((row, index) => (
                  <tr key={`claim-${index}`} data-status={row.status}>
                    <td title={row.note}>{row.text}</td>
                    <td>{row.type_label}</td>
                    <td>{row.need.length ? row.need.map(typeLabel).join(" / ") : t("无需资质")}</td>
                    <td>
                      <span className="sf-ledger-badge" data-status={row.status}>
                        {t(STATUS_LABEL[row.status] ?? row.status)}
                      </span>
                      {row.evidence?.code && <small>{row.evidence.code}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="sf-ledger-foot">
            {t("编号格式、有效期、主体一致是硬判断；范围覆盖是关键词比对，标「需人工核验」的请自己确认。")}
          </p>
        </div>
      )}
    </section>
  );
}
