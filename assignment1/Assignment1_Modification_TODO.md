# Assignment 1：Claude Agent SDK Web UI 完整改造 TODO

> 适用基线：已能在 Windows 本地运行 Claude Agent SDK，并已使用第三方 Anthropic 兼容 API 完成正常对话。
>
> 本文件同时承担：实施计划、任务清单、验收标准、运行审查记录、修改摘要、结果摘要和运行指南。根据 2026-09-02 的收尾需要，唯一允许的额外文档是临时清单 [`Assignment1_Remaining_TODO.md`](./Assignment1_Remaining_TODO.md)；清单归零后删除该临时文件，不再创建其他进度、总结或测试报告 Markdown。

## 0.1 当前状态（2026-09-02 核对）

- 已完成：核心对话、真实 Read 调用、事件标准化、JSONL、Allow/Deny/Stop、SDK Resume、Trace API、Token 账本、Context CSV、现有 12 项测试及 production build。
- 已完成本轮收尾：恢复工作目录安全复验、运行/审批边界测试、工具输出截断与退出字段、Trace 关联信息、lint/format、Vite 8 升级和零漏洞审计。
- 仍受环境阻塞：内置浏览器安全策略拒绝访问 `localhost:3001`，因此浏览器控制台、刷新/重连、窄屏和真实点击流程尚无浏览器证据。
- 待填写内容：没有空白记录字段；原先标注“完成后填写”的 A–D 阶段记录、修改摘要、结果摘要和运行指南均已回填，相关标题已改为当前状态说明。
- 收尾入口：剩余任务、优先级、依赖和完成条件统一维护在临时清单中；本文件继续作为最终事实记录。

## 0. 最终目标

在现有 Claude Agent SDK Web UI 上完成一个可观测、可控制、可恢复的真实智能体会话系统，使浏览器能够：

- 驱动 Claude Agent SDK 在指定工作目录中读取文件、修改文件并运行命令；
- 实时展示模型消息、`tool_use`、`tool_result`、错误及任务最终状态；
- 支持 Stop、工具审批和同一会话恢复；
- 将完整可观测轨迹保存为 JSONL；
- 提供 Trace Viewer、Token 账本和上下文分类 CSV 导出；
- 完成一次真实文件读取调用展示；
- 每个阶段完成后主动运行、审查、提交并推送；
- 最终在本文件内填写修改摘要、结果摘要和运行指南。

## 1. 范围与约束

### 1.1 已完成前提

- [x] Windows 本地可以运行 Node.js/npm。
- [x] Claude Agent SDK 已成功安装并运行。
- [x] 第三方 Anthropic 兼容 API 已完成对话验证。
- [x] API Key 只由后端环境变量或本机配置读取，不进入前端。

### 1.2 实施约束

- [x] 不把 API Key、认证 Token、完整请求头写入源码、JSONL、截图或 Git 历史。
- [x] 后端日志中的敏感字段统一脱敏；至少覆盖 `authorization`、`x-api-key`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`。
- [x] 工作目录必须被限制在允许的根目录内，拒绝路径穿越和任意绝对路径访问。
- [x] 不启用无条件绕过权限的模式作为默认配置。
- [x] 不记录或声称导出隐藏思维链；仅记录可观测消息、工具调用、工具结果、错误、用量和系统元数据。
- [x] 不为了“看起来完成”而吞掉错误、伪造 Token 数、伪造测试通过或伪造 push 成功。
- [x] 所有最终计划、审查、摘要和指南都回填到本文件；除明确允许的临时收尾清单外，不创建 `progress.md`、`summary.md`、`test-report.md` 等中间文档。

## 2. 建议最小架构

```mermaid
flowchart TD
    A["React Web UI"] <-->|"WebSocket：消息、工具事件、审批"| B["Express Gateway"]
    A -->|"REST：会话、轨迹、导出"| B
    B --> C["Session Manager"]
    C --> D["Claude Agent SDK"]
    D <-->|"Read / Edit / Bash"| E["受限工作目录"]
    C --> F["Event Normalizer + JSONL Logger"]
    F --> G["Trace Viewer + Token/Context Export"]
```

### 2.1 模块职责

| 模块 | 职责 |
|---|---|
| Web UI | 对话、工具卡片、Stop、审批弹窗、会话恢复、Trace Viewer |
| Express Gateway | REST/WebSocket 接口、输入验证、错误响应、静态资源 |
| Session Manager | `chatId`、SDK `sessionId`、工作目录、运行状态和订阅者管理 |
| Agent Adapter | 调用 SDK、接收输入、消费 SDK 事件、Stop/Resume |
| Event Normalizer | 将 SDK 原始消息转换为稳定的应用事件模型 |
| Trajectory Logger | 按事件追加 JSONL，保证顺序、时间戳、脱敏和落盘 |
| Trace Analyzer | Token 汇总、上下文分类、CSV/JSONL 导出 |

## 3. 统一事件与数据规范

### 3.1 统一事件类型

实现前先根据当前安装的 SDK 类型定义核对真实字段；不要仅凭示例猜测字段名称。

```ts
type AgentEvent =
  | { type: "user_message"; eventId: string; sequence: number; timestamp: string; chatId: string; content: string }
  | { type: "assistant_message"; eventId: string; sequence: number; timestamp: string; chatId: string; content: string }
  | { type: "tool_start"; eventId: string; sequence: number; timestamp: string; chatId: string; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; eventId: string; sequence: number; timestamp: string; chatId: string; toolUseId: string; output: unknown; isError: false; durationMs?: number }
  | { type: "tool_error"; eventId: string; sequence: number; timestamp: string; chatId: string; toolUseId?: string; toolName?: string; error: NormalizedError; durationMs?: number }
  | { type: "permission_request"; eventId: string; sequence: number; timestamp: string; chatId: string; requestId: string; toolName: string; input: unknown }
  | { type: "permission_result"; eventId: string; sequence: number; timestamp: string; chatId: string; requestId: string; decision: "allow" | "deny"; reason?: string }
  | { type: "run_result"; eventId: string; sequence: number; timestamp: string; chatId: string; status: "success" | "error" | "stopped"; durationMs?: number; usage?: TokenUsage; costUsd?: number }
  | { type: "system"; eventId: string; sequence: number; timestamp: string; chatId: string; level: "info" | "warning" | "error"; message: string };
