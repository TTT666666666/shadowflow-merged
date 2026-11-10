import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, GitBranch, Plus, X } from "lucide-react";
import { SfLoadState, SfLoadTag, agents, fmtRelativeTime, sfFetch } from "./shared";

type SfPackCard = {
  pack_id?: string;
  name?: string;
  title?: string;
  description?: string;
  source_count?: number;
  /** /api/memory-bank/packs 实际返回 stats.sources（不是 source_count）。 */
  stats?: { sources?: number; chunks?: number; bytes?: number };
  created_at?: string;
  status?: string;
};

/** GET /packs/{id}/sources 的条目（见 memory_bank._source_dict）。 */
type SfSource = {
  source_id?: string;
  filename?: string;
  extension?: string;
  size_bytes?: number;
  chunk_count?: number;
  unit_count?: number;
  ingest_status?: string;
};

type PackNode = {
  id: string;
  name: string;
  files: SfSource[];
  /** 只展示 stats.sources 拿不到明细时的兜底数量。 */
  count: number;
  color: string;
};

/** 包节点配色：与全站强调色同族，按索引循环。 */
const NODE_COLORS = ["#8e6cff", "#ff5e3a", "#2ec4a6", "#2777e8", "#d97b38", "#c64f7d"];
/** 每个包默认展示的文件数，超出折叠为「+N」，可点击展开。 */
const FILES_PREVIEW = 2;
/** 图里最多画几个包；更少的包会更清楚，其余用底部卡片承载。 */
const PACKS_IN_GRAPH = 4;

function packTitle(p: SfPackCard): string {
  return p.name || p.title || (p.pack_id ? p.pack_id.slice(0, 8) : "未命名");
}

