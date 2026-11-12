/**
 * 界面文案国际化（2026-11-10）
 *
 * 设计取舍：**中文原文即 key**。不做 key 命名体系（`settings.profile.title` 那种），
 * 因为现有界面文案全是中文硬编码，改成 key 等于把 7 个视图全部重写一遍、且极易漏改。
 * 用中文原文作 key 的好处是渐进式：包一层 `t("个人资料")` 就生效，没包的照旧显示中文，
 * 不会出现空白或 key 泄漏到界面。
 *
 * 参数化文案（2026-11-10 第二轮）：带变量的句子不把插值结果当 key（否则词条爆炸），
 * 而是用 `tn("共 {n} 条", { n })` —— key 里留下具名占位符，取值时再插值。
 *
 * 覆盖范围：设置页全部导航与主要分区、主侧栏、对话 / 生意看板 / Agent 团队 /
 * 知识库 / 定时任务 / 备忘 六个视图正文、产品壳顶栏。
 * 缺词条时原样返回中文 —— 宁可是中文，也不显示原始 key。
 */
import { useEffect, useState } from "react";
import { currentPrefs, subscribePrefs } from "./settings-prefs";

const EN: Record<string, string> = {
  // ── 主侧栏 ─────────────────────────────────────────────
  对话: "Chat",
  生意看板: "Business",
  团队知识库: "Knowledge",
  知识库: "Knowledge",
  "Agent 团队": "Agents",
  备忘: "Notes",
  定时任务: "Schedules",
  项目: "Projects",
  员工: "Agents",
  日程: "Schedules",
  设置: "Settings",
  新建: "New",
  搜索: "Search",
  收起侧栏: "Collapse sidebar",
  工作空间: "Workspace",

  // ── 设置：分组 ─────────────────────────────────────────
  账户: "Account",
  外观: "Appearance",
  集成: "Integrations",
  记忆: "Memory",
  计费: "Billing",
  数据: "Data",
  管理员: "Admin",

  // ── 设置：栏目 ─────────────────────────────────────────
  个人资料: "Profile",
  主题与显示: "Theme & display",
  语言: "Language",
  Skills: "Skills",
  模型与密钥: "Models & keys",
  向量模型: "Embeddings",
  工具提供商: "Tool providers",
  连接器: "Connectors",
  "MCP 集成": "MCP",
  记忆条目: "Memory entries",
  "Agent 画像": "Agent profiles",
  交接与写回: "Handoff & write-back",
  用量: "Usage",
  通知: "Notifications",
  高级设置: "Advanced",
  用户管理: "Users",

  // ── 设置：通用 ─────────────────────────────────────────
  保存: "Save",
  保存中: "Saving",
  已保存: "Saved",
  取消: "Cancel",
  删除: "Delete",
  确认删除: "Confirm delete",
  刷新: "Refresh",
  加载中: "Loading",
  恢复默认: "Restore defaults",
  导出偏好: "Export preferences",
  清空界面缓存: "Clear UI cache",

  // ── 外观 ──────────────────────────────────────────────
  界面缩放: "Interface scale",
  标准: "Default",
  紧凑: "Compact",
  宽松: "Comfortable",
  左侧栏宽度: "Sidebar width",
  窄: "Narrow",
  宽: "Wide",
  列表密度: "List density",
  界面动效: "Motion",
  开启: "On",
  减弱: "Reduced",
  强调色: "Accent color",
  珊瑚: "Coral",
  紫罗兰: "Violet",
  青绿: "Teal",
  靛蓝: "Indigo",

  // ── 语言 ──────────────────────────────────────────────
  界面语言: "Interface language",
  简体中文: "简体中文",
  时间制: "Time format",
  "24 小时": "24-hour",
  "12 小时": "12-hour",
  货币: "Currency",
  "人民币 ¥": "CNY ¥",
  "美元 $": "USD $",
  欧元: "EUR €",
  格式预览: "Format preview",
  日期时间: "Date & time",
  金额: "Amount",
  数字: "Number",
  区域与格式: "Locale & formats",
  影响日期: "Affects how dates, times, currencies and numbers are displayed",

  // ── 用量 ──────────────────────────────────────────────
  用量与额度: "Usage & quota",
  模型调用: "Model calls",
  消耗: "Tokens used",
  折算成本: "Estimated cost",
  近: "Last",
  天: "days",
  "近 7 天": "7 days",
  "近 30 天": "30 days",
  "近 90 天": "90 days",
  输入输出构成: "Input / output split",
  输入: "Input",
  输出: "Output",
  运行: "Runs",
  成功率: "success rate",

  // ── 画像 / 交接 ────────────────────────────────────────
  主体: "Subject",
  客户: "Customer",
  用户: "User",
  置信度: "Confidence",
  来源: "Source",
  写回: "Write back",
  条目: "Entry",
  值: "Value",
  键: "Key",
  暂无数据: "No data",
  读取留痕: "Read trail",
  交接轮次: "Handoff rounds",
  待裁决冲突: "Open conflicts",

  // ── 通知 ──────────────────────────────────────────────
  浏览器通知: "Browser notifications",
  申请权限: "Request permission",
  发送测试通知: "Send test notification",
  已授权: "Granted",
  已拒绝: "Denied",
  未授权: "Not granted",
  新消息提醒: "New message alerts",
  任务完成提醒: "Run finished alerts",
  每日摘要: "Daily digest",

  // ── 通用动作 / 状态 ────────────────────────────────────
  创建: "Create",
  "创建中…": "Creating…",
  "加载中…": "Loading…",
  "保存中…": "Saving…",
  保存修改: "Save changes",
  重试: "Retry",
  失败: "Failed",
  在线: "Online",
  空闲: "Idle",
  未知状态: "Unknown",
  打开: "Open",
  编辑: "Edit",
  复制: "Copy",
  已复制: "Copied",
  全部: "All",
  返回: "Back",
  收起: "Collapse",
  展开: "Expand",
  关闭: "Close",
  确认: "Confirm",
  允许: "Permit",
  警告: "Warn",
  拒绝: "Deny",
  批准: "Approve",
  驳回: "Reject",
  通过: "Approve",
  件: "pcs",
  笔: "orders",
  块: "chunks",
  行: "lines",
  文件: "files",
  字: "chars",
  个: "items",
  项: "items",
  "已保存 ✓": "Saved ✓",

  // ── 对话视图：侧栏 ─────────────────────────────────────
  "搜索、新建或继续任何会话": "Search, start, or resume any conversation",
  收起对话面板: "Collapse conversation panel",
  关闭对话面板: "Close conversation panel",
  关闭新建菜单: "Close new menu",
  新建对话: "New conversation",
  新建项目: "New project",
  输入项目名称: "Project name",
  "搜索对话、项目或 Agent": "Search conversations, projects, or agents",
  董事长: "Chairman",
  "全局调度 · 任务拆解与决策": "Global orchestration · task breakdown & decisions",
  最近对话: "Recent conversations",
  "正在加载会话…": "Loading conversations…",
  "还没有会话 —— 点「新建」或用下面的快捷指令开始。":
    "No conversations yet — click “New” or use a shortcut below.",
  没有匹配的会话: "No matching conversations",
  "项目与 Agent": "Projects & agents",
  暂无项目与Agent: "No projects or agents yet",
  "暂无项目与 Agent（尚未创建）": "No projects or agents yet — none created",
  没有匹配的项目或Agent: "No matching projects or agents",
  "没有匹配的项目或 Agent": "No matching projects or agents",
  暂无会话: "No conversations",
  "会话 {n}": "Conversation {n}",
  "新对话 {n}": "New conversation {n}",
  点击打开单聊: "Open direct chat",
  未命名会话: "Untitled conversation",

  // ── 对话视图：右键菜单 ─────────────────────────────────
  "删除后聊天记录不可恢复": "Chat history can't be recovered after deletion",
  "删除中…": "Deleting…",
  删除对话: "Delete conversation",

  // ── 对话视图：输入框 ───────────────────────────────────
  关闭提示: "Dismiss",
  "上传中…": "Uploading…",
  "移除附件 {name}": "Remove attachment {name}",
  "继续这个会话，或给团队下发新任务…": "Continue this conversation, or give the team a new task…",
  "告诉团队接下来要做什么…": "Tell the team what to do next…",
  更多: "More",
  "小红书发布已就绪（点击移除）": "Xiaohongshu publishing ready (click to remove)",
  "小红书发布已就绪 · 点击移除": "Xiaohongshu publishing ready · click to remove",
  添加附件: "Add attachment",
  技能: "Skills",
  暂无技能: "No skills",
  "【技能】{name}": "[Skill] {name}",
  点击启用: "Click to enable",
  点击停用: "Click to disable",
  启用: "Enabled",
  停用: "Disabled",
  发布通道: "Publishing channels",
  真实发布: "Real publish",
  "mock 演示": "Mock demo",
  "未配置账号 · 默认 mock 演示": "No account · mock demo by default",
  "点亮后，输入的内容将以小红书笔记直接发布（不再显示协议文本）":
    "When on, your message is published directly as a Xiaohongshu note (no protocol text shown)",
  小红书发布: "Xiaohongshu publish",
  小红书: "Xiaohongshu",
  发帖: "Post",
  未检测到连接器: "No connectors detected",
  "Enter 发送 · Shift + Enter 换行": "Enter to send · Shift + Enter for a new line",
  发送: "Send",
  松开以上传: "Drop to upload",
  "单个文件不超过 8MB": "Up to 8 MB per file",
  "还没有消息 —— 试试上面的快捷指令，或直接输入你的第一个任务。":
    "No messages yet — try a shortcut above, or type your first task.",
  还没有消息: "No messages yet",

  // ── 对话视图：空态快捷指令 ─────────────────────────────
  "制定 Atlas 新品发布计划": "Plan the Atlas product launch",
  分析竞品并输出简报: "Analyze competitors and write a brief",
  查看团队执行状态: "Check the team's run status",
  创建一个定时任务: "Create a scheduled task",
  "在线 · 全局调度、任务拆解与决策": "Online · global orchestration, task breakdown & decisions",

  // ── 对话视图：状态与时间 ───────────────────────────────
  已完成: "Completed",
  执行中: "Running",
  等待中: "Waiting",
  运行中: "Running",
  "正在加载会话记录…": "Loading conversation…",
  "登录 / 注册": "Sign in / Sign up",
  正在生成回复: "is replying",
  等待你审批: "Waiting for your approval",
  "团队已暂停，批/拒后继续（任务面板可操作）":
    "the team is paused until you approve or reject (use the task panel)",
  "执行中，过程卡实时推进": "is running; progress cards update live",
  正在拆解任务并调度团队: "is breaking down the task and dispatching the team",
  工具: "tool",
  输出回复: "Response",
  思考中: "Thinking",
  "已等待 {t}": "Waiting {t}",
  "人工门": "human gate",
  "刚刚": "just now",
  "昨天": "yesterday",
  "{n} 分钟前": "{n} min ago",
  "{n} 小时前": "{n} h ago",
  "{n} 行": "{n} lines",
  "{n} 文件": "{n} files",

  // ── 对话视图：任务面板 ─────────────────────────────────
  任务失败: "Task failed",
  任务完成: "Task completed",
  "停止当前任务": "Stop the current task",
  停止: "Stop",
  "重试失败的任务": "Retry the failed task",
  查看任务产物: "View artifacts",
  产物: "Artifacts",
  "重跑上一轮任务": "Re-run the last task",
  重跑上一轮: "Re-run",
  收起任务面板: "Collapse task panel",
  展开任务面板: "Expand task panel",
  隐藏任务面板: "Hide task panel",
  "隐藏（顶栏可再打开）": "Hide (reopen from the top bar)",
  "{done} / {total} 个步骤已完成": "{done} / {total} steps completed",
  实时更新: "Live",
  执行步骤: "Run steps",
  "暂无运行记录 —— 在对话里给团队下发任务后，这里会实时显示执行步骤。":
    "No run yet — once you give the team a task in the chat, steps show up here live.",
  过程: "Flow",
  团队: "Team",
  审批: "Approvals",
  步骤: "Steps",
  "收起 DAG": "Hide DAG",
  "查看 DAG": "View DAG",
  重跑: "Re-run",
  "重跑步骤「{name}」": 'Re-run step "{name}"',
  "暂无 DAG 数据（接口未就绪或该会话尚未运行）":
    "No DAG data yet (API not ready, or this conversation hasn't run)",
  当前团队: "Current team",
  暂无最近活动: "No recent activity",
  已连接后端: "Backend connected",
  "当前：{v}": "Now: {v}",
  人工审批门: "Human approval gates",
  "{n} 项待审批 · 刷新": "{n} awaiting approval · Refresh",
  "每张卡片写明正在等待审批的具体对象与影响。可直接通过 / 驳回，也可以在意见框里补充命令或说明原因。":
    "Each card states exactly what is being approved and what it affects. Approve or reject directly, or add a note with extra instructions or a reason.",
  "暂无待审批事项（审批接口不可达或该会话没有挂起的审批门）。":
    "Nothing awaiting approval (the approvals API is unreachable, or this conversation has no open gates).",
  "暂无待审批事项 —— Agent 交接触发审批门时会出现在这里。":
    "Nothing awaiting approval — items appear here when an agent handoff triggers a gate.",
  审批对象: "Approval target",
  "通过后：{v}": "If approved: {v}",
  "意见（可选）：留空可直接通过 / 驳回；通过时可补充命令，驳回时请说明原因":
    "Note (optional): leave blank to approve or reject right away; add instructions when approving, or a reason when rejecting",
  通过并附意见: "Approve with note",
  驳回并说明: "Reject with reason",
  "✅ 已批准": "✅ Approved",
  "❌ 已驳回": "❌ Rejected",
  "已批准": "Approved",
  "已驳回": "Rejected",
  "补充命令：": "Note: ",
  "原因：": "Reason: ",
  人工审核已开启: "Human review is on",
  关键策略不会未经确认直接执行: "Critical policies never run without confirmation",
  "产物 · {n}": "Artifacts · {n}",
  "暂无产物 —— 运行产出的 diff、提交与文件会归并到这里。":
    "No artifacts yet — diffs, commits and files from runs are collected here.",
  取消置顶: "Unpin",
  置顶: "Pin",

  // ── 生意看板：运行速览 ─────────────────────────────────
  "LLM 调用": "LLM calls",
  "Token 消耗": "Tokens",
  估算成本: "Est. cost",
  "Run 成功率": "Run success",
  "共 {n} 次": "{n} runs",
  运行数据速览: "Run snapshot",
  "原「数据看板」重点 · 近 7 天 · 实时同步": "Highlights from the old data board · last 7 days · live",
  已同步: "Synced",
  今日调用: "Calls today",
  昨日调用: "Calls yesterday",
  "7 日 Tokens": "7-day tokens",
  失败任务: "Failed runs",
  经验记忆: "Lessons",
  "近 7 天无告警": "No alerts in the last 7 days",
  "Agent 产出排行": "Agent output ranking",
  按交接产出字符: "By handoff output characters",
  "{name} · 交接 {n} 次": "{name} · {n} handoffs",
  "{n} 字": "{n} chars",
  "成本 {v}": "Cost {v}",

  // ── 生意看板：四步流水线（stage 名由后端 ops 域下发，按原文取词条）──
  上架商品: "List products",
  生成营销帖: "Generate posts",
  多平台分发: "Distribute",
  快递寄出: "Ship orders",
  还没有商品: "No products yet",

  // ── 生意看板：卡片与盈利 ───────────────────────────────
  "商品 · 博文卡片": "Products · posts",
  "流水线产出：图片 → AI 草拟 → 审批门 → 落商品":
    "Pipeline output: image → AI draft → approval gate → product",
  商品: "Products",
  博文: "Posts",
  "还没有商品 —— 流水线落商品后在此上架": "No products yet — they appear here once the pipeline creates them",
  "还没有博文 —— 流水线草拟确认后在此展示": "No posts yet — they appear here once a draft is confirmed",
  在售: "On sale",
  已下架: "Off shelf",
  草稿: "Draft",
  已确认: "Confirmed",
  已发布: "Published",
  "盈利 · 近30天": "Profit · 30 days",
  "每件 {v}": "{v} each",
  发布: "Publish",
  未发布: "Not published",
  营收: "Revenue",
  盈利: "Profit",
  售出: "Sold",
  成本: "Cost",
  "利润率 {v}%": "Margin {v}%",
  "利润率 —": "Margin —",
  "{n} 件": "{n} units",
  "{n} 单": "{n} orders",
  "货本 + 运费": "Cost + shipping",
  "手工艺品代销：商品、销售、快递、社媒与盈利，实时同步自后端业务域。":
    "Handicraft resale: products, sales, shipping, social and profit, synced live from the backend.",
  业务数据已同步: "Business data synced",
  "{n} 项完成": "{n} done",
  "{n} 项": "{n} items",
  总览: "Overview",
  "商品 {n}": "Products {n}",
  "订单 {n}": "Orders {n}",
  "快递 {n}": "Shipping {n}",
  "社媒 {n}": "Social {n}",
  盈利构成: "Profit breakdown",
  营收如何拆成成本与利润: "How revenue splits into cost and profit",
  "营收 {v}": "Revenue {v}",
  营收成本利润构成: "Revenue, cost and profit breakdown",
  "货本 {v}": "Cost {v}",
  "运费 {v}": "Shipping {v}",
  "盈利 {v}": "Profit {v}",
  "亏损 {v}": "Loss {v}",
  货本: "Cost of goods",
  运费: "Shipping",
  亏损: "Loss",
  社媒发布: "Social publishing",
  "已发布占 {v}%": "{v}% published",
  还没有帖子: "No posts yet",
  利润率: "Margin",
  "盈利 ÷ 营收 · 反映每 100 元流水留下多少":
    "Profit ÷ revenue · how much of every ¥100 in sales you keep",

  // ── 生意看板：表格与订单 ───────────────────────────────
  售价: "Price",
  市场价: "Market price",
  已售: "Sold",
  "还没有商品 —— 让团队执行 [intake] 登记商品":
    "No products yet — have the team run [intake] to register one",
  "在售 {a} · 下架 {b}": "On sale {a} · off shelf {b}",
  库存: "Inventory",
  可售库存合计: "Total sellable stock",
  累计销量: "Units sold",
  已支付订单口径: "Based on paid orders",
  待发货: "To ship",
  "{n} 笔": "{n} orders",
  支付后待寄出: "Paid, awaiting dispatch",
  待支付: "Unpaid",
  已发货: "Shipped",
  已取消: "Canceled",
  已退款: "Refunded",
  "还没有订单 —— 顾客扫码下单后会出现在这里（[order] 标记登记的也在此列）":
    "No orders yet — they appear here after a customer orders from a link (or is logged with an [order] marker)",
  该状态下没有订单: "No orders in this status",
  "合计 {v}": "Total {v}",
  "下单 {v}": "Ordered {v}",
  "支付 {v}": "Paid {v}",
  买家: "Buyer",
  地址: "Address",
  备注: "Note",
  快递: "Carrier",
  发货: "Ship",
  标记完成: "Mark complete",
  确认取消: "Confirm cancel",
  取消订单: "Cancel order",
  承运: "Carrier",
  运单号: "Tracking no.",
  收件人: "Recipient",
  状态: "Status",
  寄出时间: "Shipped at",
  操作: "Actions",
  "还没有快递单 —— 让团队执行 [ship] 寄件":
    "No shipments yet — have the team run [ship] to send one",
  已寄出: "Shipped",
  平台: "Platform",
  标题: "Title",
  "外部 ID": "External ID",
  时间: "Time",
  "还没有帖子 —— 让团队执行 [post] 发帖": "No posts yet — have the team run [post] to publish",
  "（无标题）": "(untitled)",

  // ── 生意看板：货架与商品弹窗 ───────────────────────────
  商品售卖列表: "Product storefront",
  "顾客打开商品链接即可进购买页下单，在链接页面完成支付":
    "Customers open a product link to order and pay on that page",
  添加商品: "Add product",
  "还没有商品 —— 点右上「添加商品」上架第一件手工艺品":
    "No products yet — click “Add product” to list your first item",
  "已售 {n} 件 · 每件盈利 {v} · 库存 {m} 件":
    "{n} sold · {v} profit each · {m} in stock",
  请在链接页面付费: "Pay on the link page",
  "请把链接发给买家，买家在链接页面内下单并完成支付":
    "Send the link to the buyer; they order and pay on that page",
  复制购买链接: "Copy purchase link",
  编辑商品: "Edit product",
  删除商品: "Delete product",
  "商品名称 *": "Product name *",
  一句话卖点: "One-line pitch",
  "如：水杯": "e.g. Mug",
  "如：一个水杯": "e.g. A mug for water",
  "售价（元）*": "Price (¥) *",
  "成本（元）": "Cost (¥)",
  "市场价（元）": "Market price (¥)",
  "40.00（划线价，可空）": "40.00 (struck-through price, optional)",
  "库存（件）": "Stock (units)",
  "运费（元）": "Shipping (¥)",
  上架状态: "Listing status",
  "毛利 = 售价 − 成本，当前毛利": "Gross margin = price − cost; current margin",
  "；营收统计不含运费。": "; revenue excludes shipping.",
  商品介绍: "Product description",
  一个可以喝水的水杯: "A mug you can drink from",
  "宣传图片（最多 5 张，第一张为封面）": "Images (up to 5, the first is the cover)",
  "宣传图 {n}": "Image {n}",
  "新图 {n}": "New image {n}",
  封面: "Cover",
  移除图片: "Remove image",
  "+ 上传图片": "+ Upload image",
  "支持 JPG / PNG / WebP，单张 ≤ 8MB。": "JPG / PNG / WebP, up to 8 MB each.",
  保存并上架: "Save & list",
  "宣传图最多 5 张": "Up to 5 images",
  "只支持图片文件（png / jpg / webp 等）": "Image files only (png / jpg / webp …)",
  "图片超过 8MB，请压缩后再传": "Image exceeds 8 MB — compress it first",
  请填写商品名称: "Enter a product name",
  "{field} 不能是负数": "{field} can't be negative",
  库存必须是非负整数: "Stock must be a non-negative integer",
  "保存失败，请重试": "Save failed, please retry",
  "快递公司 *": "Carrier *",
  "快递单号 *": "Tracking number *",
  "如：SF1234567890": "e.g. SF1234567890",
  确认发货: "Confirm shipment",
  请填写快递单号: "Enter a tracking number",
  "发货失败，请重试": "Shipping failed, please retry",

  // ── Agent 团队 ────────────────────────────────────────
  "工作流 DAG": "Workflow DAG",
  "交接边随协作策略染色 · 虚线为审批门 / 驳回回炉边":
    "Edges are colored by collaboration policy · dashed = approval gate / rejection loop",
  "direct 交接": "direct handoff",
  "approve 审批门": "approve gate",
  驳回回炉: "rejection loop",
  协作策略矩阵: "Collaboration policy matrix",
  "行 → 列 方向的交接许可 · 点击格子切换 允许 / 警告 / 拒绝":
    "Row → column handoff permission · click a cell to cycle permit / warn / deny",
  "默认允许（未配置）": "permit by default (unset)",
  "{from} → {to}：{status}": "{from} → {to}: {status}",
  未配置: "Unset",
  保存策略: "Save policy",
  "审批门 · 封驳矩阵": "Approval gates · veto matrix",
  "{n} 待决": "{n} open",
  "你的 Agent 团队": "Your agent team",
  "为不同角色配置能力、工具与责任边界。":
    "Configure capabilities, tools and responsibility boundaries for each role.",
  创建Agent: "Create agent",
  "创建 Agent": "Create agent",
  知识源: "knowledge sources",
  "3 知识源": "3 knowledge sources",
  "Atlas 新品发布作战室": "Atlas launch war room",
  市场分析师: "Market analyst",
  品牌策划师: "Brand strategist",
  内容策划师: "Content strategist",
  运营专员: "Operations specialist",
  商务专员: "BD specialist",
  合规审核员: "Compliance reviewer",
  // 组织与岗位名（后端 .shadowflow/teams 团队档案下发，按原文取词条）
  "AI 营销公司": "AI marketing company",
  总经理: "General manager",
  "AI 总经理 CEO": "AI general manager / CEO",
  // 角色职责（后端 craft-team-setup 播种，前端按原文取词条）
  "目标用户、市场、竞品和需求分析": "Target users, market, competitors and needs",
  "品牌定位、产品卖点、品牌故事": "Brand positioning, selling points, brand story",
  "商品详情页、图文、短视频脚本": "Product pages, image posts, short-video scripts",
  "商品资料、上架准备、店铺运营支持": "Product data, listing prep, store operations",
  "企业采购材料、潜在客户筛选跟进": "B2B procurement decks, lead screening and follow-up",
  "内容合规、授权、品牌伦理和质量检查": "Content compliance, licensing, brand ethics and QA",
  // 岗位副标题（部门 · 职责）：soul 是系统提示词，不能直接上界面，改渲染结构化摘要
  管理层: "Leadership",
  市场研究部: "Market research",
  品牌策划部: "Brand planning",
  内容创作部: "Content creation",
  风控审核部: "Risk & compliance",
  电商运营部: "E-commerce ops",
  商务拓展部: "Business development",
  统筹调度与决策: "Orchestration and decisions",
  "自定义 Agent": "Custom agent",
  // 头像缩写（中文环境用两字，英文环境退化成角色缩写）
  市场: "MA",
  品牌: "BP",
  内容: "CC",
  运营: "OPS",
  商务: "BD",
  合规: "CR",
  配置: "Configure",
  "LIVE · 已连接后端": "LIVE · backend connected",

  // ── 知识库 ────────────────────────────────────────────
  未命名: "Untitled",
  // 记忆库 pack 名与描述（后端 craft-intake 播种，前端按原文取词条）
  手工艺品资料: "Handicraft materials",
  "残障伙伴手工艺品代卖：产品介绍、图片/文档说明、定价与卖点":
    "Handicraft resale for our disabled partners: product intros, images/docs, pricing and selling points",
  未命名文件: "Untitled file",
  新建知识包: "New knowledge pack",
  "知识包是团队共享的知识单元；创建后可继续添加文档、网页与文本来源。":
    "A knowledge pack is a shared unit of knowledge; you can keep adding documents, pages and text sources afterwards.",
  名称: "Name",
  "例如：品牌空间 / 新品发布研究": "e.g. Brand space / launch research",
  描述: "Description",
  "这个知识包包含什么？（可选）": "What does this pack cover? (optional)",
  "上传来源文件（可选）": "Upload source files (optional)",
  "已选择 {n} 个文件，创建后自动摄入": "{n} file(s) selected — ingested after creation",
  创建知识包: "Create pack",
  "创建失败，请确认后端已连接": "Creation failed — check the backend connection",
  还没有知识包: "No knowledge packs yet",
  "点右上角「添加知识」建一个，文件和引用关系会出现在这张图里。":
    "Click “Add knowledge” in the top right; files and references then appear in this graph.",
  "知识网络：Agent → 知识包 → 文件": "Knowledge network: agent → pack → file",
  知识网络: "Knowledge network",
  "Agent ⁄ 知识包 ⁄ 文件 的真实引用关系": "Real references between agents, packs and files",
  "{n} 个知识包": "{n} packs",
  "{n} 个文件": "{n} files",
  收起文件: "Collapse files",
  "还有 {n} 个文件 · 点此展开": "{n} more files · click to expand",
  "另有 {n} 个知识包未画入图中，见下方卡片。":
    "{n} more packs aren't drawn here — see the cards below.",
  "{n} 块": "{n} chunks",
  让每位Agent都基于同一份可靠信息工作: "So every agent works from the same reliable information.",
  "让每位 Agent 都基于同一份可靠信息工作。":
    "So every agent works from the same reliable information.",
  添加知识: "Add knowledge",
  知识包: "Knowledge pack",
  团队共享知识包: "A shared team knowledge pack.",
  "团队共享知识包。": "A shared team knowledge pack.",
  "{n} 个来源": "{n} sources",
  "还没有知识包 —— 点右上角「添加知识」创建":
    "No knowledge packs yet — click “Add knowledge” in the top right",
  "还有 {n} 个文件": "{n} more files",

  // ── 定时任务 ──────────────────────────────────────────
  "全部 Agent 的周期与一次性执行计划。": "Recurring and one-off runs across all agents.",
  创建定时任务: "New scheduled task",
  任务描述: "Task description",
  "例如：每天生成竞品动态简报": "e.g. Daily competitor briefing",
  触发方式: "Trigger",
  "周期（cron）": "Recurring (cron)",
  一次性: "One-off",
  "cron 表达式": "cron expression",
  "0 9 * * *（分 时 日 月 周）": "0 9 * * * (min hour day month weekday)",
  执行时间: "Run at",
  执行群组: "Conversation",
  "选择群组…": "Select a conversation…",
  "指定 Agent（可选）": "Agent (optional)",
  自动调度: "Auto-route",
  "创建失败，请重试": "Creation failed, please retry",
  "还没有定时任务 —— 点右上角「创建定时任务」添加":
    "No scheduled tasks yet — click “New scheduled task” in the top right",
  已停用: "Disabled",
  停用任务: "Disable task",
  启用任务: "Enable task",
  删除任务: "Delete task",
  下次: "Next",
  待触发: "Pending",

  // ── 备忘 ──────────────────────────────────────────────
  工作备忘: "Memos",
  "个人日程与备忘，随手增删。": "Personal schedule and notes — add or remove anytime.",
  "备忘标题（必填）": "Memo title (required)",
  "日期（可选）": "Date (optional)",
  "备注（可选）": "Note (optional)",
  添加: "Add",
  "共 {n} 条 · 待办 {a} 条 · 已完成 {b} 条": "{n} total · {a} open · {b} done",
  "还没有备忘 —— 在上方填一条，点「添加」": "No memos yet — fill one in above and click “Add”",
  "已逾期 · {date}": "Overdue · {date}",
  "今天 · {date}": "Today · {date}",
  标记为待办: "Mark as open",
  "删除备忘「{title}」？": "Delete memo “{title}”?",
  "更新失败，请重试": "Update failed, please retry",
  "删除失败，请重试": "Delete failed, please retry",

  // ── 产品壳：导航与顶栏 ─────────────────────────────────
  返回ShadowFlow官网: "Back to the ShadowFlow site",
  "返回 ShadowFlow 官网": "Back to the ShadowFlow site",
  关闭导航: "Close navigation",
  打开导航: "Open navigation",
  选择或新建一个会话: "Select or start a conversation",
  "Agent 团队执行中": "Agent team is running",
  "{name} 正在输入…": "{name} is typing…",
  会话在线: "Conversation live",
  新对话: "New conversation",
  会话: "Conversation",
  单聊: "Direct chat",
  "管理角色、能力与协作关系": "Manage roles, capabilities and collaboration",
  "管理团队共享的知识与上下文": "Manage shared knowledge and context",
  "手工艺品代销：商品、销售、快递、社媒与盈利":
    "Handicraft resale: products, sales, shipping, social and profit",
  "管理所有 Agent 的周期与一次性计划": "Manage recurring and one-off runs for all agents",
  "模型、Skills、集成、记忆与工作空间": "Models, skills, integrations, memory and workspace",
  "创建对话失败：后端未返回会话 ID，请重试":
    "Couldn't create the conversation: the backend returned no session ID. Please retry.",
  "创建对话失败：{msg}（后端可达后可再次点击「新建」重试）":
    "Couldn't create the conversation: {msg} (click “New” again once the backend is reachable)",
  "项目「{name}」已创建": "Project “{name}” created",
  "创建项目失败：{msg}": "Couldn't create the project: {msg}",
  "删除对话失败：{detail}": "Couldn't delete the conversation: {detail}",
  已删除对话: "Conversation deleted",
  文件名含非法字符: "Filename has invalid characters",
  "单条消息最多 9 个附件": "Up to 9 attachments per message",
  "超过 8MB 上限": "Exceeds the 8 MB limit",
  上传失败: "Upload failed",
  "未识别到可上传的图片，请改用回形针按钮或截图后粘贴":
    "No uploadable image detected — use the paperclip button, or paste a screenshot",
  "拖入的内容不是图片，仅支持图片文件": "That drop isn't an image — image files only",
  "无法获取该图片，请改用回形针按钮或截图后粘贴":
    "Couldn't fetch that image — use the paperclip button, or paste a screenshot",
  "有附件上传失败（红标），请移除后重试，或改用回形针重新上传":
    "Some attachments failed (red) — remove them and retry, or re-upload with the paperclip",
  已登录: "Signed in",
  账号菜单: "Account menu",
  退出登录: "Sign out",
  当前为演示模式: "Demo mode",
  执行详情: "Run details",
  董: "C",
  "请先登录以使用真实工作台数据": "Sign in to use real workbench data",
  "当前为演示模式 —— 界面可浏览，数据将在登录后与后端打通":
    "Demo mode — you can browse the UI; data connects to the backend after you sign in",
  游客体验: "Continue as guest",
  登录: "Sign in",
  注册: "Sign up",

  // ── 商品诊断（Listing Doctor）──────────────────────────────────────────
  "商品诊断": "Listing Doctor",
  "贴一份商品页，拿到可执行的改造清单":
    "Paste a product page, get an actionable fix list",
  "贴一份商品页": "Paste a product page",
  "卖点（一行一条）": "Selling points (one per line)",
  "详情 / 描述": "Details / description",
  "价格（元）": "Price (CNY)",
  "已有素材（勾了就按有算）": "What you already have (checked = counted)",
  "材质或工艺": "Material or craft",
  "检测 / 资质 / 实拍口碑": "Tests, certifications or real reviews",
  售后承诺: "After-sales promise",
  发货时效: "Shipping lead time",
  "对比价或套餐档": "Reference price or bundles",
  "赠品或包邮": "Gift or free shipping",
  明确的行动指令: "A clear call to action",
  "联系方式 / 客服入口": "Contact or support entry",
  开始诊断: "Run diagnosis",
  "诊断中…": "Diagnosing…",
  清空: "Clear",
  示例: "Example",
  "总分": "Score",
  可以上架: "Cleared to list",
  先别上架: "Hold before listing",
  "命中合规红线，总分封顶 {cap} 分":
    "Compliance red line hit — score capped at {cap}",
  "个问题": "issues",
  "致命": "Critical",
  "次要": "Minor",
  "打磨": "Polish",
  "{n} 个问题 · 致命 {high} · 次要 {medium} · 打磨 {low}":
    "{n} issues · {high} critical · {medium} minor · {low} polish",
  怎么改: "How to fix",
  证据: "Evidence",
  "标题改写（填空版）": "Title rewrites (fill-in)",
  "缺：{slots}": "Missing: {slots}",
  待补清单: "What's still missing",
  卖点补一句: "Add a benefit line to",
  最近的诊断: "Recent diagnoses",
  还没有诊断记录: "No diagnoses yet",
  引擎: "Engine",
  "规则引擎 v1": "Rules engine v1",
  "规则 + 模型": "Rules + model",
  "规则引擎，离线可跑，结论可复现":
    "Rules engine — runs offline, results are reproducible",
  "把这份清单变成交付": "Turn this list into a delivery",
  "让团队按清单改一遍文案、主图和详情，交付可用的成稿":
    "Have the team rewrite copy, hero images and the detail page from this list",
  去生意看板下单: "Order from the business board",
  "价格维度未计入": "Price not scored",

  // 维度名
  "标题力": "Title",
  "卖点结构": "Selling points",
  "信任状": "Trust signals",
  "价格锚点": "Price anchor",
  "转化路径": "Conversion path",
  "合规风险": "Compliance risk",
  // 等级
  "优秀": "Excellent",
  "良好": "Good",
  "待改": "Needs work",
  "危险": "Risky",
  // 标题骨架缺位
  "品名": "Product name",
  "利益点": "Benefit",
  "规格": "Spec",
  "场景": "Occasion",
  // 待补诉求
  "补一句「对你有什么用」": "Add what it does for the buyer",
  "补一条可核验的证据": "Add verifiable proof",
  "补售后承诺": "Add an after-sales promise",
  "补发货时效": "Add shipping lead time",
  "补材质或工艺": "Add material or craft",

  // 问题码：标题力
  "标题是空的": "The title is empty",
  "至少写清「是什么 + 给谁用 + 一个规格」，三个信息缺一个都会掉搜索命中。":
    "State what it is, who it's for, and one spec — missing any of the three costs you search matches.",
  "标题只有 {length} 字，搜索词挤不进去（建议 {min} 字以上）":
    "Title is only {length} characters — search terms won't fit (aim for {min}+)",
  "按「品名 + 关键规格 + 场景或人群」重写，把买家用得到的那几个词放进去。":
    "Rewrite as name + key spec + occasion or audience, using the words buyers actually search.",
  "标题 {length} 字，超出常见截断长度（{max} 字内更稳）":
    "Title is {length} characters — longer than typical truncation (keep within {max})",
  "把最不重要的形容词删到详情里，标题只留能被搜到的实词。":
    "Move the least important adjectives into the details; keep only searchable nouns in the title.",
  "标题里没有任何数字或规格": "No numbers or specs in the title",
  "把尺寸、容量、数量或时长写进标题——数字是单位字数里最省的说服力。":
    "Put size, capacity, quantity or duration in the title — numbers persuade hardest per character.",
  "标题里「{word}」重复出现": "“{word}” repeats in the title",
  "删掉重复词，把位置让给场景和规格；重复不影响搜索权重，只浪费字数。":
    "Drop the repeats and give the space to occasion and spec — repetition adds no search weight, only length.",
  "标题堆了过多符号或表情": "Too many symbols or emoji in the title",
  "符号最多留 1 个，其余换成实词——平台搜索不认符号，买家也不认。":
    "Keep at most one symbol; replace the rest with real words — search ignores symbols and so do buyers.",

  // 问题码：卖点结构
  "卖点只有 {count} 条，撑不起说服（建议 {min} 条起）":
    "Only {count} selling points — not enough to persuade (aim for {min}+)",
  "按「功能 / 信任 / 场景」各补一条，三块齐了才有人愿意往下看。":
    "Add one of each: function, trust, occasion. All three present is what keeps people reading.",
  "卖点 {count} 条，注意力被分散了（建议 {max} 条内）":
    "{count} selling points is too many — attention is split (keep within {max})",
  "只留最能决定下单的 5 条，其余挪进详情页，首屏不要超过一屏。":
    "Keep the five that decide the purchase, move the rest into the details; keep the first screen to one screen.",
  "{count}/{total} 条卖点只写了参数，没写对买家有什么用":
    "{count} of {total} selling points list specs without saying what they do for the buyer",
  "每条后面补半句「所以你能……」，参数是理由，利益才是买点。":
    "Append “so you can…” to each — specs are the reason, the benefit is what sells.",
  "有 {count} 条卖点内容重复": "{count} selling points are duplicates",
  "把重复项合并成一条，省下的位置写真正的差异点。":
    "Merge the duplicates into one and use the space for a real differentiator.",

  // 问题码：信任状
  "没写材质、成分或工艺": "No material, ingredient or craft stated",
  "买家第一反应是「这是什么东西做的」，一句话交代清楚，别让他猜。":
    "The first question is “what is this made of” — answer it in one line instead of making them guess.",
  "没有任何证据：检测、资质、实拍、口碑都没有":
    "No evidence at all — no tests, certifications, real photos or reviews",
  "至少放一条可核验的证据；一张实拍图比三个形容词有用。":
    "Add at least one verifiable proof point; one real photo beats three adjectives.",
  "没写售后承诺": "No after-sales promise",
  "写清退换条件与破损补发——这是压掉最后一点犹豫的那句话。":
    "State return conditions and replacement for damage — that's the line that kills the last hesitation.",
  "没写发货时效或物流方式": "No shipping lead time or carrier",
  "写明「几点前下单当天发」「包不包邮」，很多人是因为不确定才不买。":
    "Say “order before X and it ships today” and whether shipping is free — many people don't buy because they're unsure.",

  // 问题码：价格锚点
  "没填价格": "No price provided",
  "填上到手价，诊断才能判断锚点是否成立（不填这一项只影响价格维度）。":
    "Enter the final price so the anchor can be judged (skipping it only affects the pricing dimension).",
  "只有单一价格，没有对比锚点": "One price only — no anchor to compare against",
  "给原价 / 到手价，或做两档套餐——没有对比，「便宜」就不成立。":
    "Show list price vs final price, or offer two tiers — without a comparison, “cheap” means nothing.",
  "没提赠品或包邮": "No gift or free shipping mentioned",
  "加一个小额赠品（贺卡、备用件）或标出包邮，感知价值远高于成本。":
    "Add a small gift (card, spare part) or mark free shipping — perceived value far exceeds the cost.",

  // 问题码：转化路径
  "没有明确的行动指令": "No clear call to action",
  "结尾加一句「点下方立即下单」。不写这一句，很多人看完就走。":
    "End with “tap below to order now”. Without it, many people just leave.",
  "只有「{word}」这类模糊指令": "Only a vague call to action: “{word}”",
  "换成具体动作：立即下单 / 私信报尺寸 / 扫码领券，一步到位。":
    "Replace with a concrete action: order now, DM your size, or scan for a coupon.",
  "没留联系方式": "No contact details",
  "定制类商品必须留私信或客服入口，否则想买的人找不到你。":
    "Made-to-order items must leave a DM or support entry, otherwise ready buyers can't reach you.",
  "没写可选规格（颜色 / 尺寸 / 款式）": "No selectable options (color, size, style)",
  "列出可选档位，买家会自己对号入座，减少来回问价。":
    "List the options so buyers can self-select and stop asking back and forth.",

  // 问题码：合规风险
  "出现极限词「{word}」": "Superlative term found: “{word}”",
  "广告法禁止最高级表述，换成可核验的具体描述（材质、参数、实测数据）。":
    "Advertising law bans superlatives — replace with verifiable specifics (material, specs, measured data).",
  "出现功效宣称「{word}」": "Efficacy claim found: “{word}”",
  "普通商品不能宣称疗效，删掉或改成使用体验描述，否则有下架风险。":
    "Ordinary goods can't claim medical effects — remove it or describe the experience instead, or risk delisting.",
  "出现效果保证「{word}」": "Absolute efficacy guarantee found: “{word}”",
  "「保证有效」「包治」属于对效果的绝对承诺，普通商品不能写。改成有条件承诺，例如「非人为损坏 7 天内可退」。":
    "“Guaranteed effective” or “cures” promises a result no ordinary product can deliver. Replace it with a conditional promise, e.g. “7-day return for non-human damage”.",
  "承诺「{word}」需能兑现": "Promise “{word}” must be fulfilable",
  "终身、永久、无效退款、零风险属于服务承诺，兑现不了就是虚假宣传。改成明确期限，例如「3 年质保，非人为损坏包换」。":
    "Lifetime, forever, refund-if-ineffective and zero-risk are service promises; failing to honour them is false advertising. State a concrete term instead, e.g. “3-year warranty, replacement for non-human damage”.",

  // 批量诊断（P0：代运营 / 内容工作室）
  单条诊断: "Single listing",
  批量诊断: "Batch diagnosis",
  "贴一份商品表": "Paste a product table",
  "逐条复用同一套规则，脏数据不拖垮整批":
    "Same rules applied to every row; one bad row won't sink the batch",
  "CSV 列：标题 / 卖点 / 详情 / 价格 / 已有素材":
    "CSV columns: title / points / detail / price / assets",
  "卖点用竖线分隔，价格按元填写": "Separate selling points with | ; enter price in CNY",
  "单次最多 {n} 条": "Up to {n} rows per run",
  填入示例表格: "Fill sample table",
  复制空白模板: "Copy blank template",
  "上传 CSV 文件": "Upload CSV file",
  "CSV 内容": "CSV content",
  "批次名称（选填）": "Batch name (optional)",
  "白标抬头（选填）": "White-label header (optional)",
  开始批量诊断: "Run batch diagnosis",

  // 报告导出（交付物：发给买家的那份 HTML）
  "LISTING 体检报告": "Listing audit report",
  生成时间: "Generated",
  类目: "Category",
  // 后端 CATEGORY_LABELS 的中文值直接进报告，英文界面要能翻
  "食品/保健": "Food / supplements",
  "美妆/护肤": "Beauty / skincare",
  "母婴/玩具": "Baby / toys",
  "器械/消毒": "Medical devices / disinfectants",
  检查项: "Checks",
  "未发现明显问题": "No obvious issues found",
  "{n} 个问题待处理": "{n} issues to fix",
  六维评分: "Score breakdown",
  原文: "Found in",
  改写建议: "Suggested rewrite",
  "标题骨架还缺这些信息": "Title still missing",
  "未填写商品标题": "Untitled listing",
  通用电商规则: "General marketplace rules",
  "未指定类目": "No category specified",
  "存为 PDF": "Save as PDF",
  下载报告: "Download report",
  "署名 / 联系方式（印在报告页脚）": "Signature / contact (printed in footer)",
  "必须改（不改会被下架或罚款）": "Must fix — risk of takedown or fine",
  "建议改（直接影响转化）": "Should fix — hurts conversion",
  可选打磨: "Optional polish",
  "命中 {n} 项合规红线，逐条见下方「必须改」":
    "{n} compliance red-line checks triggered — see “Must fix” below",
  "本报告由规则引擎按公开平台规则与违禁词表逐项判定，同一份文案重复检测结论一致，可复核。检测范围限于文案本身，不含商品实物与资质文件真伪核验，不构成法律意见。":
    "This report is produced by a deterministic rules engine that checks copy against published marketplace policies and banned-word lists. Re-running the same copy yields identical results and can be audited. Scope is limited to the written copy; product samples and the authenticity of certificates are not verified. This is not legal advice.",

  // 宣称-证据对账（P0：代运营交甲方「资质对账表」）
  证据对账: "Evidence ledger",
  "店铺主体（选填）": "Store entity (optional)",
  "用于核对证书主体是不是你": "Used to check the certificate is in your name",
  证书台账: "Certificate ledger",
  用示例填一遍: "Fill with sample",
  添加一条证据: "Add evidence",
  编号: "Number",
  "有效期 YYYY-MM-DD": "Valid until YYYY-MM-DD",
  证书主体: "Certificate holder",
  适用范围: "Scope",
  删除这一条: "Remove this row",
  "对账中…": "Reconciling…",
  开始对账: "Run reconciliation",
  这些宣称都有证据支撑: "Every claim is backed by evidence",
  "有 {n} 条宣称缺证据支撑": "{n} claims lack supporting evidence",
  "共 {n} 条宣称": "{n} claims in total",
  "证据 {n} 份": "{n} documents",
  没有抽到需要资质的宣称: "No claims requiring qualification found",
  宣称: "Claim",
  类型: "Type",
  需要的证据: "Evidence needed",
  无需资质: "No certificate needed",
  已覆盖: "Covered",
  缺证据: "Missing",
  已过期: "Expired",
  编号格式不对: "Invalid number format",
  证书主体不符: "Holder mismatch",
  证书范围不覆盖: "Not in scope",
  需人工核验: "Needs manual check",
  "编号格式、有效期、主体一致是硬判断；范围覆盖是关键词比对，标「需人工核验」的请自己确认。":
    "Number format, validity and holder identity are hard checks; scope coverage is keyword matching — anything marked “needs manual check” should be confirmed by a human.",
  检测报告: "Test report",
  特殊化妆品注册证: "Special cosmetic registration",
  有机产品认证: "Organic certification",
  "3C 认证": "CCC certification",
  食品生产许可: "Food production licence",
  保健食品批号: "Health food approval",
  医疗器械注册证: "Medical device registration",
  品牌授权书: "Brand authorisation",
  历史批次: "Past batches",
  未命名批次: "Untitled batch",
  "{n} 条": "{n} rows",
  "一次交一份可验收的报告": "One run, one deliverable report",
  "共 {n} 条 · 成功 {ok} · 失败 {failed}": "{n} rows · {ok} done · {failed} failed",
  "平均分 {avg}": "Average {avg}",
  "被合规拦下 {n} 条": "{n} blocked by compliance",
  "潜在罚单敞口 ¥{amount}": "Potential penalty exposure ¥{amount}",
  "按公开处罚案例 2 万元/张估算": "Estimated from published ¥20,000 penalty cases",
  "导出 CSV": "Export CSV",
  "导出 JSON": "Export JSON",
  序号: "Row",
  商品标题: "Product title",
  等级: "Grade",
  能否上架: "Can list",
  问题数: "Issues",
  查看: "View",
  失败原因: "Failure reason",
  "请粘贴 CSV 或上传文件": "Paste CSV content or upload a file first",
  "只支持 .csv 文件": "Only .csv files are supported",
  文件读取失败: "Could not read the file",

  // ── 类目合规词库（2026-11-12）────────────────────────────────────────────
  "类目（决定用哪套合规词库）": "Category (selects the compliance word list)",
  自动识别: "Auto-detect",
  "食品 / 保健": "Food & supplements",
  "美妆 / 护肤": "Beauty & skincare",
  "母婴 / 玩具": "Baby & toys",
  "器械 / 消毒": "Devices & disinfectants",
  "自动识别为「{name}」类目": "Auto-detected category: {name}",
  "按「{name}」类目校验": "Checked against {name} rules",
  "默认类目（CSV 里没有「类目」列时用它）":
    "Default category (used when the CSV has no category column)",

  "「{word}」是食品功效宣称，普通食品不能这么说":
    "“{word}” is a health claim — ordinary food cannot say this",
  "普通食品只能讲配料、口感、吃法。要讲功效必须有保健食品批号并按批准范围写，否则删掉，换成「配料表只有 3 项」这类事实。":
    "Plain food may only describe ingredients, taste and how to eat it. Health claims require a registered health-food number and must match its approved wording. Otherwise delete the claim and state a verifiable fact, e.g. “only 3 ingredients”.",
  "「{word}」是需要资质背书的宣称": "“{word}” requires certification to back it up",
  "纯天然、零添加都需检测依据（零添加 2027 年起也禁止标注）。改成可核验的事实，例如「配料表：核桃仁、腰果」。":
    "“Pure natural” and “zero additives” need test evidence (from 2027 “zero additives” labelling is banned outright). Replace with verifiable facts, e.g. “Ingredients: walnuts, cashews”.",
  "「{word}」需认证证书支撑": "“{word}” needs a certificate number",
  "有机、绿色食品、无公害、非转基因都要有证书编号。有证就在页面标编号，没证别写，改成「产地直采」这类可核验的事实。":
    "Organic, green food, pollution-free and non-GMO all require a certificate number. If you have one, show it; if not, drop the word and state a verifiable fact such as “direct from the growing region”.",
  "「{word}」在化妆品上属禁用表述": "“{word}” is a prohibited claim on cosmetics",
  "化妆品不得出现药妆、医用、械字号、医生推荐等医疗暗示。改成成分与肤感描述：「敏感肌可用」→「含神经酰胺，质地清爽」。":
    "Cosmetics may not imply medical use — no “cosmeceutical”, “medical grade”, “device-registered” or “doctor-recommended”. Describe ingredients and texture instead: “sensitive-skin friendly” → “contains ceramides, light texture”.",
  "出现效果承诺「{word}」": "Efficacy promise found: “{word}”",
  "「白一个度」「一次见效」是对效果的绝对承诺，化妆品只能描述使用感受。改成「坚持使用后肤色更均匀」这类可自查的表述。":
    "“One shade lighter” or “results in one use” is an absolute promise about results; cosmetics may only describe the experience. Reframe it as something the buyer can check, e.g. “more even tone with continued use”.",
  "「{word}」属特殊化妆品功效，需注册证号":
    "“{word}” is a special-cosmetic claim and needs a registration number",
  "美白、祛斑、淡斑、祛黄要按特殊化妆品注册，页面须标「国妆特字」编号。有证就补编号，没证改成「提亮肤色、改善暗沉」。":
    "Whitening, spot removal, spot fading and anti-sallowness require special-cosmetic registration, and the page must show the registration number. Add the number if you have it; otherwise reframe as “brightens tone, reduces dullness”.",
  "「{word}」是需要功效评价备案的宣称":
    "“{word}” requires an efficacy assessment filing",
  "抗皱、祛痘、缩毛孔、防脱等 2021 年起须提交功效评价报告。没做评价就删掉，只写成分、质地、适用肤质。":
    "Anti-wrinkle, anti-acne, pore-minimising and anti-hair-loss claims have needed an efficacy report since 2021. Without one, stick to ingredients, texture and skin type.",
  "「{word}」在母婴 / 玩具类属违规宣称":
    "“{word}” is an illegal claim for baby and toy products",
  "玩具不能宣称益智、可食用、无毒无害；婴幼儿食品不能宣称提高智力。改成可验证参数：适用年龄、材质、3C 证书编号。":
    "Toys may not claim to boost intelligence, be edible or completely non-toxic; infant food may not claim to raise IQ. Replace with verifiable specs: age range, material, 3C certificate number.",
  "「{word}」是医疗器械才允许的表述":
    "“{word}” is reserved for registered medical devices",
  "非医疗器械不得讲治疗、康复、替代药物。删掉疗效表述，只写适用范围、测量精度、使用方法。":
    "Non-medical products may not claim treatment, recovery or replacing medication. Delete the therapeutic wording and describe scope, accuracy and usage only.",
  "「{word}」需要相应备案或许可": "“{word}” requires a filing or licence",
  "消毒、抑菌、灭菌要有卫生安全评价报告与消字号编号。普通清洁用品改成「清洁」「除污」，不要碰杀菌类的词。":
    "Disinfect, antibacterial and sterilise claims need a hygiene safety assessment and a hygiene licence number. Ordinary cleaners should say “cleans” or “removes stains” instead.",
  "通用（国内电商）": "General (China domestic)",
  "亚马逊 Amazon": "Amazon",
  "TikTok Shop": "TikTok Shop",
  "邮箱": "email address",
  "链接": "link",
  "电话": "phone number",
  "目标平台（决定跑哪套平台规则）": "Target marketplace (decides which platform rules apply)",
  "标题上限 {max} 字符 · 卖点最多 {n} 条": "Title max {max} characters · up to {n} bullets",
  "按「{name}」平台规则校验": "Checked against {name} listing rules",
  "目标平台（CSV 里没有「平台」列时用它）": "Default marketplace (used when the CSV has no “Platform” column)",
  "标题 {length} 字符，超出该平台上限 {max}": "Title is {length} characters, over this marketplace's {max} limit",
  "平台会截断或直接抑制搜索。把最不重要的修饰词删到卖点里，标题只留品名 + 核心规格。": "The marketplace truncates it or suppresses the search result. Move the least important modifiers into the bullets and keep only product name plus core specs.",
  "标题里有 {count} 个 emoji": "Title contains {count} emoji",
  "跨境平台不认 emoji：既进不了搜索，部分站点还判违规。删掉，换成能被搜到的实词。": "Marketplaces do not index emoji: they add no search value and some sites treat them as a violation. Remove them and use words buyers actually search.",
  "「{word}」写成了全大写": "“{word}” is written in ALL CAPS",
  "改成首字母大写（如 Stainless Steel）。亚马逊把全大写视为滥用关键词，会降权。": "Change it to title case (e.g. Stainless Steel). Amazon treats all caps as keyword abuse and lowers ranking.",
  "标题含平台禁用符号：{chars}": "Title contains symbols the marketplace prohibits: {chars}",
  "亚马逊不允许 ! $ ? _ ~ ^ { } | < > 这类符号。删掉，用空格分隔词组。": "Amazon does not allow characters such as ! $ ? _ ~ ^ { } | < >. Remove them and separate words with spaces.",
  "写了 {count} 条卖点，该平台只收 {max} 条": "{count} bullet points, but this marketplace only takes {max}",
  "把最弱的几条合并或删掉。五点描述只展示前 5 条，第 6 条开始买家看不到。": "Merge or drop the weakest ones. Only the first five bullets are displayed — buyers never see the sixth.",
  "第 {row} 条卖点 {length} 字符，超过 {max}": "Bullet {row} is {length} characters, over {max}",
  "长句拆成「短句 + 数字」。移动端只显示前两行，后半句等于没写。": "Split long sentences into a short claim plus a number. Mobile shows only the first two lines, so the rest is invisible.",
  "出现平台禁止的促销语言「{word}」": "Marketplace-prohibited promotional language: “{word}”",
  "listing 里不能写促销词，平台会抑制搜索。优惠放到 coupon 或活动里，别写进标题和卖点。": "Promotional wording is not allowed in a listing and will get the search result suppressed. Put the offer in a coupon or promotion instead.",
  "出现需授权的宣称「{word}」": "Claim that requires authorisation: “{word}”",
  "没拿到对应认证就不能写。删掉，或把证书编号写进详情页并走平台审核。": "You cannot make this claim without the matching certification. Remove it, or add the certificate number and submit it for marketplace review.",
  "详情里有{kind}，跨境平台禁止站外导流": "Description contains a {kind} — off-platform traffic is prohibited",
  "买家绕过平台成交会被判违规。删掉联系方式，用平台站内信沟通。": "Closing a sale off-platform violates marketplace policy. Remove the contact details and use in-platform messaging.",
  "改前改后": "Before / after",
  "对比中": "Comparing",
  "开始对比": "Compare",
  "两侧共用同一个类目与平台：口径不同的话，分差没有意义。": "Both sides use the same category and marketplace — a different rule set makes the gap meaningless.",
  "只改文案、不改产品，差值就是文案值多少分。": "Change only the copy, not the product: the gap is what the copy is worth.",
  "改前": "Before",
  "改后": "After",
  "提升 {n} 分": "+{n} points",
  "下降 {n} 分": "−{n} points",
  "分数没有变化": "No score change",
  "改前改后都能上架": "Listable both before and after",
  "改前改后都还上不了架": "Still not listable after the revision",
  "改前上不了架，现在可以上架": "Was blocked before, listable now",
  "改前能上架，现在不行了": "Was listable before, blocked now",
  "已解决": "Fixed",
  "仍存在": "Still there",
  "新增问题": "New issues",
  "无": "None",
  "还没有对比结果": "No comparison yet",
  "填好改前和改后，点「开始对比」——差多少分、哪几条被改掉了都会列出来。": "Fill in both versions and hit Compare — you get the score gap and exactly which issues were fixed.",
};