```

### 3.2 JSONL 最低字段

每行必须是一个独立且有效的 JSON 对象：

```json
{"schemaVersion":1,"runId":"run-...","chatId":"chat-...","sdkSessionId":"...","sequence":12,"timestamp":"2026-09-01T12:00:00.000Z","eventType":"tool_result","toolName":"Read","toolUseId":"tool-123","output":{"summary":"..."},"isError":false,"durationMs":18}
```

必须包含：

- `schemaVersion`；
- `runId`、`chatId`、可获得时记录 `sdkSessionId`；
- 单调递增的 `sequence`；
- UTC ISO 8601 `timestamp`；
- `eventType`；
- 事件有效载荷；
- 工具调用关联字段 `toolUseId`；
- 错误状态、耗时和可获得的 usage；
- 脱敏后的内容。

### 3.3 错误格式

```ts
interface NormalizedError {
  code?: string;
  name?: string;
  message: string;
  stack?: string;
  source: "sdk" | "tool" | "websocket" | "http" | "storage" | "validation";
  retryable?: boolean;
}
```

前端显示简洁错误，Trace Viewer 可展开详细错误；敏感信息在进入两者之前完成脱敏。

---

# 阶段 A：增加 tool_result、错误、时间戳和 JSONL 轨迹

## A1. 先检查现有实现

- [x] 检查项目结构、`package.json`、TypeScript 配置和现有测试命令。
- [x] 找到 Agent SDK `query()` 或 Session API 的调用位置。
- [x] 找到 SDK 消息转换和 WebSocket 广播位置。
- [x] 找到当前 `tool_use` 的渲染逻辑。
- [x] 检查当前 SDK 版本的真实消息类型，确认 `assistant`、`user/tool_result`、`result` 和流式事件结构。
- [x] 在本阶段记录区填写检查结果，不创建额外分析文档。

## A2. 实现事件标准化

- [x] 新增或重构统一的事件标准化函数，SDK 原始事件不得直接散落到多个前端组件中解析。
- [x] 将文本消息转换为 `assistant_message`。
- [x] 将工具调用转换为 `tool_start`，保存 `toolUseId`、工具名和输入。
- [x] 将工具返回转换为 `tool_result`；使用同一个 `toolUseId` 与 `tool_start` 配对。
- [x] 将失败的工具返回转换为 `tool_error` 并保留错误信息。
- [x] SDK 提供退出码时，将退出码写入标准事件并保留到 JSONL。
- [x] 将 SDK 顶层异常、WebSocket 错误和存储错误转换为标准错误事件。
- [x] 为每个事件增加 `eventId`、`sequence` 和 UTC `timestamp`。
- [x] 同一 `chatId` 内的 `sequence` 必须严格递增，不因多个订阅者而重复递增。
- [x] 不将同一个工具结果重复记为 `tool_result` 和普通用户消息。

## A3. 实现 JSONL 轨迹记录

- [x] 建立单一 Trajectory Logger；路径建议为 `traces/<chatId>/<runId>.jsonl`。
- [x] 使用追加写入，避免每次事件重写整个文件。
- [x] 在事件广播给前端之前或同一控制点完成持久化，明确并记录顺序策略。
- [x] 对并发写入进行串行化，避免 JSON 行交错。
- [x] 程序异常退出后，已完成事件仍应保留。
- [x] 日志写入失败时生成 `storage` 错误，但避免递归地再次写入同一个失败 Logger。
- [x] 加入递归脱敏函数，覆盖对象、数组和字符串中的常见凭证字段。
- [x] 增加轨迹查询/下载接口，例如 `GET /api/chats/:chatId/traces` 和 `GET /api/traces/:runId/raw`。

## A4. 前端工具结果与错误展示

- [x] 工具卡片至少显示：工具名、状态、开始时间、耗时、输入、输出摘要。
- [x] `Bash` 结果显示退出码，并分别展示 stdout/stderr（如果 SDK 提供）。
- [x] `Read` 结果显示文件路径和可折叠内容，避免默认展开超长文件。
- [x] 错误卡片显示来源、错误信息和是否可重试。
- [x] 工具运行状态按 `toolUseId` 更新同一卡片，不为结果额外创建无法关联的新卡片。
- [x] 超长输出在 UI 中折叠，但 JSONL 保留经过合理上限控制的原始可观测输出；若截断必须记录 `truncated: true` 和原始长度。

## A5. 自动测试

- [x] 单元测试：相同 `toolUseId` 的 start/result 能正确配对。
- [x] 单元测试：工具错误能转换为 `tool_error`。
- [x] 单元测试：sequence 单调递增。
- [x] 单元测试：每条 JSONL 都能独立 `JSON.parse()`。
- [x] 单元测试：API Key、Authorization Header 被脱敏。
- [x] 集成测试：模拟 SDK 事件后，WebSocket 客户端收到正确顺序的事件。
- [x] 运行类型检查、单元测试和生产构建。

## A6. 主动运行审查

- [x] 启动后端和前端，确认没有未处理异常。
- [x] 创建一个真实会话，发送简单任务，观察 assistant/tool/result 时间线。
- [x] 检查后端控制台，确认真实运行没有未处理异常。
- [ ] 检查浏览器控制台和网络面板。
- [x] 检查生成的 JSONL 行数、顺序、时间戳、事件配对和脱敏情况。
- [x] 故意触发一次安全的文件不存在错误，确认错误可见且不会导致服务崩溃。
- [x] 将实际命令和结果填写到“A 阶段记录”。

## A7. Git 提交与 Push

- [x] `git status --short`，确认没有密钥、`.env`、真实轨迹或无关文件进入提交。
- [x] `git diff --check`。
- [x] 重新运行本阶段必需的 typecheck/test/build。
- [x] 仅暂存本阶段相关代码和本 TODO 的记录更新。
- [x] 建议提交信息：`feat(trace): persist tool results errors and jsonl events`。
- [x] 执行 `git push origin HEAD`。
- [x] 记录 commit SHA、push 结果；push 失败必须记录真实原因，不得标记完成。

### A 阶段记录（已回填）

- 修改摘要：`新增统一 AgentEvent、SDK Event Normalizer、递归脱敏、串行 JSONL Logger、轨迹 REST 下载接口，以及前端可配对的工具运行/结果/错误卡片。修复 traces 写入触发 tsx watch 重启后端的问题。`
- 关键文件：`server/events.ts、server/event-normalizer.ts、server/trajectory.ts、server/redaction.ts、server/session.ts、client/App.tsx、client/components/ChatWindow.tsx`
- 测试命令：`npm run typecheck；npm test（5/5）；npm run build -- --emptyOutDir；真实 REST/WebSocket/Agent SDK smoke test`
- 运行审查：`Chat 404073e8-83eb-4717-b9d4-5fb04e8a6c62；Read 成功 run-01febd03-dd14-4ab6-acc8-b0a209a305fc（sequence 1-6）；不存在文件 run-1ea36a9b-a630-4663-9f42-30b8aab0b310（sequence 7-12）；toolUseId 均正确配对；两份 JSONL 逐行可解析且密钥扫描通过。`
- 已知限制：`执行 A 阶段时没有可用的内置浏览器，无法执行浏览器控制台和截图审查；已用 production build 及网页同协议的 REST/WebSocket 真实链路验证。B/C 功能后来已实现，其剩余验收项见当前未勾选项。`
- Commit SHA：`e7bb9b2075af23b9c21ffbfe89ae627890ae8d69`
- Push 结果：`首次三次尝试因 GitHub HTTPS schannel TLS 握手失败；阶段 B push 时已成功推送至 origin/main。`

---

# 阶段 B：增加工作目录、Stop、工具审批和会话恢复

## B1. 工作目录

- [x] 配置服务端允许的工作区根目录，例如通过 `AGENT_WORKSPACE_ROOT` 指定。
- [x] 创建会话时允许选择根目录内的相对项目路径。
- [x] 使用 `path.resolve()` 后验证目标仍位于允许根目录内。
- [x] 拒绝 `..` 穿越、UNC 路径、盘符跳转和符号链接逃逸；Windows 路径比较需处理大小写和分隔符。
- [x] 验证目标存在且为目录。
- [x] 将最终规范化 `cwd` 保存到会话元数据中。
- [x] 创建 Agent SDK 会话时传入 `cwd`，不要只在界面上显示工作目录。
- [x] 页面显示当前工作目录和会话状态。
- [x] 页面明确显示当前会话是只读还是可写。

## B2. Stop

- [x] 检查当前 SDK 版本支持的中断方式，优先使用公开的 AbortController/interrupt API。
- [x] 为每次运行维护独立的 abort/interrupt 句柄。
- [x] 新增 `stop` WebSocket 事件或 REST 接口，例如 `POST /api/chats/:chatId/stop`。
- [x] Stop 后把运行状态设置为 `stopped`，记录操作者、时间和最终事件。
- [x] 重复 Stop 必须幂等，不得抛出未处理异常。
- [x] Stop 后保留已有轨迹，允许用户发送新消息继续同一会话或显式恢复。
- [x] 前端仅在 `running`/`waiting_permission` 状态显示可用 Stop 按钮。

## B3. 工具审批

- [x] 使用 SDK 当前版本公开的 `canUseTool`/权限回调，不通过修改 SDK 内部代码实现。
- [x] 默认策略建议：只读工具自动允许；写文件、执行命令及高风险工具必须询问。
- [x] 后端生成唯一 `requestId`，广播 `permission_request`。
- [x] 前端弹窗显示工具名、输入摘要、完整可折叠输入、Allow/Deny。
- [x] 前端通过 WebSocket 或 REST 返回 `permission_result`。
- [x] 后端用 `requestId` 解析对应 Promise，不能把一个审批结果发给另一个工具调用。
- [x] 审批必须有超时；超时默认拒绝并记录原因。
- [x] 客户端断开时，待处理审批必须拒绝或进入明确的安全等待状态。
- [x] 对“本会话始终允许”建立会话级白名单；默认不跨会话持久化。
- [x] Allow、Deny、Timeout 都写入 JSONL。

## B4. 会话恢复

- [x] 明确区分应用 `chatId` 与 Claude SDK `sessionId`。
- [x] 首次获得 SDK `sessionId` 后写入会话元数据和轨迹。
- [x] 重启后读取会话索引及 transcript/SDK session 映射。
- [x] 使用当前 SDK 官方 Resume/Session API 恢复对话，不通过把网页聊天文本简单拼接成新提示冒充恢复。
- [x] 恢复前验证原工作目录仍存在，并显示当前文件系统不是历史快照。
- [x] 恢复失败时保留原记录并给出明确错误，不自动创建一个看似相同的新会话。
- [x] 页面显示 `new`、`running`、`waiting_permission`、`stopped`、`completed`、`error`、`resumable` 等状态。

## B5. 自动测试

- [x] 工作目录正常路径测试。
- [x] `../`、绝对路径、其他盘符和 UNC 逃逸测试。
- [x] 符号链接逃逸测试。
- [x] Stop 正常中断、重复 Stop 和已完成后 Stop 测试。
- [x] 工具 Allow、Deny、Timeout、客户端断开测试。
- [x] 两个并发审批不会串线。
- [x] 服务重启后恢复同一 SDK session 的集成测试。
- [x] 工作目录丢失时恢复失败的测试。
- [x] 运行 typecheck、test、build。

## B6. 主动运行审查

- [x] 在允许工作目录中运行真实只读任务。
- [x] 触发一次需要批准的工具调用，分别验证 Allow 和 Deny。
- [x] 启动一个持续时间足够长的安全任务，点击 Stop，确认停止事件写入轨迹。
- [x] 重启后端，恢复已有会话并追问一个依赖上一轮上下文的问题。
- [x] 确认恢复后工作目录正确，历史消息和新事件没有重复。
- [ ] 检查断开重连和审批弹窗状态。
- [x] 将实际结果填写到“B 阶段记录”。

## B7. Git 提交与 Push

- [x] 检查 Git 状态、敏感数据和无关文件。
- [x] 运行 `git diff --check` 和完整验证命令。
- [x] 建议提交信息：`feat(session): add workspace stop approvals and resume`。
- [x] 执行 `git push origin HEAD`。
- [x] 记录 commit SHA 和远端结果。

### B 阶段记录（已回填）

- 修改摘要：`新增持久化 ChatStore、工作区解析器、会话状态、SDK session 映射与 Resume；接入 canUseTool 审批、超时默认拒绝、断线拒绝、会话级 always allow；Stop 调用 Query.interrupt() 并记录 stopped run_result。`
- 安全边界：`AGENT_WORKSPACE_ROOT 内相对路径；path.resolve + realpath 双重验证；拒绝 ../、绝对路径、其他盘符、UNC 与符号链接逃逸；真实 API 对 ../ 和 C:\\Windows 均返回 HTTP 400。`
- 测试命令：`npm run typecheck；npm test（8/8）；npm run build -- --emptyOutDir；真实 REST/WebSocket/SDK 控制与恢复脚本。`
- Allow/Deny/Stop/Resume 审查：`Chat 8d1edc60-e43b-463b-b001-21323ca93687；Deny request 73b02adb-2e7d-4805-8888-b7cd7860aa47（seq 4-6）；Allow request 546e3d89-fdb1-4b7c-af06-c43c641b4e95（seq 12-14）；Stop run-14114318-2163-4fa3-b7c2-4930bd83f436（seq 22）；重启后使用 SDK session f805fd35-ec16-4984-b435-06830b71fcdb 恢复并正确回答 ALLOW_MARKER。`
- 已知限制：`未在真实运行中等待 60 秒验证 timeout，但实现为默认拒绝；客户端断开同样默认拒绝。当前环境无可用内置浏览器，UI 仅通过类型检查和生产构建验证。`
- Commit SHA：`5ec3852c3b92d3c346e50cc7e37823d811cb731f`
- Push 结果：`成功推送至 origin/main，同时补推阶段 A。`

---

# 阶段 C：增加 Trace Viewer、Token 账本和上下文分类导出

## C1. Trace Viewer

- [x] 增加独立 Trace 视图或对话页签，不必追求复杂视觉效果。
- [x] 按 `sequence` 显示事件时间线。
- [x] 支持按事件类型过滤：user、assistant、tool、permission、error、result、system。
- [x] 支持按工具名、错误状态和 runId 过滤。
- [x] 每个事件显示时间戳、sequence，并可在展开内容中查看事件和运行关联字段。
- [x] 在事件摘要中显示相对耗时和关键关联 ID。
- [x] `tool_start` 与 `tool_result/tool_error` 在视觉上明确配对。
- [x] 支持折叠长输入/输出，显示是否截断。
- [x] 支持下载原始 JSONL；下载内容必须与持久化记录一致。
- [x] Trace Viewer 不显示未脱敏凭证。

## C2. Token 账本

- [x] 从 SDK `result` 或 usage 字段提取可获得的输入、输出、缓存读写和总 Token。
- [x] 保存模型名称、SDK 报告的 duration 和可获得成本。
- [x] 保存 run 开始时间、结束时间并计算墙钟耗时。
- [x] 以 run/turn 为粒度汇总，禁止对未知字段填 0 后假装精确。
- [x] SDK 未提供精确分项时标记为 `unavailable` 或 `estimated`。
- [x] 如果进行估算，保存估算方法和 tokenizer/字符近似规则。
- [x] Trace Viewer 显示 input、output、total、cost、duration 和 measurement type。
- [x] Trace Viewer 显示 cache read/write Token。
- [x] 防止恢复会话后重复累计同一个 `result`。

建议数据结构：

```ts
interface TokenLedgerEntry {
  runId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
  measurement: "reported" | "estimated" | "unavailable";
}
```

## C3. 上下文分类

对实际进入或持续占用上下文的可观测内容进行分类，不将 UI 状态误认为模型上下文。

最低分类：

| `contextCategory` | 内容示例 |
|---|---|
| `system_harness` | 系统提示、权限模式、工作目录信息 |
| `tool_definition` | 工具名称与 schema；若 SDK 不暴露则标记 unavailable |
| `project_instruction` | `CLAUDE.md`、项目规则 |
| `user_message` | 用户初始任务和后续纠正 |
| `assistant_message` | 可观测模型输出 |
| `file_content` | Read 返回的文件内容 |
| `search_listing` | Glob、Grep、目录和搜索结果 |
| `command_output` | Bash stdout/stderr、退出码 |
| `tool_error` | 工具错误、异常和失败状态 |
| `edit_result` | Write/Edit 的修改确认或 diff |
| `permission_context` | 工具审批请求与决定 |
| `compaction_summary` | SDK 可观测的压缩摘要（如果存在） |
| `other` | 无法可靠归类的可观测上下文 |

同时增加效用标签：

- `necessary`：直接影响后续决策；
- `supporting`：有帮助但可压缩；
- `redundant`：重复读取或重复输出；
- `stale`：已被新文件或新结果替代；
- `harmful`：截断、错误或误导性内容。

- [x] 实现确定性优先的分类规则，保存规则版本。
- [x] 每条可分类事件在导出时确定性计算 category、utility、字节数和估算 Token（采用导出时计算策略，不重复持久化派生字段）。
- [x] 不可观察内容必须标记 unavailable，不作臆测。
- [x] 增加 CSV 导出接口，例如 `GET /api/traces/:runId/context.csv`。
- [x] CSV 至少包含：sequence、timestamp、eventType、contextCategory、utility、source、bytes、estimatedTokens、toolName、truncated。
- [x] 正确转义逗号、引号、换行和 Unicode。
- [x] 页面显示按类别的 Token/字节统计表；图表为可选，不影响最低验收。

## C4. 自动测试

- [x] Trace 过滤与排序测试。
- [x] JSONL 下载与落盘内容一致性测试。
- [x] Token 汇总不重复累计测试。
- [x] `reported/estimated/unavailable` 标记测试。
- [x] 典型 Read/Bash/Edit 事件的上下文分类测试。
- [x] CSV 引号、逗号、中文和多行内容转义测试。
- [x] 敏感值不会出现在 Trace Viewer 和导出文件的测试。
- [x] 运行 typecheck、test、build。

## C5. 主动运行审查

- [x] 使用真实会话生成包含 assistant、Read、result 的轨迹。
- [ ] 打开 Trace Viewer，检查顺序、配对、过滤和长文本折叠。
- [x] 对照原始 SDK `result` 检查 Token 数和成本，确认未重复累计。
- [x] 下载 JSONL 并逐行解析。
- [x] 下载 context CSV，用 Excel 或文本方式检查中文、逗号和换行。
- [x] 检查分类合计与事件总数/估算 Token 逻辑一致。
- [x] 将实际结果填写到“C 阶段记录”。

## C6. Git 提交与 Push

- [x] 检查 Git 状态、敏感信息和不应提交的真实轨迹。
- [x] 运行 `git diff --check` 和完整验证。
- [x] 建议提交信息：`feat(analysis): add trace viewer token ledger and context export`。
- [x] 执行 `git push origin HEAD`。
- [x] 记录 commit SHA 和远端结果。

### C 阶段记录（已回填）

- 修改摘要：`新增 Trace Viewer 页签、事件类型/工具/错误过滤、JSONL/CSV 下载、Token 账本、上下文类别统计，以及规则版本 1.0.0 的确定性分类器。`
- Trace Viewer 结果：`Run run-e222a47d-257b-4c54-a1d9-d0f9c3d748f4 共 8 条事件；Bash 过滤得到 4 条；下载 JSONL 与落盘文件 SHA-256 完全一致（888F2762...AB4）。`
- Token 账本结果：`SDK result 报告 measurement=reported、totalTokens=13233；按 eventId 去重，未知字段显示 unavailable，不填充伪 0。`
- 上下文分类/CSV 结果：`该 run 得到 7 个类别；CSV 含 UTF-8 BOM、9 行（含表头），字段覆盖 sequence/timestamp/category/utility/bytes/estimatedTokens/toolName/truncated/ruleVersion；导出密钥扫描通过。`
- 测试命令：`npm run typecheck；npm test（12/12）；npm run build -- --emptyOutDir；REST 过滤/summary/raw/context.csv 审查。`
- 已知限制：`estimatedTokens 使用 UTF-8 bytes/4 近似并明确标为 estimated；SDK 未暴露的隐藏上下文不推测。当前环境无可用内置浏览器，Trace Viewer 通过类型检查、构建和 API 数据验证，未完成截图审查。`
- Commit SHA：`8c730cc5be302a78ee690bf785ba0035e175768f`
- Push 结果：`成功推送至 origin/main。`

---

# 阶段 D：真实文件调用展示

## D1. 演示目标

完成一次容易复现、不会破坏项目的真实文件读取调用，并在网页和轨迹中展示完整闭环：

```text
用户任务 → tool_start(Read) → tool_result → assistant 总结 → run_result
```

## D2. 建议演示任务

优先读取项目现有的 `package.json`，避免额外创建演示文件。发送：

```text
请使用文件读取工具读取当前工作目录中的 package.json。
不要修改任何文件，也不要运行安装命令。
请告诉我：
1. 项目名称；
2. 可用的 npm scripts；
3. 与 Claude Agent SDK、前端和后端相关的主要依赖。
必须以实际读取结果为依据；如果文件不存在，请明确报告错误。
```

## D3. 验收证据

- [x] 前端代码按 `toolUseId` 渲染 `Read` 工具卡片，而不是只有最终回答。
- [x] 前端代码根据配对结果将工具卡片状态从 running 更新为 success 或 error。
- [x] `tool_start` 包含工具名、文件路径、时间戳和 `toolUseId`。
- [x] `tool_result` 使用相同 `toolUseId`。
- [x] 最终回答与实际 `package.json` 内容一致。
- [x] JSONL 中事件顺序完整且每行可解析。
- [x] Trace Viewer 能筛选到本次 Read 调用。
- [x] Token 账本包含本次运行，或明确标记 unavailable。
- [x] Context CSV 将 Read 内容归类为 `file_content`。
- [x] 演示记录不包含 API Key。

## D4. 主动运行审查

- [ ] 在浏览器中完成上述真实任务。
- [x] 直接打开 `package.json`，人工核对智能体总结。
- [ ] 刷新页面，确认轨迹仍可查看。
- [ ] 若应用支持恢复，重启后端后再次打开该会话。
- [x] 检查服务器日志和 JSONL。
- [ ] 检查浏览器控制台。
- [x] 在下方填写事件编号，不另外创建演示报告。

## D5. Git 提交与 Push

如果本阶段只产生被 `.gitignore` 排除的本地轨迹，不要提交真实运行数据；更新本 TODO 的脱敏结果记录并提交。

- [x] 建议提交信息：`test(e2e): verify observable file-read trajectory`。
- [x] 执行 `git push origin HEAD`。
- [x] 记录 commit SHA 和远端结果。

### D 阶段记录（已回填）

- 演示日期与模型：`2026-09-01；deepseek-v4-pro-0813`
- 工作目录：`AGENT_WORKSPACE_ROOT 内的 .（脱敏相对路径）`
- Run ID：`run-cad02671-30f1-4671-b77b-01efe1703961；Chat 5212a1fa-03a2-47c8-8bcd-2ef3043f1444；SDK session 6045d7e0-cfb0-49eb-a6b2-6109480d2210`
- `tool_start` sequence：`第一次 Read seq 5（toolu_2c5afc08ac4647a78def86e2，Unix 风格路径）；恢复后的 Read seq 12（toolu_41111a96146944d0b0400f34，Windows 路径）`
- `tool_result/tool_error` sequence：`第一次 Read tool_error seq 6；恢复后的 Read tool_result seq 13；两组 toolUseId 均正确配对。`
- `run_result` sequence：`15，status=success`
- 人工核对结果：`回答中的 name=simple-chatapp；scripts=dev/dev:server/dev:client/start/typecheck/test/build；SDK、React/Vite、Express/ws 等依赖均与 package.json 一致。模型先因路径格式失败，再自行恢复成功；未修改文件、未运行安装命令。`
- Trace/Token/CSV 验证：`JSONL 共 15 条且密钥扫描通过；Token ledger measurement=reported，input=6252/output=1639/cacheRead=34816/cacheWrite=0/total=42707/cost=0.1561824/duration=40766ms；Context CSV 包含 file_content。`
- Commit SHA：`7af01cc568b4e172eb49bf6936326cfd6dc5b738`
- Push 结果：`成功推送至 origin/main。`

---

# 阶段 E：最终整体审查与交付

## E1. 完整自动验证

- [x] 清理构建输出后重新安装/验证依赖锁文件的一致性。
- [x] 运行格式检查和 lint。
- [x] 运行 TypeScript 类型检查。
- [x] 运行全部单元测试和集成测试。
- [x] 运行生产构建。
- [x] 若存在 E2E 测试，运行真实或可控模拟 E2E。
- [x] 执行 `git diff --check`。
- [x] 确认 `git status --short` 仅包含预期改动。

将项目真实脚本替换进下列命令，不存在的脚本不要伪造执行：

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## E2. 完整运行审查

- [x] 创建新会话。
- [x] 选择合法工作目录。
- [x] 完成一次 Read 文件任务。
- [x] 完成一次工具 Allow。
- [x] 完成一次工具 Deny。
- [x] 完成一次 Stop。
- [x] 重启服务并恢复会话。
- [ ] 查看 Trace Viewer。
- [x] 下载并验证 JSONL。
- [x] 查看 Token 账本。
- [x] 下载并验证 Context CSV。
- [ ] 检查前后端错误处理和空状态。
- [ ] 检查窄屏下关键控制仍可使用；视觉美观不是主要目标。

## E3. 安全与隐私审查

- [x] 搜索仓库中是否存在 `sk-`、`ANTHROPIC_AUTH_TOKEN=`、Authorization Header 和真实 Base URL 凭证组合。
- [x] 确认 `.env`、真实 traces、用户工作区文件和 SDK 私有 transcript 未被误提交。
- [x] 确认完整工作目录越界测试通过（覆盖 traversal/绝对路径/盘符/UNC、符号链接和恢复 cwd）。
- [x] 确认审批超时默认拒绝。
- [x] 确认错误和导出均已脱敏。
- [x] 确认前端 bundle 中不存在 API Key。

建议检查命令：

```powershell
git grep -n -I -E "sk-[A-Za-z0-9._-]{12,}|ANTHROPIC_(AUTH_TOKEN|API_KEY)\s*[:=]\s*[^\"']"
git status --short
git log --oneline --decorate -10
```

发现真实密钥时立即停止 push，撤销密钥，并在必要时清理 Git 历史；不要只删除当前文件后继续提交。

## E4. 最终提交与 Push

- [x] 所有阶段记录均已回填本文件。
- [x] 修改摘要、结果摘要和运行指南已填写。
- [x] 完整验证已通过，或已清楚列出未通过项。
- [x] 建议提交信息：`docs(assignment): finalize implementation review and run guide`。
- [x] 执行 `git push origin HEAD`。
- [x] 使用 `git status --short` 确认工作区状态。
- [x] 记录最终 commit SHA、branch 和 remote。

---

# 4. 每次任务完成后的统一审查与 Push 流程

任何阶段或独立子任务完成后，都按以下顺序执行；测试失败时不得 push：

1. 查看修改：

   ```powershell
   git status --short
   git diff --stat
   git diff --check
   ```

2. 运行与该修改直接相关的最小测试。
3. 运行全局 typecheck 和 build；涉及核心会话逻辑时运行全部测试。
4. 启动应用，主动执行一条能覆盖本次修改的真实任务。
5. 检查浏览器控制台、后端输出、网络连接、JSONL 和 UI 状态。
6. 在本文件对应阶段填写修改摘要、命令、结果和限制。
7. 检查暂存内容：

   ```powershell
   git diff --cached --stat
   git diff --cached --check
   ```

8. 提交并推送：

   ```powershell
   git commit -m "<本阶段提交信息>"
   git push origin HEAD
   git rev-parse HEAD
   ```

9. 只有远端返回成功后，才能勾选 Push 完成。

### Push 失败处理

- 认证失败：记录错误，修复 Git 凭证后只重试 push，不重新生成提交。
- 远端领先：先 `git fetch`，检查差异；不要使用强制 push，除非用户明确授权。
- 分支保护：记录阻塞信息，按仓库流程创建分支/PR。
- 测试失败：保留错误证据，修复后重新测试；不得以 `--no-verify` 绕过。
- 没有配置 remote：记录为阻塞项，请用户提供仓库地址，不擅自创建或发布新仓库。

---

# 5. 最终修改摘要（已回填）

## 5.1 功能修改

- 轨迹与事件：`SDK 原始消息统一标准化为 user/assistant/tool_start/tool_result/tool_error/permission/run_result/system；每条事件具有 eventId、runId、sequence、UTC timestamp，并串行追加到脱敏 JSONL。`
- 工作目录与安全边界：`创建会话时仅接受 AGENT_WORKSPACE_ROOT 内相对目录；resolve/realpath 后再次验证，拒绝穿越、绝对路径、盘符、UNC 与符号链接逃逸。`
- Stop：`运行中调用 Query.interrupt()；幂等 API 返回 stopped=false；成功中断写入 status=stopped 的 run_result 并保留已有轨迹。`
- 工具审批：`Read/Glob/Grep 自动允许；Bash/Write/Edit/Web 工具通过 PreToolUse 强制门禁并复用 canUseTool；支持 Allow once、Always session、Deny、timeout 默认拒绝和断线拒绝。`
- 会话恢复：`data/chats.json 原子持久化 chat/messages/cwd/sdkSessionId；重启后 Query 使用 resume=sdkSessionId，已实测恢复同一会话上下文。`
- Trace Viewer：`提供独立页签、sequence 时间线、事件/工具/错误过滤、展开详情、JSONL 与 CSV 下载。`
- Token 账本：`从 SDK result 保存 reported usage/model/cost/duration；未知值为 unavailable；按 eventId 去重，不伪造 0。`
- 上下文分类导出：`规则版本 1.0.0，确定性分类可观测内容；保存 bytes、estimatedTokens、utility，并导出带 BOM 且正确转义的 CSV。`
- 文件调用演示：`真实 run-cad02671-30f1-4671-b77b-01efe1703961 展示 Read 路径错误后恢复、成功读取 package.json、最终总结与 run_result。`

## 5.2 主要架构决策

- SDK 原始事件如何标准化：`event-normalizer.ts 单点解析 assistant content 的 text/tool_use、user content 的 tool_result、system init 与 result；前端不解析 SDK 私有结构。`
- `chatId`、`runId`、`sdkSessionId` 如何关联：`chatId 为应用持久实体；每条用户任务创建 runId；首次 system/result 的 session_id 持久化为 sdkSessionId，后续恢复仍归入原 chatId。`
- JSONL 写入顺序与并发策略：`Session 先分配严格递增 sequence；TrajectoryStore 按文件 Promise 链串行 append，写入完成后再广播；存储失败只广播 storage error，避免递归写失败。`
- 工具审批等待与超时策略：`requestId 映射独立 Promise；60 秒默认 deny；Abort/断线 deny；同会话 always allow 不跨会话持久化；PreToolUse 与 canUseTool 通过 toolUseId 去重。`
- Resume 策略：`保存真实 SDK session_id，重启后先用与创建路径相同的 resolveWorkspace/realpath 规则复验 cwd，再使用 SDK resume 参数；目录丢失、类型变化或越界时保留原 chat/messages/trace 并明确失败，不创建新 SDK 会话。`
- Token 精确值与估算值的处理：`SDK result usage 标为 reported；上下文字节/4 仅作为 estimated；未提供字段保留 undefined 并在 UI 显示 unavailable。`

## 5.3 未完成项和限制

具体收尾顺序和验收条件见临时清单 [`Assignment1_Remaining_TODO.md`](./Assignment1_Remaining_TODO.md)。本节只保留当前事实摘要。

- `2026-09-02 收尾时已成功连接内置浏览器能力，但其 URL 安全策略明确拒绝访问 http://localhost:3001，并禁止改用其他浏览器控制方式绕过；因此浏览器控制台、刷新/重连、真实审批点击和窄屏交互仍无浏览器证据。`
- `Vite 已从 5.4.21 升级到 8.2.2，开发服务限制为 127.0.0.1 且 strictPort；npm audit 为 0。Node 24.13.0 下 typecheck、测试和 production build 均通过。`
- `短 timeout、Abort、最后客户端断开均由自动化测试验证为默认拒绝；并发审批按 requestId 隔离，重连订阅会重放仍待处理的审批。`
- `恢复 cwd 已复验存在性、目录类型、允许根目录、realpath 和持久化路径一致性；符号链接逃逸、目录丢失/变化以及同一 sdkSessionId 恢复均有测试。`
- `Bash stdout/stderr/exit code、64,000 字符确定上限截断、truncated/originalLength、Trace 相对耗时/关联 ID/视觉配对和 cache read/write 展示已实现。分类采用导出时确定性计算策略。`
- `新增 ESLint 9 flat config 和 Prettier 3；npm ci、typecheck、22 项测试、lint、format:check、Vite 8 build、audit 和 git diff --check 通过。`
- `三项实质性失败及恢复证据：① traces 写入触发 tsx watch 重启，修复为 --exclude traces；② 模型首次用 Unix 路径 Read 失败，随后改用 Windows 路径成功；③ 安全 ls 被 Claude Code 内置策略自动执行，修复为 PreToolUse 强制审批 + canUseTool 去重。`