/** 新建知识包弹窗：POST /api/memory-bank/packs + 可选上传来源文件。 */
function PackCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setFiles([]);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const pack = await sfFetch<{ pack_id?: string }>("/api/memory-bank/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const packId = pack?.pack_id;
      if (packId) {
        for (const file of files) {
          const form = new FormData();
          form.append("upload", file);
          await sfFetch(`/api/memory-bank/packs/${packId}/files`, { method: "POST", body: form });
        }
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请确认后端已连接");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="contact-modal sf-auth-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          <X />
        </button>
        <p className="kicker">NEW KNOWLEDGE PACK</p>
        <h2>新建知识包</h2>
        <p>知识包是团队共享的知识单元；创建后可继续添加文档、网页与文本来源。</p>
        <form onSubmit={submit}>
          <label>
            名称
            <input
              required
              value={name}
              onChange={(e: FormEvent<HTMLInputElement>) => setName(e.currentTarget.value)}
              placeholder="例如：品牌空间 / 新品发布研究"
              maxLength={200}
            />
          </label>
          <label>
            描述
            <input
              value={description}
              onChange={(e: FormEvent<HTMLInputElement>) => setDescription(e.currentTarget.value)}
              placeholder="这个知识包包含什么？（可选）"
            />
          </label>
          <label>
            上传来源文件（可选）
            <input
              type="file"
              multiple
              onChange={(e: FormEvent<HTMLInputElement>) =>
                setFiles(Array.from(e.currentTarget.files ?? []))
              }
            />
          </label>
          {files.length > 0 && <p className="sf-embed-result ok">已选择 {files.length} 个文件，创建后自动摄入</p>}
          {error && <p className="sf-auth-error">{error}</p>}
          <button className="button-primary" type="submit" disabled={busy}>
            {busy ? "创建中…" : "创建知识包"}
            {!busy && <Plus size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * 知识网络（2026-11-10 重做）
 *
 * 此前是一张写死的示意 SVG：节点名（品牌空间/竞品简报/定位假设…）是硬编码的，
 * 和真实知识包毫无关系 —— 库里只有一个「手工艺品资料」，图上却画了九个节点。
 *
 * 现在完全由真实数据驱动：左列 Agent（团队展示口径）→ 中列知识包 → 右列该包内的
 * 来源文件（GET /packs/{id}/sources，文件名 + 分块数）。文件超过 FILES_PREVIEW 个
 * 默认折叠为「+N」，点包节点或「+N」展开/收起；节点数超过 PACKS_IN_GRAPH 的包
 * 不画进图里，在下方用文字交代，避免图变成一团。
 */
function KnowledgeNetwork({
  nodes,
  state,
  expanded,
  onToggle,
  truncated,
}: {
  nodes: PackNode[];
  state: SfLoadState;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  truncated: number;
}) {
  const layout = useMemo(() => {
    const agentNodes = agents.slice(0, 3);
    let y = 34;
    const groups = nodes.slice(0, PACKS_IN_GRAPH).map((node) => {
      const open = expanded[node.id] === true;
      const shown = open ? node.files : node.files.slice(0, FILES_PREVIEW);
      const hidden = Math.max(0, node.files.length - shown.length);
      const rows = Math.max(1, shown.length + (hidden > 0 ? 1 : 0));
      const h = rows * 34;
      const g = { node, shown, hidden, open, y0: y, h, cy: y + h / 2 };
      y += h + 22;
      return g;
    });
    const height = Math.max(170, y + 12);
    const agentY = (i: number) => 34 + i * ((height - 60) / Math.max(1, agentNodes.length - 1));
    return { agentNodes, groups, height, agentY };
  }, [nodes, expanded]);

  const { agentNodes, groups, height, agentY } = layout;
  const packX = 318;
  const fileX = 512;
  const agentX = 78;

  if (state === "ready" && nodes.length === 0) {
    return (
      <div className="sf-net-empty">
        <GitBranch size={22} />
        <strong>还没有知识包</strong>
        <span>点右上角「添加知识」建一个，文件和引用关系会出现在这张图里。</span>
      </div>
    );
  }

  return (
    <div className="sf-net-stage">
      <svg viewBox={`0 0 720 ${height}`} style={{ height }} aria-label="知识网络：Agent → 知识包 → 文件">
        <defs>
          <filter id="sfNodeGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="sfAgentLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#cfc7b8" stopOpacity=".25" />
            <stop offset="100%" stopColor="#8e6cff" stopOpacity=".55" />
          </linearGradient>
        </defs>

        {/* Agent → 知识包：全员可检索，非精确引用，故用淡色虚线区分 */}
        {groups.map((g, gi) =>
          agentNodes.map((_, ai) => {
            const y1 = agentY(ai);
            const y2 = g.cy;
            return (
              <path
                key={`a-${gi}-${ai}`}
                d={`M ${agentX + 34} ${y1} C ${agentX + 140} ${y1}, ${packX - 120} ${y2}, ${packX - 30} ${y2}`}
                stroke="url(#sfAgentLine)"
                strokeWidth="1"
                strokeDasharray="3 4"
                fill="none"
              />
            );
          }),
        )}

        {/* 知识包 → 文件 */}
        {groups.map((g, gi) =>
          g.shown.map((f, fi) => {
            const y2 = g.y0 + fi * 34 + 16;
            return (
              <path
                key={`f-${gi}-${fi}`}
                d={`M ${packX + 26} ${g.cy} C ${packX + 110} ${g.cy}, ${fileX - 130} ${y2}, ${fileX - 18} ${y2}`}
                stroke={g.node.color}
                strokeWidth={fi === 0 ? 1.7 : 1.2}
                opacity={0.5 - fi * 0.06}
                fill="none"
              />
            );
          }),
        )}

        {/* Agent 节点 */}
        {agentNodes.map((a, ai) => (
          <g key={`ag-${ai}`} className="sf-net-agent">
            <circle cx={agentX} cy={agentY(ai)} r="16" fill="#8e6cff" opacity="0.1" />
            <circle cx={agentX} cy={agentY(ai)} r="6.5" fill="#fffdf9" stroke="#b6aee0" strokeWidth="2" />
            <text x={agentX} y={agentY(ai) + 26} textAnchor="middle" fontSize="9.5" fill="#8c867f">
              {a.name}
            </text>
          </g>
        ))}

        {/* 知识包节点 */}
        {groups.map((g, gi) => (
          <g
            key={`p-${gi}`}
            className={`sf-net-pack${g.open ? " open" : ""}`}
            onClick={() => onToggle(g.node.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onToggle(g.node.id);
            }}
          >
            <circle cx={packX} cy={g.cy} r="26" fill={g.node.color} opacity="0.12" filter="url(#sfNodeGlow)" />
            <circle cx={packX} cy={g.cy} r="14" fill={g.node.color} opacity="0.9" />
            <circle cx={packX} cy={g.cy} r="5" fill="#fffdf9" />
            <text x={packX} y={g.cy + 40} textAnchor="middle" fontSize="11" fontWeight="600" fill="#17162d">
              {g.node.name.length > 12 ? `${g.node.name.slice(0, 12)}…` : g.node.name}
            </text>
            <text x={packX} y={g.cy + 53} textAnchor="middle" fontSize="9" fill="#a8a29a">
              {g.node.count} 个文件
            </text>
          </g>
        ))}

        {/* 文件节点 */}
        {groups.map((g, gi) =>
          g.shown.map((f, fi) => {
            const y = g.y0 + fi * 34 + 16;
            const label = f.filename || f.source_id?.slice(0, 8) || "未命名文件";
            return (
              <g key={`file-${gi}-${fi}`} className="sf-net-file">
                <rect
                  x={fileX - 18}
                  y={y - 12}
                  width="200"
                  height="26"
                  rx="8"
                  fill="#fffdf9"
                  stroke="#e7e0d4"
                  strokeWidth="1"
                />
                <rect x={fileX - 18} y={y - 12} width="3" height="26" rx="1.5" fill={g.node.color} opacity="0.85" />
                <text x={fileX - 6} y={y + 4} fontSize="10" fill="#4a4550">
                  {label.length > 16 ? `${label.slice(0, 16)}…` : label}
                </text>
                <text x={fileX + 190} y={y + 4} fontSize="9" textAnchor="end" fill="#b3aca2">
                  {f.chunk_count != null ? `${f.chunk_count} 块` : f.extension || ""}
                </text>
              </g>
            );
          }),
        )}

        {/* 折叠提示 / 展开开关 */}
        {groups.map((g, gi) => {
          if (g.hidden <= 0 && !g.open) return null;
          if (g.node.files.length <= FILES_PREVIEW && !g.open) return null;
          const y = g.y0 + g.shown.length * 34 + 16;
          return (
            <g
              key={`more-${gi}`}
              className="sf-net-more"
              onClick={() => onToggle(g.node.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onToggle(g.node.id);
              }}
            >
              <rect x={fileX - 18} y={y - 11} width="200" height="24" rx="8" fill="#f7f4ec" stroke="#e7e0d4" />
              <text x={fileX + 91} y={y + 5} textAnchor="middle" fontSize="9.5" fill="#8c867f">
                {g.open ? "收起文件" : `还有 ${g.hidden} 个文件 · 点此展开`}
              </text>
            </g>
          );
        })}
      </svg>
      {truncated > 0 && (
        <p className="sf-net-truncated">另有 {truncated} 个知识包未画入图中，见下方卡片。</p>
      )}
    </div>
  );
}

export function KnowledgeView() {
  const [packs, setPacks] = useState<SfPackCard[] | null>(null);
  const [packsState, setPacksState] = useState<SfLoadState>("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [fileMap, setFileMap] = useState<Record<string, SfSource[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reload = () => {
    setPacksState("loading");
    sfFetch<{ packs?: SfPackCard[] }>("/api/memory-bank/packs")
      .then((d) => {
        const list = Array.isArray(d?.packs) ? d.packs : [];
        setPacks(list);
        setPacksState("ready");
        // 逐包拉文件明细：图里要画文件节点，只有 stats.sources 的数量不够
        list.slice(0, PACKS_IN_GRAPH).forEach((p) => {
          if (!p.pack_id) return;
          sfFetch<{ sources?: SfSource[] }>(
            `/api/memory-bank/packs/${encodeURIComponent(p.pack_id)}/sources`,
          )
            .then((r) => {
              const sources = Array.isArray(r?.sources) ? r.sources : [];
              setFileMap((cur) => ({ ...cur, [p.pack_id as string]: sources }));
            })
            .catch(() => {
              /* 单个包读取失败不影响整体图，节点退化为只显示数量 */
            });
        });
      })
      .catch(() => {
        setPacks(null);
        setPacksState("error");
      });
  };
  useEffect(() => {
    reload();
  }, []);

  const nodes: PackNode[] = (packs ?? []).map((p, i) => {
    const id = p.pack_id || `pack-${i}`;
    const files = fileMap[p.pack_id ?? ""] ?? [];
    return {
      id,
      name: packTitle(p),
      files,
      count: files.length || p.stats?.sources || p.source_count || 0,
      color: NODE_COLORS[i % NODE_COLORS.length],
    };
  });

  const cards: Array<[string, string, string, string, string, SfSource[]]> = (packs ?? []).slice(0, 6).map((p) => [
    "知识包",
    packTitle(p),
    p.description || "团队共享知识包。",
    `${fileMap[p.pack_id ?? ""]?.length ?? p.stats?.sources ?? p.source_count ?? 0} 个来源`,
    p.created_at ? fmtRelativeTime(p.created_at) : "",
    fileMap[p.pack_id ?? ""] ?? [],
  ]);

  const toggle = (id: string) => setExpanded((cur) => ({ ...cur, [id]: !cur[id] }));
  const totalFiles = nodes.reduce((sum, n) => sum + n.count, 0);

  return (
    <section className="sf-subview">
      <div className="sf-subview-intro">
        <div>
          <p>SHARED CONTEXT</p>
          <h1>团队知识库</h1>
          <span>让每位 Agent 都基于同一份可靠信息工作。</span>
        </div>
        <button onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> 添加知识
        </button>
      </div>

      <div className="sf-network-card">
        <div className="sf-card-title">
          <div>
            <strong>知识网络</strong>
            <span>Agent ⁄ 知识包 ⁄ 文件 的真实引用关系</span>
          </div>
          <div className="sf-net-stats">
            <span className="sf-net-count">{nodes.length} 个知识包</span>
            <span className="sf-net-count muted">{totalFiles} 个文件</span>
          </div>
        </div>
        <KnowledgeNetwork
          nodes={nodes}
          state={packsState}
          expanded={expanded}
          onToggle={toggle}
          truncated={Math.max(0, nodes.length - PACKS_IN_GRAPH)}
        />
      </div>

      <SfLoadTag state={packsState} />
      {packsState === "ready" && cards.length === 0 && (
        <p className="sf-biz-empty">还没有知识包 —— 点右上角「添加知识」创建</p>
      )}
      <div className="sf-knowledge-layout">
        {cards.map(([tag, title, desc, count, updated, files], i) => {
          const key = `card-${i}`;
          const open = expanded[key] === true;
          const shown = open ? files : files.slice(0, 3);
          return (
            <div key={title} className={`sf-knowledge-card${i === 0 ? " featured" : ""}`}>
              {i === 0 ? <BookOpen /> : i === 1 ? <FileText /> : <GitBranch />}
              <small>{tag}</small>
              <h2>{title}</h2>
              <p>{desc}</p>
              {files.length > 0 && (
                <div className="sf-pack-files">
                  <ul>
                    {shown.map((f, fi) => (
                      <li key={`${f.source_id ?? fi}`}>
                        <FileText size={11} />
                        <span>{f.filename || f.source_id || "未命名文件"}</span>
                        {f.chunk_count != null && <em>{f.chunk_count} 块</em>}
                      </li>
                    ))}
                  </ul>
                  {files.length > 3 && (
                    <button className="sf-pack-files-toggle" onClick={() => toggle(key)}>
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {open ? "收起" : `还有 ${files.length - 3} 个文件`}
                    </button>
                  )}
                </div>
              )}
              <footer>
                <span>{count}</span>
                <span>{updated}</span>
              </footer>
            </div>
          );
        })}
      </div>
      <PackCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
    </section>
  );
}
