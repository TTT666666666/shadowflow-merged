/**
 * report-html.ts — 把一份诊断报告渲染成**自包含的 HTML 文档**。
 *
 * 为什么是 HTML 而不是 PDF：
 *   - 不引依赖（无 wkhtmltopdf / puppeteer / reportlab），博客级部署也能跑
 *   - 买家双击就能看，需要 PDF 时浏览器 Ctrl+P 即可（内置 @media print，A4 分页）
 *   - 排版完全由自己控制，不受宿主页面 CSS 影响
 *
 * 文案来源唯一：仍然走 `teardown-copy.ts` 的 ISSUE_COPY + i18n 的 t/tn，
 * 这里**不复制任何判定逻辑和文案**，只负责排版。
 */
import { DIM_LABEL, DIM_ORDER, GRADE_LABEL, ISSUE_COPY, NEED_LABEL, SEVERITY_LABEL, issueParams, type IssueDim, type IssueSeverity } from "./teardown-copy";

type Translator = (zh: string) => string;
type Interpolator = (zh: string, vars?: Record<string, string | number>) => string;

/** 报告的最小结构（与后端 listing_doctor.analyze 的返回一致，后端加字段不影响这里）。 */
export interface ReportLike {
  version: number;
  engine: string;
  category?: { key: string | null; label: string | null; detected: boolean } | null;
  platform?: { key: string; label: string; title_max: number; points_max: number } | null;
  score: {
    total: number;
    grade: string;
    dimensions: Array<{ key: string; score: number; weight: number; issues: number }>;
  };
  gates: { can_list: boolean; blocked_by: string[]; score_cap: number | null };
  issues: Array<{
    id: string;
    dim: string;
    severity: IssueSeverity;
    evidence: string;
    params: Record<string, string | number>;
  }>;
  titles?: Array<{ key: string; text: string; missing: string[] }>;
  plan?: {
    bullets: Array<{ from: string; needs: string }>;
    faq: string[];
  };
  counts: { issues: number; high: number; medium: number; low: number };
}

export interface ReportHtmlInput {
  report: ReportLike;
  /** 原始商品信息，用于报告抬头的「商品」一栏。 */
  listing: { title: string; points?: string[]; price_cents?: number | null };
  t: Translator;
  tn: Interpolator;
  /** 出具方名称（个人名或工作室名），留空则不打印。 */
  brand?: string;
  /** 联系方式：邮箱 / 微信号 / Fiverr 用户名，买家要能找到人。 */
  contact?: string;
  /** 生成时间，默认取当前时间；测试时传固定值。 */
  now?: Date;
  /** 当前是否英文界面，只影响 `<html lang>`。 */
  isEn?: boolean;
}

const DIM_TONE: Record<IssueDim, string> = {
  title: "#b23c1e",
  points: "#9a5a12",
  trust: "#0b6b6a",
  pricing: "#5b3fbf",
  conversion: "#1b5aa8",
  compliance: "#9c2f5c",
};

/** HTML 转义：商品标题是用户输入，必须挡住 `<` `>` `&` 这类字符。 */
function esc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function stamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const SEVERITY_ORDER: IssueSeverity[] = ["high", "medium", "low"];

const SEVERITY_TONE: Record<IssueSeverity, string> = {
  high: "#c0392b",
  medium: "#a0641a",
  low: "#5a5a5a",
};

/** 单条问题：编号 + 结论 + 证据 + 怎么改。 */
function issueRow(
  issue: ReportLike["issues"][number],
  index: number,
  t: Translator,
  tn: Interpolator,
): string {
  const copy = ISSUE_COPY[issue.id];
  const params = issueParams(issue, t);
  const title = copy ? tn(copy.title, params) : issue.id;
  const fix = copy ? tn(copy.fix, params) : "";
  const dim = DIM_LABEL[issue.dim as IssueDim] ?? issue.dim;
  const tone = SEVERITY_TONE[issue.severity] ?? "#5a5a5a";
  return `
      <li class="item" style="border-left-color:${tone}">
        <div class="item-head">
          <span class="item-no">${index}.</span>
          <span class="item-title">${esc(title)}</span>
          <span class="item-tag" style="color:${tone}">${esc(t(SEVERITY_LABEL[issue.severity] ?? ""))} · ${esc(t(dim))}</span>
        </div>
        ${issue.evidence ? `<p class="item-ev">${esc(t("原文"))}：${esc(issue.evidence)}</p>` : ""}
        ${fix ? `<p class="item-fix"><b>${esc(t("怎么改"))}</b>${esc(fix)}</p>` : ""}
      </li>`;
}

