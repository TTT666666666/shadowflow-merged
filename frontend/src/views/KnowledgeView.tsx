import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import {
  BookOpen,
  FileText,
  GitBranch,
  Plus,
  X,
} from "lucide-react";
import {
  SfLoadState,
  SfLoadTag,
  fmtRelativeTime,
  sfFetch,
} from "./shared";

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

export function KnowledgeView() {
  const [packs, setPacks] = useState<SfPackCard[] | null>(null);
  const [packsState, setPacksState] = useState<SfLoadState>("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const reload = () => {
    setPacksState("loading");
    sfFetch<{ packs?: SfPackCard[] }>("/api/memory-bank/packs")
      .then((d) => {
        setPacks(Array.isArray(d?.packs) ? d.packs : []);
        setPacksState("ready");
      })
      .catch(() => {
        setPacks(null);
        setPacksState("error");
      });
  };
  useEffect(() => {
    reload();
  }, []);
  const cards: Array<[string, string, string, string, string]> = (packs ?? []).slice(0, 6).map((p) => [
    "知识包",
    p.name || p.title || (p.pack_id ? p.pack_id.slice(0, 8) : "未命名"),
    p.description || "团队共享知识包。",
    `${p.stats?.sources ?? p.source_count ?? 0} 个来源`,
    p.created_at ? fmtRelativeTime(p.created_at) : "",
  ]);
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
            <span>文档 × Agent 的引用关系图</span>
          </div>
          <span className="sf-net-count">
            {packs === null ? "加载中…" : `${packs.length} 个知识包 · 网络示意`}
          </span>
        </div>
        <svg viewBox="0 0 720 170" preserveAspectRatio="xMidYMid meet" aria-label="知识网络">
          <defs>
            <linearGradient id="sfNetLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8e6cff" stopOpacity=".55" />
              <stop offset="100%" stopColor="#2ec4a6" stopOpacity=".55" />
            </linearGradient>
          </defs>
          {[
            ["M 120 85 L 300 40", "#8e6cff"],
            ["M 120 85 L 300 85", "#c9c5ba"],
            ["M 120 85 L 300 130", "#8e6cff"],
            ["M 300 40 L 470 55", "#c9c5ba"],
            ["M 300 85 L 470 55", "#c9c5ba"],
            ["M 300 85 L 470 100", "#2ec4a6"],
            ["M 300 130 L 470 100", "#c9c5ba"],
            ["M 470 55 L 620 40", "#ff5e3a"],
            ["M 470 100 L 620 85", "#ff5e3a"],
            ["M 470 100 L 620 130", "#2ec4a6"],
          ].map(([d, c], i) => (
            <path key={i} d={d} stroke={c} strokeWidth="1.4" fill="none" opacity="0.7" />
          ))}
          {[
            [120, 85, "#8e6cff", "品牌空间", 30],
            [300, 40, "#2777e8", "竞品简报", 22],
            [300, 85, "#ff5e3a", "产品手册", 26],
            [300, 130, "#2ec4a6", "用户访谈", 22],
            [470, 55, "#d97b38", "定位假设", 20],
            [470, 100, "#c64f7d", "渠道排期", 22],
            [620, 40, "#ff5e3a", "总经理", 20],
            [620, 85, "#2777e8", "市场研究员", 20],
            [620, 130, "#2ec4a6", "内容创意", 20],
          ].map(([cx, cy, color, label, r], i) => (
            <g key={`n${i}`}>
              <circle cx={cx as number} cy={cy as number} r={r as number} fill={color as string} opacity="0.16" />
              <circle cx={cx as number} cy={cy as number} r={(r as number) / 2.4} fill={color as string} />
              <text
                x={cx as number}
                y={(cy as number) + (r as number) + 11}
                textAnchor="middle"
                fontSize="10"
                fill="#77737d"
              >
                {label as string}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <SfLoadTag state={packsState} />
      {packsState === "ready" && cards.length === 0 && (
        <p className="sf-biz-empty">还没有知识包 —— 点右上角「添加知识」创建</p>
      )}
      <div className="sf-knowledge-layout">
        {cards.map(([tag, title, desc, count, updated], i) => (
          <div key={title} className={`sf-knowledge-card${i === 0 ? " featured" : ""}`}>
            {i === 0 ? <BookOpen /> : i === 1 ? <FileText /> : <GitBranch />}
            <small>{tag}</small>
            <h2>{title}</h2>
            <p>{desc}</p>
            <footer>
              <span>{count}</span>
              <span>{updated}</span>
            </footer>
          </div>
        ))}
      </div>
      <PackCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
    </section>
  );
}
