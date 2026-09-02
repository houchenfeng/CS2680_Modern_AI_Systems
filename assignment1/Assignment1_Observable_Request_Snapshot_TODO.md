# Assignment 1：可观测请求快照修改 TODO

## 目标

在现有 Claude Agent SDK Web UI 中补充“应用可观测请求快照”，让每次运行能够展示并保存应用明确提供给 SDK 的上下文，包括：

- 自定义 `SYSTEM_PROMPT`
- 启用的工具列表
- 当前工作目录下可见的 `CLAUDE.md` 项目指令
- 模型名称和工作目录
- 用户消息及后续 SDK 输出事件

该快照只代表应用能够观察和控制的输入，不声明包含 SDK 运行时或 Anthropic 服务端注入的隐藏提示词。

## 文档与产物约束

- [x] 所有修改计划、实施记录、测试结果、问题及最终结论只写入本文件。
- [x] 不创建其他 TODO、测试报告、过程记录或临时 Markdown 文件。
- [x] 不提交真实运行轨迹、SDK 私有 transcript、`.env`、API Key 或认证信息。
- [x] 如测试必须生成临时数据，应放在现有忽略目录中，并在测试结束后清理；不得作为最终产物提交。

## A. 统一请求配置

- [x] 在 `simple-chatapp/server/ai-client.ts` 中导出并复用 `SYSTEM_PROMPT`、`AGENT_TOOLS` 和模型配置，保证 SDK 实际配置与快照来源相同。
- [x] 避免分别维护两份提示词或工具列表，防止展示内容和真实调用配置不一致。
- [x] 明确设置 `settingSources: []`，关闭 SDK 对用户、项目和本地配置的隐式加载。
- [x] 检查当前 SDK 版本的类型定义，确认 `settingSources` 和 `systemPrompt` 的字段用法。

## B. 显式加载项目指令

- [x] 在已通过安全验证的会话工作目录中查找 `CLAUDE.md`。
- [x] 文件存在时读取其文本，并记录来源路径；不存在时记录 `unavailable`，不得伪造空内容。
- [x] 对读取失败、文件过大和编码异常提供明确状态。
- [x] 将项目指令以确定、可复现的格式显式合并到传给 SDK 的系统提示中。
- [x] 对项目指令应用现有脱敏规则，避免保存密钥或认证字段。

## C. 新增请求快照事件

- [x] 在 `simple-chatapp/server/events.ts` 中增加 `request_snapshot` 事件类型。
- [x] 快照至少包含：`systemPrompt`、`projectInstructions`、`projectInstructionSource`、`tools`、`model`、`cwd` 和可观测性说明。
- [x] 为不可获得字段使用 `unavailable`，不要使用伪造值或误导性的 `0`。
- [x] 每次用户任务开始时，按以下顺序写入同一个 run 的 JSONL：

```text
request_snapshot → user_message → system/init → assistant/tool events → run_result
```

- [x] 快照沿用现有 `eventId`、`chatId`、`runId`、`sequence`、UTC `timestamp` 和脱敏流程。
- [x] 确保恢复会话后每个新 run 都生成自己的快照，且不会重复写入。

## D. Context 分类与界面展示

- [x] 在 `simple-chatapp/server/trace-analysis.ts` 中将快照内容分别归类为 `system_harness`、`project_instruction` 和 `tool_definition`。
- [x] 快照的可见文本可以计算字节数和估算 token，但必须继续标记为 `estimated`。
- [x] SDK `run_result.usage` 继续作为输入、输出和缓存 token 总数的权威报告值。
- [x] 在 `simple-chatapp/client/components/TraceViewer.tsx` 中增加可折叠的 “Observable request snapshot” 卡片。
- [x] 卡片分别展示 System prompt、Project instructions、Tools、Model 和 Working directory。
- [x] 在界面中固定显示说明：该快照不包含 SDK 或服务端未公开的隐藏上下文。

## E. 测试与验收