---

# 6. 当前结果摘要（2026-09-02）

## 6.1 本轮收尾执行记录

- 实现提交：`494c53e9a400624889d4bfe1ce0b1b1c801d8d95`（`fix(assignment1): complete safety controls and trace validation`）。
- Push：`2026-09-02` 成功推送 `d8c5bab..494c53e` 到 `origin/main`。
- 自动验证：`npm ci` 成功；`npm run typecheck` 成功；`npm test` 为 `22/22`；`npm run lint` 成功；`npm run format:check` 成功；Vite `8.2.2` production build 成功；`npm audit --audit-level=moderate` 为 `0 vulnerabilities`；`git diff --check` 成功。
- 安全检查：Git 未跟踪 `.env`、真实 trace、JSONL、SDK transcript 或密钥；命中内容仅为占位符和脱敏测试数据。
- 浏览器尝试：已连接 Codex In-app Browser；首次访问 `http://localhost:3001` 时服务未就绪，启动服务后重新加载被浏览器 URL 安全策略明确拒绝。策略同时禁止使用替代浏览器控制方式规避，因此 U2–U7 维持未勾选并作为环境阻塞，而不是伪造通过。
- 当前页面实现证据：工作目录/审批策略、Stop 状态门控、Bash 分字段、Trace 配对/关联 ID/相对耗时、cache Token 和隐藏上下文 unavailable 均已通过类型检查、自动化测试或 production build；仍缺真实浏览器视觉与交互证据。

