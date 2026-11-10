import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  Copy,
  Pencil,
  Plus,
  ShieldCheck,
  Store,
  Trash2,
  X,
  Zap,
  RotateCcw,
} from "lucide-react";
import {
  productBuyUrl,
} from "../shop";
import {
  CHAT_UPLOAD_MAX_BYTES,
  chatAssetUrl,
  uploadChatAttachment,
} from "../chat-api";
import {
  SfLoadState,
  SfLoadTag,
  agents,
  sfFetch,
  SF_PALETTE,
} from "./shared";

interface SfDashOverview {
  usage: {
    calls: number;
    total_tokens: number;
    cost_est_usd: number;
    deltas: { calls: number | null; total_tokens: number | null; cost_est_usd: number | null };
  };
  runs: { total: number; succeeded: number; failed: number; canceled: number; success_rate: number | null };
  active: { projects: number; conversations: number };
}
/** /api/dashboard/briefing —— 每日简报（零 LLM，库内现算）。 */
interface SfDashBriefing {
  generated_at: number;
  today: { calls: number; total_tokens: number; cost_est_usd: number };
  yesterday: { calls: number; total_tokens: number; cost_est_usd: number };
  failed_top: Array<{ goal: string; n: number }>;
  lessons_learned: Array<{ kind: string; n: number }>;
  trend_7d: {
    total_tokens: number;
    daily: Array<{ day: number; calls: number; tokens: number; cost_est_usd: number }>;
  };
  alerts: string[];
}
/** /api/dashboard/agents —— Agent 产出排行（agent_hops 交接产出字符/次数现算）。 */
interface SfDashAgentItem {
  agent: string;
  hops: number;
  output_chars: number;
  done: number;
  failed: number;
}

/** 数字紧凑格式（k/M）。 */
export function fmtCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
/** 环比 delta 展示：null（上期无数据）显示 "—"。 */
export function fmtDelta(d: number | null): [string, string] {
  if (d == null) return ["—", ""];
  return [`${d >= 0 ? "+" : ""}${d}%`, d >= 0 ? "up" : "down"];
}
/**
 * 运行数据速览卡（2026-11-08 数据看板从侧边栏撤下，重点并入生意看板）：
 * 用量 / 成本 / Run 成功率 + 每日简报要点 + Agent 产出排行，实时取
 * /api/dashboard/{overview,briefing,agents}（零 LLM，库内现算）。
 */
