/**
 * 报告导出的回归测试：这份 HTML 是要发给买家的**交付物**，
 * 一旦排版崩了或文案漏翻，客户直接看到的是残次品。
 */
import { describe, expect, it } from "vitest";
import { buildReportHtml, reportFileName, type ReportLike } from "./report-html";

const IDENT = (s: string) => s;
const INTERP = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;

function fixture(): ReportLike {
  return {
    version: 1,
    engine: "rules-v1",
    category: { key: "beauty", label: "美妆", detected: true },
    platform: { key: "amazon", label: "亚马逊", title_max: 200, points_max: 5 },
    score: {
      total: 42,
      grade: "needs_work",
      dimensions: [
        { key: "title", score: 60, weight: 0.2, issues: 1 },
        { key: "compliance", score: 20, weight: 0.15, issues: 1 },
      ],
    },
    gates: { can_list: false, blocked_by: ["compliance.absolute"], score_cap: 59 },
    issues: [
      {
        id: "compliance.absolute",
        dim: "compliance",
        severity: "high",
        evidence: "全网最低价",
        params: { word: "全网最低价", count: 1 },
      },
      {
        id: "title.unmapped_code",
        dim: "title",
        severity: "medium",
        evidence: "",
        params: {},
      },
    ],
    titles: [{ key: "t1", text: "纯棉T恤 夏季薄款", missing: ["material"] }],
    plan: { bullets: [{ from: "100%纯棉", needs: "proof" }], faq: [] },
    counts: { issues: 2, high: 1, medium: 1, low: 0 },
  };
}

function render(patch?: Partial<Parameters<typeof buildReportHtml>[0]>) {
  return buildReportHtml({
    report: fixture(),
    listing: { title: "烟酰胺美白精华" },
    t: IDENT,
    tn: INTERP,
    now: new Date(2026, 10, 12, 19, 0),
    ...patch,
  });
}

describe("buildReportHtml", () => {
  it("输出完整文档：分数、结论、封顶提示、页脚免责声明", () => {
    const html = render();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("42");
    expect(html).toContain("先别上架");
    expect(html).toContain("总分封顶 59 分");
    expect(html).toContain("不构成法律意见");
  });

  it("问题按「合规红线 / 扣分项 / 打磨」分组，未知问题码回退成原始码不崩", () => {
    const html = render();
    expect(html).toContain("必须改（不改会被下架或罚款）");
    expect(html).toContain("建议改（扣分项，影响成交）");
    // 有文案的码渲染成人话
    expect(html).toContain("全网最低价");
    // 没文案的码原样露出，方便发现漏登记（而不是静默消失）
    expect(html).toContain("title.unmapped_code");
  });

  /**
   * 这条守的是报告的「权威性」：如果「必须改」里混进转化问题，
   * 买家会发现其中几条其实不违法，于是整份报告的警告都被打折。
   * 第一组必须与 gates.blocked_by 同源 —— 只放真会拦上架的合规红线。
   */
  it("「必须改」只放合规红线，转化类致命问题降级到「建议改」", () => {
    const report = fixture();
    report.issues = [
      ...report.issues,
      { id: "trust.no_proof", dim: "trust", severity: "high", evidence: "", params: {} },
    ];
    const html = render({ report });

    const headRed = html.indexOf("必须改（不改会被下架或罚款）");
    const headFix = html.indexOf("建议改（扣分项，影响成交）");
    expect(headRed).toBeGreaterThan(-1);
    expect(headFix).toBeGreaterThan(headRed);
    // 转化类的 high（没证据）排在第一组之后，不冒充违法
    expect(html.indexOf("没有任何证据")).toBeGreaterThan(headFix);
  });

  it("商品标题里的脚本被转义，不会把报告变成可执行页面", () => {
    const html = buildReportHtml({
      report: fixture(),
      listing: { title: '<script>alert(1)</script>纯棉' },
      t: IDENT,
      tn: INTERP,
      now: new Date(2026, 10, 12),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("署名进页脚，且带打印样式（买家点按钮即可存 PDF）", () => {
    const html = render({ brand: "Terry · Fiverr: terrylisting" });
    expect(html).toContain("Terry · Fiverr: terrylisting");
    expect(html).toContain("@media print");
    expect(html).toContain("存为 PDF");
  });

  it("英文模式切换 html lang，并把界面词走翻译", () => {
    const html = buildReportHtml({
      report: fixture(),
      listing: { title: "Niacinamide serum" },
      t: (zh) => (zh === "LISTING 体检报告" ? "Listing audit report" : zh),
      tn: INTERP,
      isEn: true,
      now: new Date(2026, 10, 12),
    });
    expect(html).toContain('lang="en"');
    expect(html).toContain("Listing audit report");
  });
});

describe("reportFileName", () => {
  it("去掉路径非法字符并带日期，买家能从文件名认出是哪件商品", () => {
    const name = reportFileName("纯棉T恤/夏季 薄款:男", new Date(2026, 10, 12));
    expect(name).toBe("listing-report-纯棉T恤-夏季-薄款-男-20261112.html");
  });

  it("空标题也能出可用的文件名", () => {
    expect(reportFileName("", new Date(2026, 10, 12))).toBe("listing-report-item-20261112.html");
  });
});