| 验收项 | 状态 | 证据 |
|---|---|---|
| 第三方 API 对话 | 已完成 | 本地既有验证 |
| `tool_result` 与错误事件 | 已完成 | Phase A seq 3-4、9-10；normalizer tests |
| JSONL 轨迹 | 已完成 | 两个 Phase A run 逐行解析；raw SHA-256 与落盘一致 |
| 工作目录限制 | 已完成 | 创建/恢复共用 realpath 安全规则；覆盖 traversal、绝对/盘符/UNC、符号链接、丢失和变化路径 |
| Stop | 已完成 | run-14114318-2163-4fa3-b7c2-4930bd83f436 seq 22 |
| Allow/Deny 审批 | 已完成 | 真实 Allow/Deny 记录；自动化覆盖短 timeout、断开、并发隔离、重复结果与重连待审批重放 |
| 会话恢复 | 已完成 | 真实跨重启恢复；自动化验证工作区复验后沿用完全相同的 sdkSessionId |
| Trace Viewer | 部分完成 | 数据/API/构建通过；内置浏览器不可用，未截图审查 |
| Token 账本 | 已完成 | Phase C reported total=13233；Phase D reported total=42707 |
| Context CSV | 已完成 | UTF-8 BOM、转义单测、7 类统计、file_content 验证 |
| 文件 Read 展示 | 已完成 | toolu_41111a96146944d0b0400f34，seq 12→13 |
| 测试与构建 | 已完成 | npm ci；typecheck；22/22 tests；lint；format:check；Vite 8 build；npm audit 0；diff check |
| 所有阶段 Push | 已完成 | e7bb9b2、5ec3852、8c730cc、7af01cc、23c5639、b0307e3 |

