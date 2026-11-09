# Agent Plugin Contract

本文件定义 ShadowFlow 的 **Agent 插件契约**：任何新 Agent 后端（api / cli / mcp / acp）接入本平台时，必须满足的接口、事件、YAML 声明与三通道行为约定。本文档与 `shadowflow/runtime/executors.py`、`shadowflow/runtime/events.py`、`shadowflow/runtime/contracts.py` 保持代码级对齐。

## 1. 概述

ShadowFlow 的 Agent 层是「执行器插件化」的：平台只依赖一个抽象基类 `AgentExecutor`，具体执行后端（HTTP API、本地 CLI、MCP Server、ACP 会话）各自实现该基类并通过 YAML 声明 `kind`。

一个 Agent 插件由三部分组成：

1. **执行器实现** —— 继承 `AgentExecutor` 的 Python 类，负责真正跑推理。
2. **YAML 声明** —— `agents/*.yaml`，声明 agent 的 role / skills / tools / executor.provider。
3. **事件流** —— 执行过程中按命名空间发 `AgentEvent`，供前端时间线消费。

三条不可破坏的原则：

- **单向依赖**：插件只依赖 `shadowflow.runtime.contracts` 的 Pydantic 模型，不反向依赖编排层。
- **事件先行**：任何有副作用的动作，必须先发 `agent.tool_called`，结果再发 `agent.tool_result`。
- **失败可解释**：所有失败必须以 `agent.failed` 或 `agent.rejected` 收尾，不允许静默吞掉。

## 2. AgentExecutor ABC

### 2.1 接口定义

执行器必须实现以下三个抽象方法：

```python
from abc import ABC, abstractmethod
from typing import AsyncIterator

# 关键：Pydantic 模型一律从 contracts 模块导入，不要从 executors 导入
from shadowflow.runtime.contracts import (
    AgentTask,
    AgentHandle,
    AgentCapabilities,
    AgentEvent,
)


class AgentExecutor(ABC):
    @abstractmethod
    async def dispatch(self, task: AgentTask) -> AgentHandle:
        """提交一个任务，返回可追踪的句柄。"""

    @abstractmethod
    def stream_events(self, handle: AgentHandle) -> AsyncIterator[AgentEvent]:
        """按时间顺序流式产出事件。"""

    @abstractmethod
    def capabilities(self) -> AgentCapabilities:
        """声明该执行器支持的 kind、模型、工具与限制。"""
```

| 方法 | 契约 |
|---|---|
| `dispatch` | 必须幂等可重试；返回 `AgentHandle`，其中 `run_id` 全局唯一 |
| `stream_events` | 必须最终产出 `agent.completed` / `agent.failed` / `agent.rejected` 之一后结束 |
| `capabilities` | 不得返回动态变化的值（同进程生命周期内稳定） |

### 2.2 注册

执行器通过 `kind` 注册进注册表，编排层按 YAML 里的 `executor.kind` + `executor.provider` 选取实现。

## 3. 四种 Kind

平台支持四种执行器 `kind`，语义互斥、可并存：

| kind | 说明 | 典型 provider | 事件来源 |
|---|---|---|---|
| `api` | 直连模型厂商 HTTP API | `openai` / `anthropic` / `deepseek` | SSE / JSON 流解析 |
| `cli` | 调用本地命令行 Agent | `claude` / `codex` / `gemini` | stdout 行解析 |
| `mcp` | 通过 MCP Server 调用工具增强 Agent | 任意 MCP server | MCP notification → 事件映射 |
| `acp` | Agent Client Protocol 会话 | `acp` | ACP session update → 事件映射 |

选型建议：**优先 `cli`（本机已有）→ `api`（BYOK）→ `mcp`（需要工具时）→ `acp`（需要跨进程会话时）**。

## 4. 三通道契约

Agent 与平台之间有三条通道，职责不得混用：

1. **控制通道（Control）** —— `dispatch` 提交任务、取消任务。只走请求/响应，不承载流式数据。
2. **事件通道（Event）** —— `stream_events` 产出 `AgentEvent`。只单向流出，不允许外部回写。
3. **数据通道（Data）** —— 工具调用入参与返回值。必须经 `agent.tool_called` / `agent.tool_result` 成对出现。

约束：

