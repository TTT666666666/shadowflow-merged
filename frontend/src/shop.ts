// 本地补全：上游仓库缺失 frontend/src/shop.ts（App.tsx / ProductApp.tsx 引用但从未提交）。
// 依据调用方约定实现：购买链接格式为 `${origin}/#/buy/<id>`（见 ProductApp.tsx shortBuyUrl）。
// 如拿到真实实现请直接替换本文件。

/** 从 URL hash 解析购买页商品 id（`#/buy/<id>` 或 `#buy=<id>`），无则返回 null。 */
export function parseBuyHash(hash: string = window.location.hash): string | null {
  const m = /^#\/buy\/([^/?#]+)/.exec(hash) ?? /^#buy=([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 生成商品购买页完整链接（绝对 URL，可直接发给买家 / 复制到剪贴板）。 */
export function productBuyUrl(productId: string): string {
  return `${window.location.origin}/#/buy/${encodeURIComponent(productId)}`;
}
