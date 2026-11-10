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