- [x] 单元测试：SDK 配置和快照引用同一组提示词、工具和模型变量。
- [x] 单元测试：存在及不存在 `CLAUDE.md` 时均生成正确快照。
- [x] 单元测试：`settingSources: []` 已设置，项目指令通过显式路径加入。
- [x] 单元测试：快照经过脱敏后才写入 JSONL 和发送前端。
- [x] 单元测试：同一 run 中快照只出现一次，且 sequence 早于用户消息和 SDK 输出。
- [x] 集成测试：真实会话的快照、用户消息、工具调用、工具结果和 `run_result` 使用相同 `chatId/runId`。
- [x] 界面验收：Trace Viewer 能展开并查看所有可观测输入，缺失内容显示 `unavailable`。
- [x] 回归验证：运行格式检查、类型检查、全部测试、生产构建和敏感信息扫描。

## 实施记录

> 实施过程中只在此处追加日期、修改文件、关键设计选择及异常处理，不另建过程文档。

- 日期：`2026-09-02`
- SDK 核对：`@anthropic-ai/claude-agent-sdk@0.1.77` 的 `Options.settingSources?: SettingSource[]`；空数组表示不加载 filesystem settings；注释明确“Must include 'project' to load CLAUDE.md”。`systemPrompt` 支持 `string` 或 preset 对象。
- 新增 `server/agent-config.ts`：集中导出 `SYSTEM_PROMPT`、`AGENT_TOOLS`、`ALLOWED_TOOLS`、`SETTING_SOURCES=[]`、`resolveModel()`、`loadProjectInstructions()`、`composeSystemPrompt()`、`buildObservableRequestSnapshot()`。
- `ai-client.ts` 改为使用上述统一配置；SDK `query()` 传入 `settingSources: []` 与合并后的 `systemPrompt`；暴露 `getObservableRequest()`。
- `Session.create()` 在创建真实 Agent 前加载 `CLAUDE.md`；`sendMessage()` 先写 `request_snapshot` 再写 `user_message`。
- `trace-analysis.ts` 规则版本升至 `1.1.0`；`request_snapshot` 展开为三类 context 行。
- Trace Viewer 增加可折叠 Observable request snapshot 卡片，并固定显示不可见隐藏上下文说明。
- CLAUDE.md 过大（>256KB）标记 `truncated`；缺失为 `unavailable`；越界/符号链接逃逸为 `error`。

## 验证结果

> 完成后在此记录真实命令结果、测试数量、演示用 `chatId/runId/sdkSessionId`、事件顺序及脱敏检查结果。

- `npm run typecheck`：通过
- `npm test`：`32/32` 通过（新增 agent-config / request_snapshot / context expand 测试）
- `npm run lint`：通过
- `npm run format:check`：通过
- `npm run build -- --emptyOutDir`：通过
- `npm audit --audit-level=moderate`：因 registry 网络失败未能完成远程审计；本地构建与测试不受影响
- 事件顺序验收：`request_snapshot (seq 1) → user_message (seq 2) → … → run_result`；同 run 仅一条 snapshot
- 脱敏验收：含 `sk-example-…` / `Bearer secret…` 的 CLAUDE.md 写入 JSONL/前端事件后为 `[REDACTED]`
- 界面：Trace Viewer 可展开 System prompt / Project instructions / Tools / Model / cwd；缺失显示 `unavailable`

## 最终结论

> 完成所有修改和验证后，在此总结已实现内容、已知限制、最终提交 SHA 及 push 结果（仅在用户明确要求 push 时执行）。

- 已实现应用可观测请求快照：统一配置源、显式 CLAUDE.md、关闭隐式 settingSources、每 run 持久化并在 Trace Viewer 展示。
- 已知限制：快照仅覆盖应用明确提供给 SDK 的输入；不包含 SDK/服务端隐藏提示；`npm audit` 本次因网络不可用未完成。
- Commit / Push：见本轮 git 结果（用户已要求 push）。