最终结论：`代码、自动化、安全边界、工程检查和依赖漏洞收尾均已完成；核心对话、真实工具运行、JSONL、Allow/Deny/Stop、跨重启 resume、Token 与 Context 导出均有证据。唯一未完成的是浏览器视觉/控制台/刷新/窄屏审查，原因是内置浏览器 URL 安全策略阻止 localhost，且策略禁止绕过。`

---

# 7. 最终运行指南（已按项目真实命令校正）

## 7.1 环境要求

- Windows 10/11；
- Node.js 18+，以项目实际 `engines` 为准；
- npm；
- 已配置可用的第三方 Anthropic 兼容 API；
- 一个专门用于智能体实验的工作目录；
- Git remote 和 push 权限。

## 7.2 环境变量

只写变量名和示例占位符，不填写真实密钥：

```powershell
$env:ANTHROPIC_AUTH_TOKEN="YOUR_API_KEY"
$env:ANTHROPIC_BASE_URL="YOUR_ANTHROPIC_COMPATIBLE_BASE_URL"
$env:ANTHROPIC_MODEL="YOUR_MODEL_NAME"
$env:AGENT_WORKSPACE_ROOT="D:\agent-workspaces"
```

如果项目从 `.env` 读取变量，应提供 `.env.example`，真实 `.env` 必须位于 `.gitignore`。

