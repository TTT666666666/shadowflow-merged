/**
 * 双语收尾自检（2026-11-10）：拦住三类回归。
 *
 * 1. **漏包**：视图里还有「用户能看见的中文」没走 `t()` —— 切到 English 后仍显示中文。
 *    判据（词法级扫描，不是逐行正则）：源码里每个汉字滑串，若落在
 *    ① 字符串字面量里、且 ② 不是 `t()/tn()/translate()/translateN()` 的实参、
 *    且 ③ 不在模板字符串的 `${}` 洞里（洞里是代码，会各自被检查）→ 判为漏包。
 *      JSX 文本节点另用 `>中文` 粗筛。
 * 2. **漏词条**：`t("…")` 里用的中文 key 在 `EN` 字典里不存在 —— 界面会静默退回中文，
 *    编译期发现不了，只能靠这条断言。带 `{v}` 占位符的 key（含 `tn(cond ? "…{v}" : …)`
 *    这类三元实参）也一并校验。
 * 3. 插值 key 必须带具名占位符（`{n}`），不得把变量固化成 key。
 *
 * 白名单只放三类：① 数据定义表（对象里的中文 label/种子名，渲染时统一过 `t(label)`）；
 * ② 品牌 / 专有名（小红书 Logo 字样、快递公司名）；③ 运行期状态值（与后端字段比对用）。
 * 新增白名单必须写明理由。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EN_DICTIONARY } from "./i18n";

const ROOT = process.cwd();

/** 本次收尾覆盖的正文文件（6 个视图 + 产品壳）。 */
const FILES = [
  "src/views/ChatView.tsx",
  "src/views/BizView.tsx",
  "src/views/AgentsView.tsx",
  "src/views/KnowledgeView.tsx",
  "src/views/SchedulesView.tsx",
  "src/views/ProjectsView.tsx",
  "src/views/TeardownView.tsx",
  "src/views/TeardownBatch.tsx",
  "src/views/TeardownCompare.tsx",
  "src/product-app/ProductApp.tsx",
];

/** 翻译函数名（第一个参数就是「中文原文 key」）。 */
const TRANSLATORS = "t|tn|translate|translateN";
const TRANSLATOR_RE = new RegExp(`^(?:${TRANSLATORS})$`);

const HAN = /[\u4e00-\u9fa5]/;

/**
 * 行级白名单：命中即豁免「中文没包 t()」判定。每条都要能说清为什么。
 */