function RunDigestCard() {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<SfLoadState>("loading");
  const [ov, setOv] = useState<SfDashOverview | null>(null);
  const [brief, setBrief] = useState<SfDashBriefing | null>(null);
  const [agentRows, setAgentRows] = useState<SfDashAgentItem[]>([]);

  useEffect(() => {
    let dead = false;
    setState("loading");
    (async () => {
      try {
        const [o, br, ag] = await Promise.all([
          sfFetch<SfDashOverview>("/api/dashboard/overview?days=7"),
          sfFetch<SfDashBriefing>("/api/dashboard/briefing?days=7"),
          sfFetch<{ items?: SfDashAgentItem[] }>("/api/dashboard/agents?days=7"),
        ]);
        if (dead) return;
        setOv(o ?? null);
        setBrief(br ?? null);
        setAgentRows(ag.items ?? []);
        setState("ready");
      } catch {
        if (dead) return;
        setOv(null);
        setBrief(null);
        setAgentRows([]);
        setState("error");
      }
    })();
    return () => {
      dead = true;
    };
  }, [reload]);

  const runs = ov?.runs ?? { total: 0, succeeded: 0, failed: 0, canceled: 0, success_rate: null };
  const stats: Array<[string, string, string, string]> = ov
    ? (() => {
        const dc = fmtDelta(ov.usage.deltas.calls);
        const dt = fmtDelta(ov.usage.deltas.total_tokens);
        const dp = fmtDelta(ov.usage.deltas.cost_est_usd);
        return [
          ["LLM 调用", ov.usage.calls.toLocaleString(), dc[0], dc[1]],
          ["Token 消耗", fmtCompact(ov.usage.total_tokens), dt[0], dt[1]],
          ["估算成本", `$${ov.usage.cost_est_usd.toFixed(2)}`, dp[0], dp[1]],
          [
            "Run 成功率",
            runs.success_rate != null ? `${runs.success_rate}%` : "—",
            `共 ${runs.total} 次`,
            "",
          ],
        ];
      })()
    : [
        ["LLM 调用", "—", "—", ""],
        ["Token 消耗", "—", "—", ""],
        ["估算成本", "—", "—", ""],
        ["Run 成功率", "—", "—", ""],
      ];
  // Agent 产出排行 top5（agent_hops 交接产出字符）
  const agentBars: Array<[string, number, number]> = agentRows
    .slice(0, 5)
    .map((row) => [row.agent.slice(0, 8), row.output_chars ?? 0, row.hops ?? 0] as [string, number, number]);
  const maxAgentChars = Math.max(...agentBars.map(([, n]) => n), 1);

  return (
    <article className="sf-digest-card">
      <div className="sf-card-title">
        <div>
          <strong>运行数据速览</strong>
          <span>原「数据看板」重点 · 近 7 天 · 实时同步</span>
        </div>
        <div className="sf-digest-head">
          <SfLoadTag state={state} okText="已同步" />
          <button onClick={() => setReload((n) => n + 1)}>
            <RotateCcw size={12} /> 刷新
          </button>
        </div>
      </div>

      <div className="sf-metric-grid sf-digest-stats">
        {stats.map(([label, value, delta, deltaState]) => (
          <article key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <span className={deltaState}>{delta}</span>
          </article>
        ))}
      </div>

      <div className="sf-digest-cols">
        <div className="sf-digest-brief">
          <div className="sf-brief-highlight">
            <span>
              <Zap size={17} />
            </span>
            <div>
              <small>今日调用</small>
              <strong>{brief ? brief.today.calls : "—"}</strong>
            </div>
            <em>{brief ? `成本 $${brief.today.cost_est_usd.toFixed(2)}` : "—"}</em>
          </div>
          <ul>
            <li>
              <span>昨日调用</span>
              <strong>{brief ? brief.yesterday.calls : "—"}</strong>
            </li>
            <li>
              <span>7 日 Tokens</span>
              <strong>{brief ? fmtCompact(brief.trend_7d.total_tokens) : "—"}</strong>
            </li>
            <li>
              <span>失败任务</span>
              <strong className={runs.failed > 0 ? "warm" : ""}>{ov ? runs.failed : "—"}</strong>
            </li>
            <li>
              <span>经验记忆</span>
              <strong>
                {brief ? brief.lessons_learned.reduce((sum, l) => sum + l.n, 0) : "—"}
              </strong>
            </li>
          </ul>
          <div className="sf-dashboard-alert">
            <ShieldCheck size={15} />
            <span>{brief?.alerts?.[0] ?? "近 7 天无告警"}</span>
          </div>
        </div>

        <div className="sf-digest-agents">
          <div className="sf-card-title">
            <div>
              <strong>Agent 产出排行</strong>
              <span>按交接产出字符</span>
            </div>
          </div>
          <ul className="sf-usage-bars">
            {agentBars.length === 0 && (
              <li>
                <span className="sf-usage-name">暂无数据</span>
              </li>
            )}
            {agentBars.map(([name, chars, hops], i) => (
              <li key={name} title={`${name} · 交接 ${hops} 次`}>
                <span className="sf-usage-name">{name}</span>
                <span className="sf-usage-track">
                  <i
                    style={{
                      width: `${(chars / maxAgentChars) * 100}%`,
                      background: SF_PALETTE[i % SF_PALETTE.length],
                    }}
                  />
                </span>
                <span className="sf-usage-val">{fmtCompact(chars)} 字</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

// ── 生意看板（手工艺品代销业务域）──────────────────────────────────────────
// 数据全部来自后端：/api/craft-profit（商品/销售/盈利）、/api/ops（快递/运营步骤）、
// /api/social-publish（社媒账号/帖子）。不再回落演示假数据——空就是空。

type BizOverview = {
  sales_count: number;
  units: number;
  revenue_cents: number;
  cost_cents: number;
  shipping_cents: number;
  profit_cents: number;
  margin_pct: number | null;
};
type BizProduct = {
  id: string;
  name: string;
  /** 一句话卖点（商品页副标题）。 */
  subtitle: string;
  price_cents: number;
  /** 市场价（划线价，0 不展示）。 */
  market_price_cents: number;
  cost_cents: number;
  shipping_cents: number;
  /** 库存件数（下单扣减、取消回补）。 */
  stock: number;
  /** 商品介绍。 */
  intro: string;
  /** 宣传图列表（≤5 张，第一张封面；老数据空时看 image_url）。 */
  images: string[];
  /** active 在售 | off_shelf 已下架。 */
  status: string;
  sold_units: number;
  revenue_cents: number;
  profit_cents: number;
  /** 封面图（/projects/_uploads/... 相对直链，可空串；商品售卖列表用）。 */
  image_url: string;
  /** 每件盈利 = 售价 − 成本 − 快递（后端算好）。 */
  profit_per_unit_cents: number;
};
type BizSale = {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  price_cents: number;
  shipping_cents: number;
  /** 订单状态机：unpaid 待支付 / pending 待发货 / shipped 已发货 / done 已完成 / cancelled 已取消。 */
  status: string;
  tracking: string;
  /** 快递公司（管理端发货时填；[ship] 标记路径为空串）。 */
  express_company: string;
  /** 买家称呼/电话（扫码购买下单的单有值；[order] 标记落库为空串）。 */
  buyer_name: string;
  buyer_contact: string;
  /** 收货地址 / 备注 / 支付时间（unpaid 为 null）。 */
  address: string;
  note: string;
  paid_at: number | null;
  created_at: number;
  profit_cents: number;
};
type BizShipment = {
  id: string;
  carrier: string;
  mode: string;
  tracking_no: string;
  receiver_name: string;
  receiver_address: string;
  status: string;
  remark: string;
  created_at: number;
  shipped_at: number | null;
};
type BizPost = {
  id: string;
  platform: string;
  title: string;
  content: string;
  status: string;
  external_id: string | null;
  error: string | null;
  created_at: number;
  published_at: number | null;
};
type BizOpsStep = {
  key: string;
  name: string;
  count: number;
  done: boolean;
  gap: string[];
  next_hint: string;
};

/** 分 → 元。 */
export function fmtYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
/** 毫秒时间戳 → MM-DD HH:mm。 */
function fmtBizTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const BIZ_POST_STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "已发布", cls: "ok" },
  failed: { label: "失败", cls: "bad" },
  draft: { label: "草稿", cls: "" },
};
/** 订单状态机徽标（2026-11-09 图1 订单管理）：unpaid→pending→shipped→done，cancelled 为终态。
 *  refunded 为历史遗留行兜底。 */
const BIZ_SALE_STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: "待支付", cls: "warn" },
  pending: { label: "待发货", cls: "info" },
  shipped: { label: "已发货", cls: "ok" },
  done: { label: "已完成", cls: "" },
  cancelled: { label: "已取消", cls: "bad" },
  refunded: { label: "已退款", cls: "bad" },
};

// ── 商品/博文卡片（2026-11-09 Task #4 数据看板）────────────────────────────
// 流水线（图片→AI 草拟→审批门→落商品）的产出面：商品卡（名称/图/状态/盈利）
// 与博文卡（标题/封面/状态/发布）。数据来自 be-worker Task #2 契约（2026-11-09 接入）：
//   GET /api/craft-products        → { items: CraftProductRow[] }（profit_per_unit_cents
//     每件盈利，后端算好；status: active|off_shelf，无「售罄」枚举）
//   GET /api/craft-profit/products?days=30 → { items: CraftProfitRow[] }（30 天累计
//     profit_cents；LEFT JOIN 口径零销量商品也返回 0，按商品 id 并联）
//   GET /api/craft-posts           → { items: CraftPostRow[] }（status: draft|confirmed|
//     published；封面取 images.find(is_image) 优先、回落 images[0]）
// 盈利口径（2026-11-09 与 be-worker 对齐）：主数字=近 30 天累计盈利 profit_cents，
// 每件盈利 profit_per_unit_cents 做小字次要展示。
// 金融约定：金额 ¥（fmtYuan），盈利涨跌用「涨红跌绿」（profit_delta_pct 契约暂无，
// 有值即着色，无值不显示环比）。

/** 商品行（对齐 /api/craft-products 响应；product_id 是 id 的别名）。 */
type CraftProductRow = {
  id: string;
  product_id?: string;
  name: string;
  /** 商品图（聊天附件 url / 本地路径，可空串）。 */
  image_url: string;
  /** active 在售 | off_shelf 已下架。 */
  status: string;
  /** 来源博文（管道落商品反引；手动上传为空）。 */
  source_post_id?: string | null;
  /** 每件盈利（分），后端算好。 */
  profit_per_unit_cents: number;
  created_at: number;
};

/** 博文行（对齐 /api/craft-posts 响应）。 */
type CraftPostRow = {
  post_id: string;
  title: string;
  images: Array<{ name?: string; url: string; is_image?: boolean }>;
  /** draft 草稿 | confirmed 已确认 | published 已发布（单向状态机）。 */
  status: string;
  /** 关联商品（cp_products.id，null=未关联）；卡片只留挂在实际商品上的。 */
  product_id?: string | null;
  created_at: number;
  published_at: number | null;
};

/** 看板卡片视图模型（渲染层消费，字段按 brief：商品 名称/图/状态/盈利；博文 标题/封面/状态/发布）。 */
type CraftCardProduct = {
  id: string;
  name: string;
  image_url: string;
  status: string;
  /** 每件盈利（分），小字次要展示。 */
  profit_per_unit_cents: number;
  /** 近 30 天累计盈利（分），卡片主数字（/api/craft-profit/products?days=30）。 */
  profit_30d_cents: number;
  /** 盈利环比（%）；null=无数据（契约暂未提供）。涨红跌绿：涨(+)红、跌(−)绿。 */
  profit_delta_pct: number | null;
};
type CraftCardPost = {
  id: string;
  title: string;
  /** 封面（images.find(is_image) 优先、回落 images[0]；空串=占位图）。 */
  cover_url: string;
  status: string;
  published_at: number | null;
};

/** 30 天累计盈利行（对齐 /api/craft-profit/products?days=30；LEFT JOIN 零销量返回 0）。 */
type CraftProfitRow = {
  id: string;
  sold_units: number;
  revenue_cents: number;
  profit_cents: number;
};

const CRAFT_PRODUCT_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "在售", cls: "ok" },
  off_shelf: { label: "已下架", cls: "bad" },
};
const CRAFT_POST_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "" },
  confirmed: { label: "已确认", cls: "info" },
  published: { label: "已发布", cls: "ok" },
};