/**
 * 生成完整 HTML。返回的字符串可以直接 `new Blob([...], {type:"text/html"})` 下载，
 * 也可以落到服务端当静态文件发。
 */
export function buildReportHtml(input: ReportHtmlInput): string {
  const { report, listing, t, tn, brand, contact, now = new Date(), isEn = false } = input;

  const total = report.score.total;
  const canList = report.gates.can_list;
  const blocked = report.gates.blocked_by ?? [];
  const grade = GRADE_LABEL[report.score.grade] ?? report.score.grade;
  const verdictTone = canList ? "#0b6b6a" : "#c0392b";

  const bySeverity = (sev: IssueSeverity) => report.issues.filter((i) => i.severity === sev);

  let issueNo = 0;
  const sections = SEVERITY_ORDER.map((sev) => {
    const rows = bySeverity(sev);
    if (!rows.length) return "";
    const heading =
      sev === "high"
        ? t("必须改（不改会被下架或罚款）")
        : sev === "medium"
          ? t("建议改（直接影响转化）")
          : t("可选打磨");
    const body = rows
      .map((issue) => issueRow(issue, ++issueNo, t, tn))
      .join("");
    return `
    <section class="block">
      <h2 class="sec-head" style="border-left-color:${SEVERITY_TONE[sev]}">
        ${esc(heading)}
        <span class="sec-count">${rows.length}</span>
      </h2>
      <ol class="items">${body}</ol>
    </section>`;
  }).join("");

  const dimRows = DIM_ORDER.map((dim) => {
    const item = report.score.dimensions.find((d) => d.key === dim);
    const value = item?.score ?? 0;
    const weight = Math.round((item?.weight ?? 0) * 100);
    return `
        <tr>
          <td class="dim-name">${esc(t(DIM_LABEL[dim]))}</td>
          <td class="dim-bar">
            <span class="bar"><i style="width:${Math.max(0, Math.min(100, value))}%;background:${DIM_TONE[dim]}"></i></span>
          </td>
          <td class="dim-score">${value}</td>
          <td class="dim-weight">${weight}%</td>
        </tr>`;
  }).join("");

  // 只给第一条推荐标题：一次给三个方案会让买家不知道用哪个，反而显得不专业
  const titlePlans = (report.titles ?? [])
    .slice(0, 1)
    .map(
      (item) => `
        <li class="plan">
          <span class="plan-text">${esc(item.text)}</span>
          ${
            item.missing?.length
              ? `<span class="plan-missing">${esc(t("标题骨架还缺这些信息"))}：${item.missing
                  .map((slot) => esc(t(NEED_LABEL[slot] ?? slot)))
                  .join("、")}</span>`
              : ""
          }
        </li>`,
    )
    .join("");

  const bulletPlans = (report.plan?.bullets ?? [])
    .map(
      (item) => `
        <li class="plan">
          <span class="plan-text">${esc(item.from)}</span>
          <span class="plan-missing">${esc(t(NEED_LABEL[item.needs] ?? item.needs))}</span>
        </li>`,
    )
    .join("");

  const title = listing.title ? esc(listing.title) : t("未填写商品标题");
  const platformName =
    report.platform && report.platform.key !== "generic"
      ? t(report.platform.label)
      : t("通用电商规则");
  const categoryName = report.category?.key
    ? t(report.category.label ?? report.category.key)
    : t("未指定类目");

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "zh"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("LISTING 体检报告"))} · ${title}</title>
<style>
  @page { size: A4; margin: 15mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 28px 56px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
    font-size: 13px; line-height: 1.65; color: #1c1c1c; background: #fff;
    max-width: 760px; margin-inline: auto;
  }
  h1, h2, h3 { margin: 0; font-weight: 600; }
  p { margin: 6px 0; }
  ol, ul { margin: 0; padding: 0; list-style: none; }

  .top { display: flex; justify-content: space-between; align-items: flex-start;
         border-bottom: 2px solid #1c1c1c; padding-bottom: 12px; gap: 16px; }
  .brand { font-size: 12px; letter-spacing: .08em; color: #555; text-transform: uppercase; }
  .doc-title { font-size: 21px; margin-top: 4px; }
  .meta { font-size: 11.5px; color: #666; text-align: right; white-space: nowrap; }

  .subject { margin-top: 16px; background: #f7f5f1; border: 1px solid #e3ded4; border-radius: 8px; padding: 12px 14px; }
  .subject dl { margin: 0; display: grid; grid-template-columns: 64px 1fr; row-gap: 4px; }
  .subject dt { color: #666; font-size: 12px; }
  .subject dd { margin: 0; font-size: 12.5px; word-break: break-word; }

  .verdict { margin-top: 18px; display: flex; align-items: center; gap: 20px; }
  .score { font-size: 46px; font-weight: 600; line-height: 1; display: flex; align-items: baseline; gap: 4px; }
  .score small { font-size: 13px; color: #777; font-weight: 400; }
  .verdict-body { flex: 1; }
  .verdict-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .grade { font-size: 15px; font-weight: 600; }
  .gate { font-size: 12px; border: 1px solid currentColor; border-radius: 999px; padding: 1px 9px; }
  .verdict-note { font-size: 12px; color: #555; margin-top: 4px; }
  .cap { font-size: 12px; color: #c0392b; margin-top: 4px; }

  .block { margin-top: 22px; }
  .sec-head { font-size: 13.5px; padding-left: 9px; border-left: 3px solid #1c1c1c; display: flex; align-items: center; gap: 8px; }
  .sec-count { font-size: 11px; color: #fff; background: #1c1c1c; border-radius: 999px; padding: 0 7px; font-weight: 400; }

  table.dims { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.dims td { padding: 5px 0; border-bottom: 1px solid #eee; font-size: 12.5px; vertical-align: middle; }
  .dim-name { width: 90px; color: #333; }
  .dim-bar { width: auto; padding-right: 12px !important; }
  .bar { display: block; height: 6px; background: #ececec; border-radius: 3px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; }
  .dim-score { width: 40px; text-align: right; font-weight: 600; }
  .dim-weight { width: 44px; text-align: right; color: #888; font-size: 11px; }

  .items { margin-top: 10px; }
  .item { border-left: 3px solid #ccc; padding: 2px 0 2px 11px; margin-bottom: 13px; break-inside: avoid; page-break-inside: avoid; }
  .item-head { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
  .item-no { font-size: 11px; color: #999; min-width: 20px; }
  .item-title { font-size: 13.5px; font-weight: 600; flex: 1; min-width: 200px; }
  .item-tag { font-size: 11px; white-space: nowrap; }
  .item-ev { font-size: 12px; color: #666; margin: 3px 0 0 21px; word-break: break-word; }
  .item-fix { font-size: 12.5px; margin: 3px 0 0 21px; }
  .item-fix b { color: #1c1c1c; margin-right: 4px; }

  .plan { padding: 7px 0; border-bottom: 1px dashed #e2e2e2; break-inside: avoid; }
  .plan-text { display: block; font-size: 12.5px; font-weight: 500; }
  .plan-missing { display: block; font-size: 11.5px; color: #777; margin-top: 2px; }

  footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 11px; font-size: 11px; color: #777; }
  footer .who { color: #333; font-size: 12px; }
  footer .legal { margin-top: 6px; line-height: 1.6; }

  .print-fab {
    position: fixed; right: 18px; bottom: 18px; z-index: 9;
    padding: 9px 16px; border: 0; border-radius: 999px; cursor: pointer;
    font-size: 12.5px; color: #fff; background: #1c1c1c; font-family: inherit;
  }
  .print-fab:hover { background: #000; }

  @media print {
    body { padding: 0; font-size: 12.5px; }
    .block { break-inside: auto; }
    .sec-head { break-after: avoid; }
    .print-fab { display: none; }
  }
</style>
</head>
<body>
  <div class="top">
    <div>
      ${brand ? `<div class="brand">${esc(brand)}</div>` : ""}
      <h1 class="doc-title">${esc(t("LISTING 体检报告"))}</h1>
    </div>
    <div class="meta">
      ${esc(t("生成时间"))}：${esc(stamp(now))}<br>
      ${esc(t("引擎"))}：${esc(report.engine || "rules-v1")}
    </div>
  </div>

  <div class="subject">
    <dl>
      <dt>${esc(t("商品"))}</dt><dd>${title}</dd>
      <dt>${esc(t("平台"))}</dt><dd>${esc(platformName)}</dd>
      <dt>${esc(t("类目"))}</dt><dd>${esc(categoryName)}</dd>
      <dt>${esc(t("检查项"))}</dt><dd>${
        (report.counts?.issues ?? report.issues.length) === 0
          ? esc(t("未发现明显问题"))
          : esc(tn("{n} 个问题待处理", { n: report.counts?.issues ?? report.issues.length }))
      }</dd>
    </dl>
  </div>

  <div class="verdict">
    <div class="score">${total}<small> / 100</small></div>
    <div class="verdict-body">
      <div class="verdict-line">
        <span class="grade">${esc(t(grade))}</span>
        <span class="gate" style="color:${verdictTone}">${esc(canList ? t("可以上架") : t("先别上架"))}</span>
      </div>
      <p class="verdict-note">
        ${esc(
          tn("{n} 个问题 · 致命 {high} · 次要 {medium} · 打磨 {low}", {
            n: report.counts?.issues ?? report.issues.length,
            high: report.counts?.high ?? 0,
            medium: report.counts?.medium ?? 0,
            low: report.counts?.low ?? 0,
          }),
        )}
      </p>
      ${
        canList
          ? ""
          : `<p class="cap">${esc(
              report.gates.score_cap != null
                ? tn("命中合规红线，总分封顶 {cap} 分", { cap: report.gates.score_cap })
                : tn("命中 {n} 项合规红线，逐条见下方「必须改」", { n: blocked.length || 1 }),
            )}</p>`
      }
    </div>
  </div>

  <section class="block">
    <h2 class="sec-head">${esc(t("六维评分"))}</h2>
    <table class="dims"><tbody>${dimRows}</tbody></table>
  </section>

  ${sections}

  ${
    titlePlans || bulletPlans
      ? `
  <section class="block">
    <h2 class="sec-head">${esc(t("改写建议"))}</h2>
    <ul>${titlePlans}${bulletPlans}</ul>
  </section>`
      : ""
  }

  <footer>
    ${brand || contact ? `<div class="who">${esc(brand ?? "")}${brand && contact ? " · " : ""}${esc(contact ?? "")}</div>` : ""}
    <div class="legal">
      ${esc(
        t(
          "本报告由规则引擎按公开平台规则与违禁词表逐项判定，同一份文案重复检测结论一致，可复核。检测范围限于文案本身，不含商品实物与资质文件真伪核验，不构成法律意见。",
        ),
      )}
    </div>
  </footer>

  <button class="print-fab" type="button" onclick="window.print()">${esc(t("存为 PDF"))}</button>
</body>
</html>`;
}

/** 报告文件名：带上商品标题前 20 字，买家收到一堆文件时能认出来。 */
export function reportFileName(listingTitle: string, now = new Date()): string {
  const cleaned = (listingTitle || "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `listing-report-${cleaned || "item"}-${day}.html`;
}