export type Locale = "zh-CN" | "en-US";

/** `{name}` 风格占位符插值：缺变量时保留原样，宁可露出占位符也不吞字符。 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (raw, key: string) =>
    key in vars ? String(vars[key]) : raw,
  );
}

/** 供非组件环境（工具函数、render-function、测试）直接调用。 */
export function translate(zh: string): string {
  if (currentPrefs().locale !== "en-US") return zh;
  return EN[zh] ?? zh;
}

/** 带参数的翻译（非组件环境用）：`translateN("共 {n} 条", { n: 5 })`。 */
export function translateN(zh: string, vars?: Record<string, string | number>): string {
  return interpolate(translate(zh), vars);
}

/** 组件用：订阅偏好变化，切语言立刻重渲染（不需要刷新页面）。 */
export function useI18n(): {
  t: (zh: string) => string;
  tn: (zh: string, vars?: Record<string, string | number>) => string;
  isEn: boolean;
} {
  const [locale, setLocale] = useState<Locale>(currentPrefs().locale);
  useEffect(() => subscribePrefs((prefs) => setLocale(prefs.locale)), []);
  const en = locale === "en-US";
  return {
    t: (zh: string) => (en ? EN[zh] ?? zh : zh),
    tn: (zh: string, vars?: Record<string, string | number>) =>
      interpolate(en ? EN[zh] ?? zh : zh, vars),
    isEn: en,
  };
}