## 7.3 安装和启动

根据最终项目脚本校正：

```powershell
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_PROJECT_DIRECTORY>
npm ci
npm run dev
```

默认地址按实际项目填写：

- Web UI：`http://localhost:5173`
- Backend/API：`http://localhost:3001`
- WebSocket：`ws://localhost:3001/ws`

## 7.4 基本操作

1. 创建会话；
2. 在允许根目录中选择项目；
3. 输入开发任务；
4. 在时间线中查看 assistant、tool start、tool result 和 error；
5. 遇到工具审批时检查工具名和输入，再选择 Allow/Deny；
6. 使用 Stop 中断当前运行；
7. 重启后从会话列表选择可恢复会话；
8. 在 Trace Viewer 查看完整轨迹；
9. 下载 JSONL 和 Context CSV；
10. 查看 Token 账本和墙钟时间。

## 7.5 文件调用演示

发送“阶段 D”的 `package.json` 读取任务，预期看到：

```text
user_message
→ tool_start(Read)
→ tool_result
→ assistant_message
→ run_result(success)
```

## 7.6 验证命令

按最终 `package.json` 脚本校正：

```powershell
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
```

## 7.7 常见问题

### API 返回 401/403

- 检查 Token 与 Base URL 类型、地域和工作空间是否匹配；
- 检查环境变量是否在启动服务的同一个终端生效；
- 不要把 OpenAI 兼容 `/compatible-mode/v1` 地址用于 Claude Agent SDK。

