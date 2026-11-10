/**
 * 用量与额度（2026-11-10）
 *
 * 数据源：GET /api/dashboard/overview?days=N → usage.{calls,input_tokens,output_tokens,
 * total_tokens,cost_est_usd,deltas}，由 Node 从 llm_usage 记账表聚合（run_index 同源）。
 * 此前这里是对上游缺失文件的空占位，只有一句「数据暂不可用」；现在接真实记账。
 *
 * 配额说明：ShadowFlow 走的是自带密钥（BYOK）直连模型厂商，本机不代管额度，
 * 因此「剩余额度」没有权威数据源 —— 不编数字，改为展示真实消耗 + 折算成本，
 * 并把配额口径写清楚（有月度上限时按使用率显示，没有就明说按实际用量计费）。
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Cpu, DollarSign, TrendingDown, TrendingUp, Zap } from "lucide-react";

type UsagePayload = {
  days?: number;
  usage?: {
    calls?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_est_usd?: number;
    deltas?: { calls?: number | null; total_tokens?: number | null; cost_est_usd?: number | null };
  };
  runs?: { total?: number; success_rate?: number | null };
  active?: { projects?: number; conversations?: number };
};

const RANGES: Array<[number, string]> = [
  [7, "近 7 天"],
  [30, "近 30 天"],
  [90, "近 90 天"],
];

/** 紧凑数字：1234567 → 1.23M；用于 token 这种量级跨度大的指标。 */
function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("zh-CN");
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n < 0.01 && n > 0 ? `<$0.01` : `$${n.toFixed(2)}`;
}

/** 环比：null 表示上期无数据（不是 0%），不能画成持平。 */
function Delta({ value }: { value?: number | null }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="sf-usage-delta flat">暂无对比</span>;
  }
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={`sf-usage-delta ${flat ? "flat" : up ? "up" : "down"}`}>
      {flat ? null : up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {flat ? "持平" : `${up ? "+" : ""}${value.toFixed(1)}%`}
    </span>
  );
}

export default function CreditsUsageSection() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsagePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    const headers: Record<string, string> = {};
    const token = localStorage.getItem("sf_token");
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`/api/dashboard/overview?days=${days}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: UsagePayload) => {
        if (!alive) return;
        setData(d);
        setState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setData(null);
        setState("error");
      });
    return () => {
      alive = false;
    };
  }, [days]);

  const u = data?.usage;
  const cards = useMemo(
    () => [
      {
        key: "calls",
        icon: <Zap size={14} />,
        label: "模型调用",
        value: u?.calls != null ? compact(u.calls) : "—",
        sub: "次请求",
        delta: u?.deltas?.calls,
      },
      {
        key: "tokens",
        icon: <Cpu size={14} />,
        label: "消耗 Token",
        value: u?.total_tokens != null ? compact(u.total_tokens) : "—",
        sub:
          u?.input_tokens != null && u?.output_tokens != null
            ? `入 ${compact(u.input_tokens)} · 出 ${compact(u.output_tokens)}`
            : "输入 + 输出",
        delta: u?.deltas?.total_tokens,
      },
      {
        key: "cost",
        icon: <DollarSign size={14} />,
        label: "折算成本",
        value: u?.cost_est_usd != null ? usd(u.cost_est_usd) : "—",
        sub: "按模型标价估算",
        delta: u?.deltas?.cost_est_usd,
      },
    ],
    [u],
  );

  const inOut = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0);
  const inPct = inOut > 0 ? ((u?.input_tokens ?? 0) / inOut) * 100 : 0;

  return (
    <div className="sf-usage">
      <div className="sf-usage-head">
        <div>
          <p>USAGE</p>
          <h2>用量与额度</h2>
          <span>模型调用、Token 消耗与折算成本，均来自本机调用记账（非估算的假数字）。</span>
        </div>
        <div className="sf-usage-range">
          {RANGES.map(([d, label]) => (
            <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {state === "error" && (
        <div className="sf-usage-error">
          <AlertCircle size={15} />
          <span>
            读不到用量数据。请确认网关（:8002）已启动，且已产生过至少一次模型调用。
          </span>
        </div>
      )}

      <div className="sf-usage-cards">
        {cards.map((c) => (
          <article key={c.key} className={state === "loading" ? "sf-usage-card loading" : "sf-usage-card"}>
            <header>
              <i>{c.icon}</i>
              <span>{c.label}</span>
              <Delta value={c.delta} />
            </header>
            <strong>{state === "loading" ? "···" : c.value}</strong>
            <small>{c.sub}</small>
          </article>
        ))}
      </div>

      <div className="sf-usage-split">
        <div className="sf-usage-split-head">
          <strong>输入 / 输出构成</strong>
          <span>{inOut > 0 ? `输入占 ${inPct.toFixed(1)}%` : "区间内暂无调用"}</span>
        </div>
        <div className="sf-usage-bar" role="img" aria-label="输入输出 token 构成">
          <i style={{ width: `${inPct}%` }} className="in" />
          <i style={{ width: `${100 - inPct}%` }} className="out" />
        </div>
        <ul className="sf-usage-legend">
          <li>
            <i className="in" /> 输入 {compact(u?.input_tokens ?? 0)}
          </li>
          <li>
            <i className="out" /> 输出 {compact(u?.output_tokens ?? 0)}
          </li>
          <li>
            <i className="run" /> 运行 {data?.runs?.total ?? 0} 次
            {data?.runs?.success_rate != null ? ` · 成功率 ${data.runs.success_rate}%` : ""}
          </li>
        </ul>
      </div>

      <div className="sf-usage-note">
        <strong>关于「额度」</strong>
        <p>
          ShadowFlow 使用你自备的模型密钥（BYOK）直连厂商，本机不代管账户余额，因此没有可显示的
          「剩余额度」。上面是真实记账的消耗；具体余额与单价请到对应厂商控制台查看。
          费用按调用时的模型标价折算，仅作规模参考。
        </p>
      </div>
    </div>
  );
}
