// 本地补全：上游仓库缺失 frontend/src/markdown.ts（ProductApp.tsx 引用但从未提交）。
// 如拿到真实实现请直接替换本文件。

/** 把 Markdown 文本降维成纯文本（用于会话摘要预览等场景）。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // 围栏代码块
    .replace(/`([^`]*)`/g, "$1") // 行内代码
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题标记
    .replace(/^\s{0,3}>\s?/gm, "") // 引用标记
    .replace(/^\s*[-*+]\s+/gm, "") // 无序列表
    .replace(/^\s*\d+\.\s+/gm, "") // 有序列表
    .replace(/^\s*\|?[\s:|-]*-[-\s:|]*\|[\s:|-]*$/gm, " ") // 表格分隔行
    .replace(/\|/g, " ") // 表格竖线
    .replace(/^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, " ") // 分隔线
    .replace(/(\*\*|__)(?!\s)([\s\S]*?)(?<!\s)\1/g, "$2") // 粗体
    .replace(/(\*\*|__)([\s\S]*?)\1/g, "$2") // 粗体（宽松）
    .replace(/(?<![\w_])\*(?!\s)([^*\n]*?)(?<!\s)\*(?![\w_])/g, "$1") // 斜体 *
    .replace(/(?<![\w_])_(?!\s)([^_\n]*?)(?<!\s)_(?![\w_])/g, "$1") // 斜体 _
    .replace(/~~([\s\S]*?)~~/g, "$1") // 删除线
    .replace(/<[^>]+>/g, "") // HTML 标签
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}