/**
 * 岗位 → 部门 + 职责（2026-11-10）。
 *
 * 为什么不在界面上渲染 `agent.soul`：soul 是**系统提示词**（含输出协议、汇报线、
 * 纪律约束），此前被当成「一句话介绍」直接截断显示，结果是切英文后仍是一屏中文，
 * 而且把内部提示词漏给了用户。这里改成结构化摘要，中英各一份，随语言切换。
 *
 * 未命中（用户自建 Agent）→ 「自定义 Agent」：宁可显示中性词，也不把中文提示词
 * 硬塞进英文界面。
 */
const AGENT_ROLES: Record<string, { dept: string; duty: string }> = {
  市场分析师: { dept: "市场研究部", duty: "目标用户、市场、竞品和需求分析" },
  品牌策划师: { dept: "品牌策划部", duty: "品牌定位、产品卖点、品牌故事" },
  内容策划师: { dept: "内容创作部", duty: "商品详情页、图文、短视频脚本" },
  合规审核员: { dept: "风控审核部", duty: "内容合规、授权、品牌伦理和质量检查" },
  运营专员: { dept: "电商运营部", duty: "商品资料、上架准备、店铺运营支持" },
  商务专员: { dept: "商务拓展部", duty: "企业采购材料、潜在客户筛选跟进" },
  总经理: { dept: "管理层", duty: "统筹调度与决策" },
  "AI 总经理 CEO": { dept: "管理层", duty: "统筹调度与决策" },
};

/** Agent 副标题：`部门 · 职责`，按当前语言渲染（`t` 由调用方注入，便于 render-function 用）。 */
export function agentSubtitle(name: string | undefined, t: (zh: string) => string): string {
  const role = AGENT_ROLES[(name ?? "").trim()];
  if (!role) return t("自定义 Agent");
  return `${t(role.dept)} · ${t(role.duty)}`;
}

export const EN_DICTIONARY = EN;