- 控制通道的失败不得用事件通道「假装成功」。
- 事件通道必须保序：同一 `run_id` 内事件序号单调递增。
- 数据通道的产物必须可序列化（JSON-safe），二进制走引用而非内联。

## 5. YAML 样板

一个完整的 agent 声明示例：

```yaml
agent_id: docs_reviewer
version: "0.1"
name: Docs Reviewer Agent
role: reviewer
skills:
  - docs_review
tools:
  - filesystem
prompt_template: "Review the docs for goal: {{ goal }}"
executor:
  kind: cli
  provider: claude
```

其中 `prompt_template` 支持 `{{ parameter }}` 占位符，由编排层在编译期渲染。

新 provider preset 若走 `cli`，需在 provider 预设表里补齐以下四个字段：

| 字段 | 含义 |
|---|---|
| `command` | 可执行文件名或绝对路径 |
| `args_template` | 参数模板，支持 `{{ prompt }}` 等占位符 |
| `parse_format` | stdout 解析格式：`jsonl` / `text` / `claude_stream_json` |
| `stdin_format` | 输入方式：`prompt_arg` / `stdin_text` / `stdin_json` |

示例：

```yaml
presets:
  my-cli-agent:
    command: my-agent
    args_template: ["--print", "{{ prompt }}"]
    parse_format: text
    stdin_format: prompt_arg
```

## 6. AgentEvent 命名空间

### 6.1 核心事件（7 个）

| 事件 | 时机 |
|---|---|
| `agent.dispatched` | 任务已受理，开始执行 |
| `agent.thinking` | 模型思考 / 中间推理文本 |
| `agent.tool_called` | 调工具前的意图与入参 |
| `agent.tool_result` | 工具返回结果 |
| `agent.completed` | 正常结束，带最终产物 |
| `agent.failed` | 异常结束，带错误分类与信息 |
| `agent.rejected` | 策略拒绝 / 用户取消 |

这 7 个常量构成 `AgentEventType` 的核心集，并与其他 3 个扩展类型共同组成规范集 `AgentEventType.ALL`（frozenset，共 10 个）。

### 6.2 事件字段

`AgentEvent` 为 Pydantic 模型，必含 `run_id`、`type`、`payload`，并序列化一个 `ts` 时间戳字段（毫秒级 Unix 时间）。

### 6.3 SSE Wire Format

前端消费的 SSE 帧格式：

```
event: agent_event
data: {"run_id": "...", "type": "agent.thinking", "payload": {...}, "ts": 1731000000123}
```

注意 `ts` 必须是数值型毫秒时间戳，消费端据此做时间线排序与去重。

## 7. 新 provider preset

新增 provider 的标准流程：

1. 实现 `AgentExecutor` 子类（见 §2.1），只从 `shadowflow.runtime.contracts` 导入模型。
2. 在 provider 预设表登记 `command` / `args_template` / `parse_format` / `stdin_format`（见 §5）。
3. 在 `agents/*.yaml` 中以 `executor: {kind: ..., provider: ...}` 引用。
4. 补一组契约测试：正常完成、工具调用、失败、拒绝四条路径。
5. 更新本文档 §3 的 kind 表格（若引入新 kind）。

## 8. 健康检查与降级

- **健康检查**：启动时对每个已注册 provider 跑一次 `capabilities()`，失败者标记为 degraded，不阻塞启动。
- **降级顺序**：`cli` → `api` → 报错引导用户配置 BYOK。降级必须发 `agent.failed`，`payload.reason` 写明 `cli_missing` / `auth_error` / `provider_refusal` 等分类。
- **熔断**：同一 provider 连续 N 次失败进入冷却期，期间直接返回降级结果，不再试探。

## 9. 参考

- [`HERMES_INTEGRATION_SPIKE.md`](./HERMES_INTEGRATION_SPIKE.md) —— Hermes 协议接入验证
- [`HERMES_CLAW_SPIKE.md`](./HERMES_CLAW_SPIKE.md) —— Claw 风格原生 Agent 验证
- [`SHADOWSOUL_RUNTIME_SPIKE.md`](./SHADOWSOUL_RUNTIME_SPIKE.md) —— ShadowSoul 运行时验证
- 代码：`shadowflow/runtime/executors.py`、`shadowflow/runtime/events.py`、`shadowflow/runtime/contracts.py`
- 架构总览：`docs/新架构蓝图-v2.md`