/** 卡片数据入口（2026-11-09 接 be-worker 契约）：目录域两读端点 + 盈利聚合并发拉取后映射为卡片视图。 */
async function fetchCraftCards(): Promise<{ products: CraftCardProduct[]; posts: CraftCardPost[] }> {
  const [pr, po, pf] = await Promise.all([
    sfFetch<{ items?: CraftProductRow[] }>("/api/craft-products"),
    sfFetch<{ items?: CraftPostRow[] }>("/api/craft-posts"),
    // 30 天累计盈利（LEFT JOIN 口径：零销量商品也返回 0），按商品 id 并联到目录
    sfFetch<{ items?: CraftProfitRow[] }>("/api/craft-profit/products?days=30"),
  ]);
  const profitById = new Map((pf.items ?? []).map((r) => [r.id, r]));
  // 卡片与商品同生共死（2026-11-08）：博文卡只保留挂在实际商品上的——
  // product_id 直挂 或 商品 source_post_id 反引（管道回挂口径）；无主博文
  // （商品已删 / 测试残留）不出卡，与下方实际商品（货架/商品管理）对齐。
  const productIds = new Set((pr.items ?? []).map((p) => p.id));
  const sourcePostIds = new Set(
    (pr.items ?? []).map((p) => p.source_post_id).filter((v): v is string => !!v),
  );
  return {
    products: (pr.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      image_url: p.image_url ?? "",
      status: p.status,
      profit_per_unit_cents: p.profit_per_unit_cents ?? 0,
      // 主数字=近 30 天累计盈利；查不到聚合行按 0 兜底
      profit_30d_cents: profitById.get(p.id)?.profit_cents ?? 0,
      // 环比字段契约暂无：留位，有值即按涨红跌绿着色
      profit_delta_pct: null,
    })),
    posts: (po.items ?? [])
      .filter((t) => (t.product_id ? productIds.has(t.product_id) : sourcePostIds.has(t.post_id)))
      .map((t) => ({
        id: t.post_id,
        title: t.title,
        // 封面取第一张图片附件（is_image），回落首个附件（2026-11-09 be-worker 契约修订）
        cover_url: t.images?.find((i) => i.is_image)?.url ?? t.images?.[0]?.url ?? "",
        status: t.status,
        published_at: t.published_at ?? null,
      })),
  };
}

/**
 * 商品/博文卡片区（2026-11-09 Task #4）：加载/错误/空态/正常四态齐全。
 * 图片走 chatAssetUrl 服务端直链；空就是空（不回落演示假数据）。
 */
function CraftCardsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [state, setState] = useState<SfLoadState>("loading");
  const [products, setProducts] = useState<CraftCardProduct[]>([]);
  const [posts, setPosts] = useState<CraftCardPost[]>([]);
  useEffect(() => {
    let dead = false;
    setState("loading");
    fetchCraftCards()
      .then((d) => {
        if (dead) return;
        setProducts(d.products);
        setPosts(d.posts);
        setState("ready");
      })
      .catch(() => {
        if (dead) return;
        setProducts([]);
        setPosts([]);
        setState("error");
      });
    return () => {
      dead = true;
    };
  }, [refreshKey]);

  return (
    <article className="sf-craft-cards">
      <div className="sf-card-title">
        <div>
          <strong>商品 · 博文卡片</strong>
          <span>流水线产出：图片 → AI 草拟 → 审批门 → 落商品</span>
        </div>
        <div className="sf-craft-head">
          <SfLoadTag state={state} okText="已同步" />
        </div>
      </div>

      <p className="sf-craft-group">商品</p>
      {state === "ready" && products.length === 0 && (
        <p className="sf-craft-empty">还没有商品 —— 流水线落商品后在此上架</p>
      )}
      <div className="sf-craft-grid">
        {products.map((p) => {
          const st = CRAFT_PRODUCT_STATUS[p.status] ?? { label: p.status, cls: "" };
          const d = p.profit_delta_pct;
          return (
            <article key={p.id} className="sf-craft-card">
              <div className="sf-craft-thumb">
                {p.image_url ? (
                  <img src={chatAssetUrl(p.image_url)} alt={p.name} loading="lazy" />
                ) : (
                  <span>
                    <Store size={20} />
                  </span>
                )}
              </div>
              <div className="sf-craft-info">
                <strong title={p.name}>{p.name}</strong>
                <div className="sf-craft-meta">
                  <span className={`sf-biz-badge ${st.cls}`}>{st.label}</span>
                </div>
                <div className="sf-craft-money">
                  <em>盈利 · 近30天</em>
                  <b>{fmtYuan(p.profit_30d_cents)}</b>
                  {/* 每件盈利降为小字次要（2026-11-09 be-worker 盈利口径） */}
                  <small>每件 {fmtYuan(p.profit_per_unit_cents)}</small>
                  {d != null && (
                    // 涨红跌绿（金融约定）：盈利上涨红、下跌绿
                    <span className={`sf-craft-delta ${d >= 0 ? "up" : "down"}`}>
                      {d >= 0 ? "▲" : "▼"} {Math.abs(d)}%
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="sf-craft-group">博文</p>
      {state === "ready" && posts.length === 0 && (
        <p className="sf-craft-empty">还没有博文 —— 流水线草拟确认后在此展示</p>
      )}
      <div className="sf-craft-grid">
        {posts.map((p) => {
          const st = CRAFT_POST_STATUS[p.status] ?? { label: p.status, cls: "" };
          return (
            <article key={p.id} className="sf-craft-card">
              <div className="sf-craft-thumb">
                {p.cover_url ? (
                  <img src={chatAssetUrl(p.cover_url)} alt={p.title} loading="lazy" />
                ) : (
                  <span>
                    <BookOpen size={20} />
                  </span>
                )}
              </div>
              <div className="sf-craft-info">
                <strong title={p.title}>{p.title}</strong>
                <div className="sf-craft-meta">
                  <span className={`sf-biz-badge ${st.cls}`}>{st.label}</span>
                </div>
                <div className="sf-craft-money">
                  <em>发布</em>
                  <b>{p.published_at ? fmtBizTime(p.published_at) : "未发布"}</b>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </article>
  );
}

/** 购买链接的紧凑展示形式（host + #/buy/短 id…）；title 里放完整 URL。 */
function shortBuyUrl(url: string): string {
  try {
    const u = new URL(url);
    const id = u.hash.replace(/^#\/buy\//, "");
    return `${u.host}/#/buy/${id.slice(0, 8)}…`;
  } catch {
    return url.length > 36 ? `${url.slice(0, 36)}…` : url;
  }
}

export function BizView({ runsSig }: { runsSig?: string }) {
  const [tab, setTab] = useState<"overview" | "products" | "sales" | "shipments" | "posts">("overview");
  const [state, setState] = useState<SfLoadState>("loading");
  const [ov, setOv] = useState<BizOverview | null>(null);
  const [products, setProducts] = useState<BizProduct[]>([]);
  const [sales, setSales] = useState<BizSale[]>([]);
  const [shipments, setShipments] = useState<BizShipment[]>([]);
  const [posts, setPosts] = useState<BizPost[]>([]);
  const [steps, setSteps] = useState<BizOpsStep[]>([]);
  const [shopDialog, setShopDialog] = useState<
    { mode: "add" } | { mode: "edit"; product: BizProduct } | null
  >(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** 卡片区刷新钥匙（2026-11-08 卡片伴随商品生命周期）：商品增删后自增重拉卡片。 */
  const [cardsKey, setCardsKey] = useState(0);
  /** 订单管理（2026-11-09 图1）：状态筛选 chips / 发货弹窗 / 取消订单二步确认。 */
  const [orderFilter, setOrderFilter] = useState<"all" | "unpaid" | "pending" | "shipped" | "done" | "cancelled">("all");
  const [shipFor, setShipFor] = useState<BizSale | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const load = useCallback((silent = false) => {
    if (!silent) setState("loading");
    sfFetch<BizOverview>("/api/craft-profit/overview")
      .then((d) => {
        setOv(d);
        setState("ready");
      })
      .catch(() => {
        setOv(null);
        setState("error");
      });
    sfFetch<{ items?: BizProduct[] }>("/api/craft-profit/products")
      .then((d) => setProducts(d.items ?? []))
      .catch(() => setProducts([]));
    sfFetch<{ items?: BizSale[] }>("/api/craft-profit/sales?limit=500")
      .then((d) => setSales(d.items ?? []))
      .catch(() => setSales([]));
    sfFetch<{ shipments?: BizShipment[] }>("/api/ops/shipments")
      .then((d) => setShipments(d.shipments ?? []))
      .catch(() => setShipments([]));
    sfFetch<{ posts?: BizPost[] }>("/api/social-publish/posts")
      .then((d) => setPosts(d.posts ?? []))
      .catch(() => setPosts([]));
    sfFetch<{ steps?: BizOpsStep[] }>("/api/ops/overview")
      .then((d) => setSteps(d.steps ?? []))
      .catch(() => setSteps([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // 看板同步（2026-11-09）：团队干活落库（[intake]/[post]/[order]/[ship]/[report]
  // 标记）发生在聊天轮里——run 状态翻转（一轮干完/新任务开跑）→ 静默刷新；
  // 另挂 15s 兜底轮询覆盖轮内增量（silent 不闪加载骨架）。
  const lastSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSigRef.current === null) {
      lastSigRef.current = runsSig ?? "";
      return; // 首个值由挂载时的 load() 覆盖
    }
    if (lastSigRef.current === runsSig) return;
    lastSigRef.current = runsSig ?? "";
    load(true);
  }, [load, runsSig]);
  useEffect(() => {
    const t = setInterval(() => load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  /** 发布/重试发布帖子（POST /api/social-publish/posts/:id/publish）。 */
  async function publishPost(id: string) {
    try {
      await sfFetch(`/api/social-publish/posts/${id}/publish`, { method: "POST" });
    } finally {
      load();
    }
  }
  /** 发货（POST /api/ops/shipments/:id/ship，mock/真实由运单 mode 决定）。 */
  async function shipShipment(id: string) {
    try {
      await sfFetch(`/api/ops/shipments/${id}/ship`, { method: "POST" });
    } finally {
      load();
    }
  }

  /** 删除商品（DELETE /api/craft-profit/products/:id）：两步确认后调用。
   *  失败静默刷新回真实状态；销售流水保留快照，历史盈利不变。 */
  async function removeProduct(id: string) {
    try {
      await sfFetch(`/api/craft-profit/products/${id}`, { method: "DELETE" });
    } catch {
      /* 删除失败（网络/后端）时下方 load() 会还原真实状态 */
    } finally {
      setConfirmDel(null);
      setCardsKey((k) => k + 1); // 卡片伴随商品消失：博文卡随商品级联撤下，卡片区即时重拉
      load();
    }
  }

  /** 复制购买链接（剪贴板不可用的非安全上下文时静默降级）。 */
  async function copyBuyLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      /* 剪贴板不可用 —— 用户仍可手动复制链接文本 */
    }
  }

  /** 标记完成（POST /api/craft-profit/sales/:id/complete）：shipped→done，幂等。 */
  async function completeOrder(id: string) {
    try {
      await sfFetch(`/api/craft-profit/sales/${id}/complete`, { method: "POST" });
    } catch {
      /* 失败静默，load() 还原真实状态 */
    } finally {
      load();
    }
  }
  /** 取消订单（POST /api/craft-profit/sales/:id/cancel）：仅待支付单可取消，库存回补。 */
  async function cancelOrder(id: string) {
    try {
      await sfFetch(`/api/craft-profit/sales/${id}/cancel`, { method: "POST" });
    } catch {
      /* 失败静默，load() 还原真实状态 */
    } finally {
      setConfirmCancel(null);
      load();
    }
  }

  /* 盈利构成可视化（2026-11-10）：替换原本「指标 / 数值 / 说明」三列空表 ——
     那六项与顶部 KPI 卡重复，且只有文字没有结构。这里改成「营收怎么被拆开」
     的堆叠条 + 利润率环 + 社媒发布进度，信息密度和观感都比表格强。 */
  const rev = ov?.revenue_cents ?? 0;
  const costC = ov?.cost_cents ?? 0;
  const shipC = ov?.shipping_cents ?? 0;
  const profitC = ov?.profit_cents ?? 0;
  const margin = ov?.margin_pct ?? null;
  const base = Math.max(rev, costC + shipC + Math.max(profitC, 0), 1);
  const pctOf = (v: number) => (ov && base > 0 ? Math.max(0, (v / base) * 100) : 0);
  const published = posts.filter((p) => p.status === "published").length;
  const publishPct = posts.length > 0 ? (published / posts.length) * 100 : 0;
  const ringPct = margin != null ? Math.max(0, Math.min(100, margin)) : 0;

  const kpis: Array<[string, string, string]> = [
    ["营收", ov ? fmtYuan(ov.revenue_cents) : "—", "近 30 天"],
    ["盈利", ov ? fmtYuan(ov.profit_cents) : "—", ov?.margin_pct != null ? `利润率 ${ov.margin_pct}%` : "利润率 —"],
    ["售出", ov ? `${ov.units} 件` : "—", ov ? `${ov.sales_count} 单` : "—"],
    ["成本", ov ? fmtYuan(ov.cost_cents + ov.shipping_cents) : "—", "货本 + 运费"],
  ];

  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>BUSINESS BOARD</p>
          <h1>生意看板</h1>
          <span>手工艺品代销：商品、销售、快递、社媒与盈利，实时同步自后端业务域。</span>
        </div>
        <button onClick={() => load()}>
          <RotateCcw size={15} /> 刷新
        </button>
      </div>
      <SfLoadTag state={state} okText="业务数据已同步" />

      <div className="sf-biz-kpi">
        {kpis.map(([label, value, sub]) => (
          <article key={label} className="sf-biz-kpi-card">
            <p>{label}</p>
            <strong>{value}</strong>
            <span>{sub}</span>
          </article>
        ))}
      </div>

      {steps.length > 0 && (
        <div className="sf-biz-steps">
          {steps.map((s) => (
            <div key={s.key} className={`sf-biz-step ${s.done ? "done" : ""}`} title={s.next_hint}>
              <span>{s.done ? "✓" : "·"}</span>
              <strong>{s.name}</strong>
              <small>{s.done ? `${s.count} 项完成` : s.gap[0] || `${s.count} 项`}</small>
            </div>
          ))}
        </div>
      )}

      <div className="sf-biz-tabs">
        {(
          [
            ["overview", "总览"],
            ["products", `商品 ${products.length}`],
            ["sales", `订单 ${sales.length}`],
            ["shipments", `快递 ${shipments.length}`],
            ["posts", `社媒 ${posts.length}`],
          ] as Array<[typeof tab, string]>
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <RunDigestCard />}

      {/* 商品/博文卡片（2026-11-09 Task #4）：流水线产出面，接 /api/craft-products + /api/craft-posts */}
      {tab === "overview" && <CraftCardsSection refreshKey={cardsKey} />}

      {tab === "overview" && (
        <div className="sf-profit">
          <div className="sf-profit-main">
            <div className="sf-card-title">
              <div>
                <strong>盈利构成</strong>
                <span>营收如何拆成成本与利润</span>
              </div>
              <span className="sf-net-count">{ov ? `营收 ${fmtYuan(rev)}` : "暂无数据"}</span>
            </div>

            <div className="sf-profit-bar" role="img" aria-label="营收成本利润构成">
              {ov && rev > 0 ? (
                <>
                  <i className="cost" style={{ width: `${pctOf(costC)}%` }} title={`货本 ${fmtYuan(costC)}`} />
                  <i className="ship" style={{ width: `${pctOf(shipC)}%` }} title={`运费 ${fmtYuan(shipC)}`} />
                  <i
                    className={profitC >= 0 ? "profit" : "loss"}
                    style={{ width: `${profitC >= 0 ? pctOf(profitC) : Math.min(100, pctOf(Math.abs(profitC)))}%` }}
                    title={`${profitC >= 0 ? "盈利" : "亏损"} ${fmtYuan(Math.abs(profitC))}`}
                  />
                </>
              ) : (
                <i className="empty" />
              )}
            </div>

            <ul className="sf-profit-legend">
              <li>
                <i className="cost" />
                <span>货本</span>
                <strong>{ov ? fmtYuan(costC) : "—"}</strong>
                <small>{ov && rev > 0 ? `${pctOf(costC).toFixed(0)}%` : ""}</small>
              </li>
              <li>
                <i className="ship" />
                <span>运费</span>
                <strong>{ov ? fmtYuan(shipC) : "—"}</strong>
                <small>{ov && rev > 0 ? `${pctOf(shipC).toFixed(0)}%` : ""}</small>
              </li>
              <li className={profitC < 0 ? "neg" : ""}>
                <i className={profitC >= 0 ? "profit" : "loss"} />
                <span>{profitC >= 0 ? "盈利" : "亏损"}</span>
                <strong>{ov ? fmtYuan(profitC) : "—"}</strong>
                <small>{ov && rev > 0 ? `${pctOf(Math.abs(profitC)).toFixed(0)}%` : ""}</small>
              </li>
            </ul>

            <div className="sf-profit-publish">
              <div className="sf-profit-publish-head">
                <span>社媒发布</span>
                <strong>
                  {published} / {posts.length}
                </strong>
              </div>
              <div className="sf-profit-publish-bar">
                <i style={{ width: `${publishPct}%` }} />
              </div>
              <small>{posts.length > 0 ? `已发布占 ${publishPct.toFixed(0)}%` : "还没有帖子"}</small>
            </div>
          </div>

          <div className="sf-profit-side">
            <div className="sf-margin-ring">
              <svg viewBox="0 0 120 120" aria-label="利润率">
                <defs>
                  <linearGradient id="sfMarginGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8e6cff" />
                    <stop offset="100%" stopColor="#2ec4a6" />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="48" className="track" />
                {ringPct > 0 && (
                  <circle
                    cx="60"
                    cy="60"
                    r="48"
                    className="value"
                    strokeDasharray={`${(ringPct / 100) * 301.6} 301.6`}
                  />
                )}
              </svg>
              <div className="sf-margin-ring-text">
                <strong>{margin != null ? `${margin}%` : "—"}</strong>
                <span>利润率</span>
              </div>
            </div>
            <p className="sf-margin-hint">盈利 ÷ 营收 · 反映每 100 元流水留下多少</p>
          </div>
        </div>
      )}

      {tab === "products" && (
        <div className="sf-biz-table-wrap">
          <table className="sf-biz-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>售价</th>
                <th>货本</th>
                <th>运费</th>
                <th>已售</th>
                <th>营收</th>
                <th>盈利</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr>
                  <td colSpan={7} className="sf-biz-empty">
                    还没有商品 —— 让团队执行 [intake] 登记商品
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{fmtYuan(p.price_cents)}</td>
                  <td>{fmtYuan(p.cost_cents)}</td>
                  <td>{fmtYuan(p.shipping_cents)}</td>
                  <td>{p.sold_units}</td>
                  <td>{fmtYuan(p.revenue_cents)}</td>
                  <td>{fmtYuan(p.profit_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 订单管理（2026-11-09 图1「商品与订单」）：KPI 行 + 状态筛选 + 订单卡片，
          发货/完成/取消全走真实状态机端点，库存与统计随 load() 联动刷新。 */}
      {tab === "sales" && (
        <div className="sf-orders">
          <div className="sf-biz-kpi sf-orders-kpi">
            <article className="sf-biz-kpi-card">
              <p>商品</p>
              <strong>{products.length}</strong>
              <span>
                在售 {products.filter((p) => p.status === "active").length} · 下架{" "}
                {products.filter((p) => p.status !== "active").length}
              </span>
            </article>
            <article className="sf-biz-kpi-card">
              <p>库存</p>
              <strong>{products.reduce((n, p) => n + p.stock, 0)} 件</strong>
              <span>可售库存合计</span>
            </article>
            <article className="sf-biz-kpi-card">
              <p>累计销量</p>
              <strong>{products.reduce((n, p) => n + p.sold_units, 0)} 件</strong>
              <span>已支付订单口径</span>
            </article>
            <article className="sf-biz-kpi-card">
              <p>待发货</p>
              <strong>{sales.filter((s) => s.status === "pending").length} 笔</strong>
              <span>支付后待寄出</span>
            </article>
          </div>

          <div className="sf-order-filters">
            {(
              [
                ["all", "全部"],
                ["unpaid", "待支付"],
                ["pending", "待发货"],
                ["shipped", "已发货"],
                ["done", "已完成"],
                ["cancelled", "已取消"],
              ] as Array<["all" | "unpaid" | "pending" | "shipped" | "done" | "cancelled", string]>
            ).map(([key, label]) => {
              const n = key === "all" ? sales.length : sales.filter((s) => s.status === key).length;
              return (
                <button
                  key={key}
                  className={orderFilter === key ? "active" : ""}
                  onClick={() => setOrderFilter(key)}
                >
                  {label} {n}
                </button>
              );
            })}
          </div>

          {(orderFilter === "all" ? sales : sales.filter((s) => s.status === orderFilter)).length === 0 ? (
            <p className="sf-order-empty">
              {sales.length === 0
                ? "还没有订单 —— 顾客扫码下单后会出现在这里（[order] 标记登记的也在此列）"
                : "该状态下没有订单"}
            </p>
          ) : (
            (orderFilter === "all" ? sales : sales.filter((s) => s.status === orderFilter)).map((s) => {
              const st = BIZ_SALE_STATUS[s.status] ?? { label: s.status, cls: "" };
              return (
                <article key={s.id} className="sf-order-card">
                  <div className="sf-order-top">
                    <strong>{s.product_name || "—"}</strong>
                    <span className={`sf-biz-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="sf-order-price">
                    {fmtYuan(s.price_cents)} × {s.qty} 件 · 运费 {fmtYuan(s.shipping_cents)}
                    <b className="sf-order-total">
                      合计 {fmtYuan((s.price_cents + s.shipping_cents) * s.qty)}
                    </b>
                  </p>
                  <div className="sf-order-meta">
                    <span>下单 {fmtBizTime(s.created_at)}</span>
                    {s.paid_at ? <span>支付 {fmtBizTime(s.paid_at)}</span> : null}
                    <span className="sf-order-profit">盈利 {fmtYuan(s.profit_cents)}</span>
                  </div>
                  {(s.buyer_name || s.buyer_contact) && (
                    <div className="sf-order-row">
                      <em>买家</em>
                      {s.buyer_name || "—"}
                      {s.buyer_contact ? ` · ${s.buyer_contact}` : ""}
                    </div>
                  )}
                  {s.address ? (
                    <div className="sf-order-row">
                      <em>地址</em>
                      {s.address}
                    </div>
                  ) : null}
                  {s.note ? (
                    <div className="sf-order-row">
                      <em>备注</em>
                      {s.note}
                    </div>
                  ) : null}
                  {(s.express_company || s.tracking) && (
                    <div className="sf-order-row">
                      <em>快递</em>
                      {s.express_company || "—"} {s.tracking}
                    </div>
                  )}
                  {(s.status === "pending" || s.status === "shipped" || s.status === "unpaid") && (
                    <div className="sf-order-actions">
                      {s.status === "pending" && (
                        <button className="sf-order-primary" onClick={() => setShipFor(s)}>
                          发货
                        </button>
                      )}
                      {s.status === "shipped" && (
                        <button className="sf-order-primary" onClick={() => void completeOrder(s.id)}>
                          标记完成
                        </button>
                      )}
                      {s.status === "unpaid" &&
                        (confirmCancel === s.id ? (
                          <>
                            <button className="sf-order-danger" onClick={() => void cancelOrder(s.id)}>
                              确认取消
                            </button>
                            <button className="sf-biz-act" onClick={() => setConfirmCancel(null)}>
                              返回
                            </button>
                          </>
                        ) : (
                          <button className="sf-order-cancel" onClick={() => setConfirmCancel(s.id)}>
                            取消订单
                          </button>
                        ))}
                    </div>
                  )}
                </article>
              );
            })
          )}

          {shipFor && (
            <BizShipDialog
              sale={shipFor}
              onClose={() => setShipFor(null)}
              onShipped={() => {
                setShipFor(null);
                load();
              }}
            />
          )}
        </div>
      )}

      {tab === "shipments" && (
        <div className="sf-biz-table-wrap">
          <table className="sf-biz-table">
            <thead>
              <tr>
                <th>承运</th>
                <th>运单号</th>
                <th>收件人</th>
                <th>状态</th>
                <th>寄出时间</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && (
                <tr>
                  <td colSpan={7} className="sf-biz-empty">
                    还没有快递单 —— 让团队执行 [ship] 寄件
                  </td>
                </tr>
              )}
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.carrier.toUpperCase()} · {s.mode}
                  </td>
                  <td>{s.tracking_no || "—"}</td>
                  <td>{s.receiver_name}</td>
                  <td>
                    <span className={`sf-biz-badge ${s.status === "shipped" ? "ok" : "warn"}`}>
                      {s.status === "shipped" ? "已寄出" : s.status}
                    </span>
                  </td>
                  <td>{fmtBizTime(s.shipped_at)}</td>
                  <td>{s.remark || "—"}</td>
                  <td>
                    {s.status !== "shipped" && (
                      <button className="sf-biz-act" onClick={() => void shipShipment(s.id)}>
                        发货
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "posts" && (
        <div className="sf-biz-table-wrap">
          <table className="sf-biz-table">
            <thead>
              <tr>
                <th>平台</th>
                <th>标题</th>
                <th>状态</th>
                <th>外部 ID</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 && (
                <tr>
                  <td colSpan={6} className="sf-biz-empty">
                    还没有帖子 —— 让团队执行 [post] 发帖
                  </td>
                </tr>
              )}
              {posts.map((p) => {
                const st = BIZ_POST_STATUS[p.status] ?? { label: p.status, cls: "" };
                return (
                  <tr key={p.id}>
                    <td>{p.platform}</td>
                    <td title={p.content}>{p.title || "（无标题）"}</td>
                    <td>
                      <span className={`sf-biz-badge ${st.cls}`}>{st.label}</span>
                      {p.error ? <small className="sf-biz-err">{p.error}</small> : null}
                    </td>
                    <td>{p.external_id || "—"}</td>
                    <td>{fmtBizTime(p.published_at ?? p.created_at)}</td>
                    <td>
                      {p.status !== "published" && (
                        <button className="sf-biz-act" onClick={() => void publishPost(p.id)}>
                          发布
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 商品售卖列表（2026-11-08）：看板底部常驻货架 —— 每件商品带购买链接，
          顾客打开链接进 #/buy/<id> 购买页下单并在页面内付费；右上「添加商品」上架。 */}
      <div className="sf-shop">
        <div className="sf-shop-head">
          <div>
            <h2>商品售卖列表</h2>
            <p>顾客打开商品链接即可进购买页下单，在链接页面完成支付</p>
          </div>
          <button className="sf-shop-add" onClick={() => setShopDialog({ mode: "add" })}>
            <Plus size={14} /> 添加商品
          </button>
        </div>
        {products.length === 0 ? (
          <p className="sf-shop-empty">还没有商品 —— 点右上「添加商品」上架第一件手工艺品</p>
        ) : (
          <div className="sf-shop-grid">
            {products.map((p) => {
              const buyUrl = productBuyUrl(p.id);
              return (
                <article key={p.id} className="sf-shop-card">
                  <div className="sf-shop-img">
                    {p.image_url ? (
                      <img
                        src={chatAssetUrl(p.image_url)}
                        alt={p.name}
                        onError={(e) => {
                          // 图片链接失效（文件被清理等）→ 降级占位，不显破图
                          e.currentTarget.style.display = "none";
                          e.currentTarget.parentElement?.classList.add("sf-shop-img-broken");
                        }}
                      />
                    ) : (
                      <span>
                        <Store size={22} />
                      </span>
                    )}
                  </div>
                  <div className="sf-shop-info">
                    <strong>{p.name}</strong>
                    <p className="sf-shop-price">{fmtYuan(p.price_cents)}</p>
                    <small>
                      已售 {p.sold_units} 件 · 每件盈利 {fmtYuan(p.profit_per_unit_cents)} · 库存{" "}
                      {p.stock} 件
                      {p.status !== "active" ? " · 已下架" : ""}
                    </small>
                  </div>
                  {/* 商品链接（2026-11-08 下午：货架收款码撤掉，付费引导统一
                      走链接页）：链接旁提示买家在链接页面完成支付，一键复制；
                      删除走两步确认防误触（销售流水保留，历史盈利不变）。 */}
                  <div className="sf-shop-foot">
                    <a
                      className="sf-shop-link"
                      href={buyUrl}
                      title={buyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortBuyUrl(buyUrl)}
                    </a>
                    <span className="sf-shop-pay-hint" title="请把链接发给买家，买家在链接页面内下单并完成支付">
                      请在链接页面付费
                    </span>
                    <button
                      className="sf-shop-copy"
                      title="复制购买链接"
                      onClick={() => void copyBuyLink(p.id, buyUrl)}
                    >
                      {copiedId === p.id ? <Check size={11} /> : <Copy size={11} />}
                      {copiedId === p.id ? "已复制" : "复制"}
                    </button>
                    <button
                      className="sf-shop-copy"
                      title="编辑商品"
                      onClick={() => setShopDialog({ mode: "edit", product: p })}
                    >
                      <Pencil size={11} /> 编辑
                    </button>
                    {confirmDel === p.id ? (
                      <span className="sf-shop-del-ask">
                        <button className="sf-shop-del-yes" onClick={() => void removeProduct(p.id)}>
                          确认删除
                        </button>
                        <button className="sf-shop-del-no" onClick={() => setConfirmDel(null)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        className="sf-shop-del"
                        title="删除商品"
                        onClick={() => setConfirmDel(p.id)}
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {shopDialog && (
        <BizProductDialog
          product={shopDialog.mode === "edit" ? shopDialog.product : null}
          onClose={() => setShopDialog(null)}
          onSaved={() => {
            setShopDialog(null);
            setCardsKey((k) => k + 1); // 卡片伴随商品出生：商品卡+草稿博文卡即时上板
            load();
          }}
        />
      )}
    </section>
  );
}

/** 商品弹窗（添加/编辑，2026-11-08 图3 商品编辑）：完整商品信息 + 宣传图多张（第一张封面）。
 *  添加走 POST /api/craft-products，编辑走 PATCH /api/craft-products/:id（apiGuard 内网写）。
 *  毛利 = 售价 − 成本（不含运费），随输入实时提示。 */
function BizProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: BizProduct | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? "");
  const [subtitle, setSubtitle] = useState(product?.subtitle ?? "");
  const [price, setPrice] = useState(product ? (product.price_cents / 100).toFixed(2) : "");
  const [cost, setCost] = useState(product ? (product.cost_cents / 100).toFixed(2) : "");
  const [market, setMarket] = useState(
    product && product.market_price_cents > 0 ? (product.market_price_cents / 100).toFixed(2) : "",
  );
  const [stock, setStock] = useState(product ? String(product.stock) : "999");
  const [ship, setShip] = useState(product ? (product.shipping_cents / 100).toFixed(2) : "");
  const [pstatus, setPstatus] = useState(product?.status ?? "active");
  const [intro, setIntro] = useState(product?.intro ?? "");
  // 宣传图初始列表（2026-11-08 黑屏修复）：接口 images 出过 JSON 文本形态（"[]"），
  // 直接当数组用会在 keptUrls.map 抛错整页崩掉 —— 数组 / JSON 文本 / 异常三态都归一成 string[]。
  const initImgs: string[] = (() => {
    const raw: unknown = product?.images;
    let list: unknown[] = [];
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
    return list.filter((x): x is string => typeof x === "string").slice(0, 5);
  })();
  const [keptUrls, setKeptUrls] = useState<string[]>(
    initImgs.length > 0 ? initImgs : product?.image_url ? [product.image_url] : [],
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const totalImgs = keptUrls.length + newFiles.length;

  function pickFiles(list: FileList | null) {
    setError("");
    if (!list) return;
    const added: File[] = [];
    for (const f of Array.from(list)) {
      if (totalImgs + added.length >= 5) {
        setError("宣传图最多 5 张");
        break;
      }
      if (!f.type.startsWith("image/")) {
        setError("只支持图片文件（png / jpg / webp 等）");
        continue;
      }
      if (f.size > CHAT_UPLOAD_MAX_BYTES) {
        setError("图片超过 8MB，请压缩后再传");
        continue;
      }
      added.push(f);
    }
    if (added.length === 0) return;
    setNewFiles((prev) => [...prev, ...added]);
    for (const f of added) {
      const reader = new FileReader();
      reader.onload = () => setNewPreviews((prev) => [...prev, String(reader.result ?? "")]);
      reader.readAsDataURL(f);
    }
  }

  function removeAt(i: number) {
    if (i < keptUrls.length) {
      setKeptUrls((prev) => prev.filter((_, x) => x !== i));
    } else {
      const j = i - keptUrls.length;
      setNewFiles((prev) => prev.filter((_, x) => x !== j));
      setNewPreviews((prev) => prev.filter((_, x) => x !== j));
    }
  }

  function yuanToCents(v: string, field: string): number {
    const n = Number(v);
    if (v.trim() !== "" && (!Number.isFinite(n) || n < 0)) throw new Error(`${field} 不能是负数`);
    return Math.round((Number.isFinite(n) ? n : 0) * 100);
  }

  const priceNum = Number(price);
  const costNum = Number(cost);
  const marginPct =
    Number.isFinite(priceNum) && priceNum > 0 && Number.isFinite(costNum)
      ? Math.round(((priceNum - costNum) / priceNum) * 1000) / 10
      : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim()) {
      setError("请填写商品名称");
      return;
    }
    let priceCents = 0;
    let costCents = 0;
    let shipCents = 0;
    let marketCents = 0;
    let stockN = 0;
    try {
      priceCents = yuanToCents(price, "售价");
      costCents = yuanToCents(cost, "成本");
      shipCents = yuanToCents(ship, "运费");
      marketCents = yuanToCents(market, "市场价");
      stockN = Number(stock);
      if (!Number.isInteger(stockN) || stockN < 0) throw new Error("库存必须是非负整数");
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      // 新图走聊天附件同款上传（_uploads/<ts>-<rand>/，/projects 直链）；
      // 列表顺序 = 展示顺序，第一张为封面（与 image_url 同步）。
      const uploaded: string[] = [];
      for (const f of newFiles) {
        const att = await uploadChatAttachment(f);
        uploaded.push(att.url);
      }
      const images = [...keptUrls, ...uploaded];
      const payload = {
        name: name.trim(),
        subtitle: subtitle.trim(),
        price_cents: priceCents,
        market_price_cents: marketCents,
        cost_cents: costCents,
        shipping_cents: shipCents,
        stock: stockN,
        intro: intro.trim(),
        images,
        status: pstatus,
      };
      if (editing) {
        await sfFetch(`/api/craft-products/${encodeURIComponent(product.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const created = await sfFetch<{ product_id?: string; id?: string }>(
          "/api/craft-products",
          { method: "POST", body: JSON.stringify(payload) },
        );
        // 卡片伴随商品出生（2026-11-08）：上传商品成对生成博文草稿卡（封面=商品
        // 首图、正文=商品简介），删除商品时随商品级联删除——卡片与商品同生共死。
        const pid = created.product_id ?? created.id ?? "";
        if (pid) {
          const cover = images[0] ?? "";
          try {
            await sfFetch("/api/craft-posts", {
              method: "POST",
              body: JSON.stringify({
                title: name.trim(),
                body: intro.trim(),
                product_id: pid,
                images: cover
                  ? [{ name: "商品封面", path: cover, url: cover, is_image: true }]
                  : [],
              }),
            });
          } catch {
            /* 伴随卡生成失败不阻断商品上架（商品卡仍会正常上板） */
          }
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-shop-mask" onClick={onClose}>
      <div className="sf-shop-modal sf-shop-modal-wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{editing ? "编辑商品" : "添加商品"}</h3>
          <button className="sf-shop-close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="sf-shop-modal-body">
            <div className="sf-shop-fields">
              <label>
                <span>商品名称 *</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：水杯"
                  maxLength={200}
                />
              </label>
              <label>
                <span>一句话卖点</span>
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="如：一个水杯"
                  maxLength={200}
                />
              </label>
              <div className="sf-shop-fields-row">
                <label>
                  <span>售价（元）*</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="21.00"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  <span>成本（元）</span>
                  <input
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="12.00"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  <span>市场价（元）</span>
                  <input
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                    placeholder="40.00（划线价，可空）"
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className="sf-shop-fields-row">
                <label>
                  <span>库存（件）</span>
                  <input
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="999"
                    inputMode="numeric"
                  />
                </label>
                <label>
                  <span>运费（元）</span>
                  <input
                    value={ship}
                    onChange={(e) => setShip(e.target.value)}
                    placeholder="2.00"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  <span>上架状态</span>
                  <select value={pstatus} onChange={(e) => setPstatus(e.target.value)}>
                    <option value="active">在售</option>
                    <option value="off_shelf">已下架</option>
                  </select>
                </label>
              </div>
              <p className="sf-shop-margin-tip">
                毛利 = 售价 − 成本，当前毛利 <strong>{marginPct !== null ? `${marginPct}%` : "—"}</strong>
                ；营收统计不含运费。
              </p>
              <label>
                <span>商品介绍</span>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="一个可以喝水的水杯"
                />
              </label>
            </div>
            <div className="sf-shop-pick sf-shop-pick-multi">
              <span className="sf-shop-pick-title">宣传图片（最多 5 张，第一张为封面）</span>
              <div className="sf-shop-imgs">
                {keptUrls.map((u, i) => (
                  <div key={`k${i}`} className="sf-shop-img-tile">
                    <img src={chatAssetUrl(u)} alt={`宣传图 ${i + 1}`} />
                    {i === 0 ? <em className="sf-shop-cover">封面</em> : null}
                    <button
                      type="button"
                      className="sf-shop-img-x"
                      onClick={() => removeAt(i)}
                      aria-label="移除图片"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {newPreviews.map((u, i) => (
                  <div key={`n${i}`} className="sf-shop-img-tile">
                    <img src={u} alt={`新图 ${i + 1}`} />
                    {keptUrls.length === 0 && i === 0 ? <em className="sf-shop-cover">封面</em> : null}
                    <button
                      type="button"
                      className="sf-shop-img-x"
                      onClick={() => removeAt(keptUrls.length + i)}
                      aria-label="移除图片"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {totalImgs < 5 ? (
                  <button type="button" className="sf-shop-img-add" onClick={() => fileRef.current?.click()}>
                    + 上传图片
                  </button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <small>支持 JPG / PNG / WebP，单张 ≤ 8MB。</small>
            </div>
          </div>
          {error ? <p className="sf-shop-modal-err">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="sf-shop-save" disabled={busy}>
              {busy ? "保存中…" : editing ? "保存修改" : "保存并上架"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** 发货弹窗（2026-11-09 图1「快递公司 + 快递单号」）：POST /api/craft-profit/sales/:id/ship。
 *  快递单号必填；后端同步建 ops_shipments 运单（快递 tab 直接可见，fail-soft 不阻断）。 */
function BizShipDialog({
  sale,
  onClose,
  onShipped,
}: {
  sale: BizSale;
  onClose: () => void;
  onShipped: () => void;
}) {
  const [company, setCompany] = useState("顺丰速运");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = tracking.trim();
    if (!t) {
      setError("请填写快递单号");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sfFetch(`/api/craft-profit/sales/${sale.id}/ship`, {
        method: "POST",
        body: JSON.stringify({ express_company: company, tracking: t }),
      });
      onShipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发货失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-shop-mask" onClick={onClose}>
      <div className="sf-shop-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>发货</h3>
          <button className="sf-shop-close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="sf-shop-modal-body">
            <p className="sf-ship-product">
              {sale.product_name} · {fmtYuan(sale.price_cents)} × {sale.qty} 件 · 合计{" "}
              {fmtYuan((sale.price_cents + sale.shipping_cents) * sale.qty)}
            </p>
            <div className="sf-shop-fields">
              <label>
                <span>快递公司 *</span>
                <select value={company} onChange={(e) => setCompany(e.target.value)}>
                  {["顺丰速运", "中通快递", "圆通速递", "京东物流", "邮政EMS", "德邦快递"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>快递单号 *</span>
                <input
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  placeholder="如：SF1234567890"
                  maxLength={64}
                />
              </label>
            </div>
          </div>
          {error ? <p className="sf-shop-modal-err">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="sf-shop-save" disabled={busy}>
              {busy ? "保存中…" : "确认发货"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