const ALLOWED_LINES: Array<{ file: string; re: RegExp; why: string }> = [
  // 运行状态表：值本身是 key，取用时走 runStatusText() → translate()。
  {
    file: "ChatView.tsx",
    re: /^\s*(done|running|pending|failed): "[\u4e00-\u9fa5]/,
    why: "runStatusText 的状态→key 映射，取用时统一 translate()",
  },
  // 空态快捷指令：文案即 key，按钮渲染与发送都过 t(prompt)。
  {
    file: "ChatView.tsx",
    re: /^\s*"(制定 Atlas 新品发布计划|分析竞品并输出简报|查看团队执行状态|创建一个定时任务)",$/,
    why: "quickPrompts 的 key 列表，渲染时 t(prompt)",
  },
  // 与后端 run 状态字段逐字比对，不作为文案渲染。
  {
    file: "ChatView.tsx",
    re: /\.status === "[\u4e00-\u9fa5]/,
    why: "运行状态值比对（后端返回中文字面量），不展示",
  },
  // 订单 / 快递 / 博文 / 商品状态徽标：label 是 key，渲染时 t(st.label)。
  {
    file: "BizView.tsx",
    re: /^\s*(active|off_shelf|draft|confirmed|published|failed|unpaid|pending|shipped|done|cancelled|refunded): \{ label: "/,
    why: "状态徽标表，label 是 key，渲染时 t(st.label)",
  },
  // 快递公司名：品牌专有名，不做翻译（与「小红书」「ShadowFlow」同口径）。
  {
    file: "BizView.tsx",
    re: /顺丰速运|中通快递|圆通速递|京东物流|邮政EMS|德邦快递/,
    why: "快递公司品牌名，专有名词不翻译",
  },
  // 伴随博文的图片附件名，随 payload 落库，属数据不属界面文案。
  {
    file: "BizView.tsx",
    re: /name: "商品封面"/,
    why: "上传附件的 name 字段，写进后端数据，不显示为界面文案",
  },
  // 协作策略矩阵的取值 key，渲染时 t(POLICY_LABELS[st])。
  {
    file: "AgentsView.tsx",
    re: /^\s*(permit|warn|deny): "[\u4e00-\u9fa5]/,
    why: "POLICY_LABELS 的 key 表，渲染时 t(POLICY_LABELS[st])",
  },
  // 演示编队的角色名 / 队伍名：结构同后端 resolved_agents.title，属数据；
  // 卡片与 DAG 节点渲染时过 t()，命中词条则译、未命中则原样返回。
  {
    file: "AgentsView.tsx",
    re: /^\s*(name: "Atlas 新品发布作战室"|\{ id: "(MA|BP|CC|OPS|BD|CR)", title: "[\u4e00-\u9fa5])/,
    why: "演示编队种子数据（后端同名字段回落），渲染时 t(title)",
  },
  // 侧栏导航的 title/subtitle 数据表，渲染时 t(viewCopy[view].title)。
  {
    file: "ProductApp.tsx",
    re: /^\s*\w+: \{ title: "[^"]*[\u4e00-\u9fa5]|^\s*(title|subtitle): "[^"]*[\u4e00-\u9fa5]/,
    why: "viewCopy 文案表，顶栏渲染时 t(viewCopy[view].title)",
  },
  // 顶栏标题是 state 值（新建/切换会话时写入），渲染时 t(activeTitle)。
  {
    file: "ProductApp.tsx",
    re: /setActiveTitle\(|useState\("新对话"\)/,
    why: "顶栏标题 state 值，渲染时 t(activeTitle)",
  },
  // 董事长 / 单聊 是会话类型判定的字面量，渲染处另有 t(...)。
  {
    file: "ProductApp.tsx",
    re: /"董事长"|"单聊"/,
    why: "会话类型字面量（与后端 type 字段比对），渲染处单独 t(...)",
  },
  // 拖入图片的本地文件名（含时间戳），仅用于 FormData，不展示。
  {
    file: "ProductApp.tsx",
    re: /拖入图片-\$\{Date\.now\(\)\}/,
    why: "File 构造用的文件名，不展示",
  },
  // 商品诊断的「已有素材」勾选项表：label 是 key，渲染时 t(flag.label)。
  {
    file: "TeardownView.tsx",
    re: /^\s*\{ key: "\w+", label: "/,
    why: "FLAGS 勾选项表，label 是 key，渲染时 t(flag.label)",
  },
];

/** JSX 文本节点白名单（品牌字样）。 */
const ALLOWED_JSX_TEXT: Array<{ file: string; text: string; why: string }> = [
  {
    file: "ChatView.tsx",
    text: "小红书",
    why: "小红书 Logo 的 SVG 文字（品牌标识本身，与图标一体）",
  },
];

interface HanPoint {
  index: number;
  /** 位于模板字符串 `${}` 洞里（洞里是代码，另行检查）。 */
  inHole: boolean;
  /** 位于 t()/tn()/translate()/translateN() 的实参里。 */
  inTranslator: boolean;
}

interface HanRun {
  text: string;
  index: number;
  inHole: boolean;
  inTranslator: boolean;
}

/**
 * 词法级扫描：找出所有「落在字符串字面量里」的汉字，并标注它是否在 `${}` 洞里、
 * 是否在翻译函数实参里。注释、正则字面量一律跳过（避免误报）。
 */
function scanHan(src: string): HanRun[] {
  const stack: Array<"tpl" | "hole" | "sq" | "dq"> = [];
  const trStack: number[] = [];
  const points: HanPoint[] = [];
  let paren = 0;
  let ident = "";
  let i = 0;

  const nestedInHole = () => stack.includes("hole");

  while (i < src.length) {
    const c = src[i];
    const tp = stack[stack.length - 1];

    if (tp === "sq" || tp === "dq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if ((tp === "sq" && c === "'") || (tp === "dq" && c === '"')) {
        stack.pop();
        i += 1;
        continue;
      }
      if (HAN.test(c)) points.push({ index: i, inHole: nestedInHole(), inTranslator: trStack.length > 0 });
      i += 1;
      continue;
    }

    if (tp === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        stack.push("hole");
        paren += 1;
        i += 2;
        continue;
      }
      if (HAN.test(c)) points.push({ index: i, inHole: nestedInHole(), inTranslator: trStack.length > 0 });
      i += 1;
      continue;
    }

    // code（顶层或 ${} 洞里）
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "'") {
      stack.push("sq");
      ident = "";
      i += 1;
      continue;
    }
    if (c === '"') {
      stack.push("dq");
      ident = "";
      i += 1;
      continue;
    }
    if (c === "`") {
      stack.push("tpl");
      ident = "";
      i += 1;
      continue;
    }
    if (c === "(") {
      paren += 1;
      if (TRANSLATOR_RE.test(ident)) trStack.push(paren);
      ident = "";
      i += 1;
      continue;
    }
    if (c === ")") {
      if (trStack.length && trStack[trStack.length - 1] === paren) trStack.pop();
      paren -= 1;
      ident = "";
      i += 1;
      continue;
    }
    if (c === "}" && tp === "hole") {
      stack.pop();
      paren -= 1;
      ident = "";
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      ident += c;
      i += 1;
      continue;
    }
    ident = "";
    i += 1;
  }

  // 合并连续汉字为一个滑串（同一上下文内）。
  const runs: HanRun[] = [];
  let cur: HanRun | null = null;
  let last: HanPoint | null = null;
  for (const p of points) {
    const contiguous = last && last.index === p.index - 1 && last.inHole === p.inHole && last.inTranslator === p.inTranslator;
    if (cur && contiguous) cur.text += src[p.index];
    else {
      cur = { text: src[p.index], index: p.index, inHole: p.inHole, inTranslator: p.inTranslator };
      runs.push(cur);
    }
    last = p;
  }
  // 洞里的是代码不是文案，整段丢弃（里面的 t("…") 会各自作为实参被收录）。
  return runs.filter((r) => !r.inHole);
}

function lineLookup(src: string) {
  const lines = src.split("\n");
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  return (idx: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo] ?? "";
  };
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** 去注释（保留换行与字符位置），避免把注释里的 `>中文` 当成漏包。 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

function isAllowedLine(file: string, line: string): boolean {
  return ALLOWED_LINES.some((a) => a.file === file && a.re.test(line));
}

describe("i18n 覆盖：扫描器自身有效（防止空跑通过）", () => {
  const sample = [
    'const a = "未包的裸中文";',
    'const b = t("已包的中文");',
    "const c = `${t(\"洞里的中文\")} 洞外胶水`;",
    'const d = tn(flag ? "盈利 {v}" : "亏损 {v}", { v: 1 });',
    '// 注释里的中文不算',
    'const e = "sf-ceo-pin ${x ? 1 : 0}";',
  ].join("\n");

  it("抓得到漏包，放过已包 / 洞内 / 翻译函数实参", () => {
    const loose = scanHan(sample)
      .filter((r) => !r.inTranslator)
      .map((r) => r.text);
    expect(loose).toContain("未包的裸中文");
    expect(loose).toContain("洞外胶水");
    expect(loose).not.toContain("已包的中文");
    expect(loose).not.toContain("洞里的中文");
    expect(loose).not.toContain("盈利 {v}");
    expect(loose).not.toContain("亏损 {v}");
  });
});

describe("i18n 覆盖：视图正文无未包 t() 的中文", () => {
  it("字符串字面量里的中文都作为翻译函数实参", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      const file = path.basename(rel);
      const src = read(rel);
      const lineAt = lineLookup(src);
      for (const run of scanHan(src)) {
        if (run.inTranslator) continue;
        const line = lineAt(run.index);
        if (isAllowedLine(file, line)) continue;
        offenders.push(`${rel}: ${run.text.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("JSX 文本节点不以裸中文开头", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      const file = path.basename(rel);
      const src = stripComments(read(rel));
      // `>` 之后（可换行缩进）直接跟中文 → 该文本节点没走 t()。
      const re = />[ \t]*(?:\n[ \t]*)?([\u4e00-\u9fa5][^<>{}]*)/g;
      for (const m of src.matchAll(re)) {
        const text = m[1].trim();
        const hit = ALLOWED_JSX_TEXT.find((a) => a.file === file && text.startsWith(a.text));
        if (hit) continue;
        if (isAllowedLine(file, text)) continue;
        offenders.push(`${rel}: >${text.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("i18n 覆盖：用到的 key 都在 EN 字典里", () => {
  it("t()/tn()/translate()/translateN() 的字面量 key 全部有英文", () => {
    const missing: string[] = [];
    const re = new RegExp(`\\b(?:${TRANSLATORS})\\(\\s*(?:"([^"]+)"|\`([^\`]+)\`)`, "g");
    for (const rel of FILES) {
      const src = read(rel);
      for (const m of src.matchAll(re)) {
        const key = m[1] ?? m[2];
        // 只有含中文的才是「中文原文即 key」；纯英文 key（如 "Agent"）不在此列。
        if (!HAN.test(key)) continue;
        // 模板字符串里带 ${} 的是拼接，不是 key。
        if (key.includes("${")) continue;
        if (EN_DICTIONARY[key] === undefined) missing.push(`${rel}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("带 {占位符} 的中文 key 也全部有英文（含三元实参）", () => {
    const missing: string[] = [];
    for (const rel of FILES) {
      const src = read(rel);
      for (const run of scanHan(src)) {
        if (!run.inTranslator) continue;
        if (!/\{\w+\}/.test(run.text)) continue;
        if (EN_DICTIONARY[run.text] === undefined) missing.push(`${rel}: ${run.text}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("插值 key 用具名占位符，且不把变量固化进 key", () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      const src = read(rel);
      // tn() 的 key 必须含至少一个 {name} 占位符。
      for (const m of src.matchAll(/\btn\(\s*"([^"]+)"/g)) {
        if (HAN.test(m[1]) && !/\{\w+\}/.test(m[1])) bad.push(`${rel}: tn("${m[1]}") 无占位符`);
      }
      // key 里不应出现模板插值残留。
      for (const m of src.matchAll(/\b(?:t|tn|translate|translateN)\(\s*"([^"]*\$\{[^"]*)"/g)) {
        bad.push(`${rel}: key 里含 \${} → ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