### 网页有聊天但没有工具结果

- 检查 Event Normalizer 是否处理 SDK 中承载 tool result 的真实消息类型；
- 检查 `toolUseId` 是否匹配；
- 检查是否只处理了 assistant content block 而遗漏 tool result 消息。

### Stop 无效

- 检查 interrupt/abort 句柄是否属于当前 run；
- 检查 Stop 是否只改变 UI 状态却没有中断 SDK；
- 检查任务是否已经完成。

### 会话无法恢复

- 检查 SDK session ID 是否持久化；
- 检查原工作目录是否存在；
- 检查是否把应用 chatId 错当成 SDK session ID；
- 注意恢复对话不等于恢复旧文件系统快照。

### JSONL 无法解析

- 确保每个事件只占一行；
- 使用 `JSON.stringify(event) + "\n"`，不要手工拼 JSON；
- 对多行 stdout/stderr 进行 JSON 转义。

---

# 8. Commit 与 Push 总表（已回填至最近一次实现审查）

| 阶段 | Commit | Branch | Push | 审查结论 |
|---|---|---|---|---|
| A：轨迹与工具结果 | e7bb9b2 | main | 已推送 | 真实 Read 成功/错误轨迹与 JSONL 通过 |
| B：工作目录/Stop/审批/恢复 | 5ec3852 | main | 已推送 | Allow/Deny/Stop/跨重启 Resume 通过 |
| C：Trace/Token/Context | 8c730cc | main | 已推送 | API、账本、JSONL 一致性与 CSV 通过 |
| D：文件调用展示 | 7af01cc | main | 已推送 | Windows 路径失败恢复与 package.json 核对通过 |
| E：最终审查 | 23c5639 + b0307e3 | main | 已推送 | 强制审批、干净安装、现有测试、构建和 production audit 通过；浏览器与部分边界验收未完成 |
| F：遗留安全与工程收尾 | 494c53e | main | 已推送 | cwd 恢复复验、控制/审批边界、工具输出、Trace 字段、22 项测试、lint/format、Vite 8 与 audit 0 通过；浏览器因 URL 策略阻塞 |

## 完成定义

只有同时满足以下条件，作业改造才可标记为完成：

- [x] A–E 所有必需项已完成或明确记录阻塞原因；
- [x] 真实文件调用闭环已展示；
- [x] 三类后续故障分析所需证据能从 JSONL/Trace Viewer 中取得；
- [x] Token 与上下文统计没有伪精确数据；
- [x] 工作目录、审批和密钥处理通过安全检查；
- [x] 完整自动化测试、lint、format、build、audit 和非浏览器主动运行审查已执行；浏览器验收阻塞原因已明确记录；
- [x] 每个阶段已提交并成功 push；
- [x] 本文件的修改摘要、结果摘要和运行指南均已回填。
