// 本地占位组件：上游仓库缺失 frontend/src/BuyView.tsx（App.tsx 引用但从未提交）。
// 仅为让前端可编译运行；如拿到真实实现请直接替换本文件。
export default function BuyView({ productId }: { productId: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0e14", color: "#c9d1e3", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420, padding: 32, border: "1px solid #232a3b", borderRadius: 12, textAlign: "center" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>购买页</h1>
        <p style={{ fontSize: 14, color: "#8b93a7", margin: "0 0 8px" }}>
          商品 ID：<code>{productId}</code>
        </p>
        <p style={{ fontSize: 13, color: "#6b7385", margin: 0 }}>
          BuyView 组件为本地占位实现（源仓库缺失该文件），暂未接入真实支付流程。
        </p>
      </div>
    </div>
  );
}
