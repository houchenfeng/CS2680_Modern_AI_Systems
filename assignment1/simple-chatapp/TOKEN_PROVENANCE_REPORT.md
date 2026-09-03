# 输入 Token 来源分析与验证方案

## 1. 目标与结论

本报告定义如何对 **Claude Code / Claude Agent SDK 的每一次模型调用**统计输入 token 来源，并记录已经完成的交叉验证实验。

目标不是根据最终 transcript 猜测比例，而是把每类输入标记为：

- **直接观测（observed）**：实际请求或 SDK 事件中能看到内容；
- **受控测量（measured by ablation）**：通过只改变一个配置项得到 token 差值；
- **校准推断（calibrated）**：文本不公开，但可以通过最小基线或层间差值稳定归因；
- **未解释残差（unexplained residual）**：以上方法仍不能解释的部分。

首轮实测结果已经达到要求：在 6,902 个输入 token 中，**98.18% 可以直接归因到应用控制的 System Prompt、CLAUDE.md 和工具表面**；剩余 1.82% 也能通过直接 API 基线与 SDK/API 差分归因到用户消息、API/model framing 和 SDK 固定开销。没有证据支持把约 6,144 个缓存 token 标成 unknown。

最重要的发现是：当前配置中输入 token 的绝大部分不是用户对话或工具结果，而是八个已挂载工具的 schema 和工具使用指令。

```text
Tool definitions + tool instructions  6,053  87.70%
CLAUDE.md + wrapper                      694  10.06%
API/model request framing                 96   1.39%
Application system prompt                 29   0.42%
SDK/Claude Code fixed overhead             20   0.29%
User message                               10   0.14%
                                         ----  ------
Total                                   6,902 100.00%
```

## 2. 实验环境

实验日期：2026-09-02（Asia/Shanghai）。

| 项目 | 实际值 |
|---|---|
| 项目 | `assignment1/simple-chatapp` |
| Agent SDK package | `@anthropic-ai/claude-agent-sdk ^0.1.28` |
| SDK init 报告的 Claude Code 版本 | `2.0.77` |
| 实际模型 | `deepseek-v4-pro-0813` |
| API | 课程 `ANTHROPIC_BASE_URL`，Anthropic-compatible Messages API |
| Context window | SDK `modelUsage` 报告 200,000 |
| setting sources | `[]` |
| 显式工具 | `Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch` |
| 自动 CLAUDE.md 加载 | 关闭；应用自行读取并拼接到 system prompt |

`allowedTools = [Read, Glob, Grep]` 只表示这三个工具预先允许执行，并不会从模型 context 中移除其他工具。SDK init 实际报告八个工具全部存在，所以八个 schema 都会产生输入开销。

本项目的 `settingSources: []` 很重要：它排除了用户级、项目级和 local settings 的隐式自动加载。当前 `CLAUDE.md` 是应用读取后明确拼进 system prompt 的，因此它的来源和版本可以记录，不应归为 unknown。

## 3. 每个输入 Token 的来源分类

### 3.1 API/model request framing

来源包括课程代理或模型模板为一个合法 Messages 请求添加的固定包装，例如角色边界、消息格式和模型输入模板。其具体文本不公开，但来源层明确。

测量方法：发送空用户内容、无 system、无 tools 的直接 Messages 请求。

实测值：**96 tokens，占完整 SDK 首轮的 1.39%**。

可信度：校准推断。它不是 unknown；只能说内部文本不可见。

### 3.2 User message

来源是本轮用户提交给 agent 的文本、图片或附件描述。文本本身可以从 UI 和真实请求中直接观测。

测量方法：直接 API 中保持其他字段完全相同，比较空用户内容与实际用户内容。

本次 prompt：

```text
Reply with exactly OK. Do not use tools.
```

实测差值：**10 tokens，占 0.14%**。

生产统计时应保留消息 ID、原始字节数和 count-tokens 差值，不能使用固定的 `bytes / 4` 作为最终结果。

### 3.3 Application System Prompt

来源是 `server/agent-config.ts` 中应用明确提供的 system prompt：

```text
You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.
```

测量方法：直接 API 和 Agent SDK 都执行无 system/短基线 system 与应用 system 的受控差分。

实测差值：**29 tokens，占 0.42%**。

直接 API 的独立结果为 29 tokens；SDK 的最小 system 与应用 system 差值同样为 29 tokens。因此这部分跨两条调用路径一致。

### 3.4 CLAUDE.md 与应用包装

来源是工作目录内的 `CLAUDE.md`，以及应用添加的分隔符和来源说明：

```text
---
Project instructions from simple-chatapp/CLAUDE.md:
...
```

文件大小：2,559 bytes；加入包装后的 system prompt 从 204 bytes 增至 2,821 bytes。

测量方法：保持模型、用户消息、工具集合和其他 system 内容不变，只加入 CLAUDE.md 与包装。

实测结果：

- 直接 API：828 − 135 = **693 tokens**；
- Agent SDK：849 − 155 = **694 tokens**。

采用 SDK 实际路径结果：**694 tokens，占 10.06%**。

两条路径只差 1 token，说明分类稳定。生产环境必须记录 CLAUDE.md 内容 hash、读取路径、状态和截断信息，以证明某次调用对应的是哪个版本。

### 3.5 Tool definitions 与工具使用指令

来源包括：

- 工具名和描述；
- JSON input schema；
- schema 中字段名、类型、required 信息和说明；
- Claude Code/服务端为工具调用添加的工具使用 system instructions；
- 工具配置和必要的序列化包装。

Anthropic 文档说明，tools 参数、`tool_use`、`tool_result` 以及工具专用 system prompt 都会消耗输入 token：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>。

测量方法：保持 system、CLAUDE.md、用户消息和模型不变，对比 `tools: []` 与完整八工具集合。

实测结果：6,902 − 849 = **6,053 tokens，占 87.70%**。

这 6,053 tokens 应标记为 `tool surface`。如果能从透明请求代理拿到完整 `tools` 数组，则进一步标记为 `tool definitions + provider tool instructions`。在没有最终构造文本时，不应武断地把它拆成“schema 文本”和“服务端工具 system prompt”两个精确数字。

单独只启用 `Read` 时，首次调用从无工具的约 849 tokens 增至约 1,267 tokens，说明 `Read` 工具表面约贡献 **418 tokens**。八个工具的开销不是简单的八倍，因为不同工具 schema 大小差异明显，并存在共享工具指令。

### 3.6 SDK / Claude Code fixed overhead

来源是同一请求在 Agent SDK/Claude Code 路径相对直接 Messages API 多出的固定 framing。

测量方法：对相同模型、用户、system 和无工具配置，比较 SDK 与直接 API：

```text
Agent SDK app-system run  155
Raw API app-system run    135
Difference                 20
```

实测值：**20 tokens，占 0.29%**。

这部分文本未公开，但可以稳定归因到 SDK/Claude Code 调用层，因此标记为 `calibrated SDK framing`，而非 unknown。

### 3.7 Assistant history

来源是之前轮次中的 assistant 文本、thinking、tool-use blocks 及其参数。它们在下一次请求中可能继续进入 context。

生产统计必须至少分别保存：

- assistant text；
- thinking 或 redacted thinking 的可见长度；
- tool name、tool-use ID 和参数；
- message ID；
- 是否在 compaction 后仍被保留。

本次多轮实验发现 thinking 可达到 880、521、418、601 和 1,719 字符。它可能显著影响后续输入，不能只统计用户可见的 assistant 文本。

当前课程代理在 assistant fragment 上报告的 usage 不可靠：同一 message ID 被拆成 thinking、tool-use 或 text 多条记录，usage 会重复，而且多次出现 `output_tokens: 0`。所以 fragment usage 只能用于发现异常，不能直接求和。

#### 多轮时必须区分的四种 usage 口径

1. **Assistant-message usage**：附着在 SDK assistant message 上，理论上对应一次模型请求，但本代理会在同一 message 的多个 fragment 上重复，并可能错误保留上一调用的数值。
2. **Run-result usage**：一个用户 run 内所有 agent turns 的汇总；`input + cache-read + cache-write` 才是逻辑累计输入。
3. **modelUsage**：SDK 返回的按模型累计统计；本次实验中它可能覆盖更大的 session、隐藏辅助调用或不同聚合范围，不能与 run usage 混用。
4. **Session cumulative usage**：连续输入模式下，后一个 run 的 `modelUsage` 可能包含前一个 run，必须使用相邻快照差分。

UI 必须给这四类数据不同名称。禁止把 `modelUsage.inputTokens` 当成本轮单调用输入，也禁止把相同 message ID 的 fragment usage 相加。

### 3.8 Tool calls

来源是 assistant 生成的结构化工具调用，包括工具名、tool-use ID 和 JSON 参数。它属于模型输出，但在下一次模型调用中变成输入历史。

统计规则：

- 当前调用生成的 tool call 计入当前调用 output；
- 只有到下一次模型调用时，才计入 input provenance；
- 不与 tool result 合并。

### 3.9 Tool results

来源是文件内容、搜索结果、命令输出、编辑结果和工具错误。它们通常是长对话中增长最快的动态输入。

统计规则：通过 `tool_use_id` 将 result 与 call 配对；记录原始长度、截断状态、stdout、stderr、exit code 和 `is_error`。工具结果只计入其产生之后的模型调用。

本次成功实验中，`Read` 返回的工具结果序列化后为 358 字符。第一轮包含两次模型调用：

- 第一次调用：约 1,267 input tokens；
- 整轮两次调用累计：1,570 uncached + 2,048 cache-read = 3,618 input tokens；
- 第二次调用可由差分得到约 2,351 input tokens。

第二次调用相对第一次增加的不仅是 358 字符的 tool result，还包括第一调用的 thinking、tool-use 参数、角色包装和缓存边界。因此不能用工具结果字节数解释全部增量。

### 3.10 Permission、hook、error 与 compaction

这些来源只在发生对应事件后进入 context：

- permission request/result；
- hook 输出与拒绝原因；
- tool error；
- retry 错误消息；
- compaction summary；
- resume 时恢复的会话摘要。

SDK 类型中存在 `compact_boundary`、`hook_response` 和 status 消息，但当前 event normalizer 尚未完整保留这些类型。生产实现必须保存它们，否则长会话中的来源覆盖率会下降。

## 4. 已完成实验记录

### 实验 A：直接 Messages API 静态消融

目的：绕开 Agent SDK，验证用户、system 和 CLAUDE.md 的 token 差值。

| 变体 | Input tokens | 相对差值 |
|---|---:|---:|
| 空用户，无 system | 96 | 基线 |
| 实际用户，无 system | 106 | User +10 |
| 实际用户 + app system | 135 | System +29 |
| 实际用户 + app system + CLAUDE.md | 828 | CLAUDE.md +693 |

三次重复中关键差值保持一致：system 为 29–34 tokens（旧一次使用了稍短的用户 prompt），CLAUDE.md 为 693 tokens。最终同 prompt 对照采用 29 和 693。

结果：直接 API 可以解释 system 与 CLAUDE.md；不存在数千 token 的隐藏 system prompt。

### 实验 B：Agent SDK 静态消融

目的：测量实际 Claude Code runtime 相对直接 API 的额外开销，以及工具表面。

| 变体 | Input tokens | 差值 |
|---|---:|---:|
| Minimal system，0 tools | 126 | SDK 最小基线 |
| App system，0 tools | 155 | System 增量 +29 |
| App system + CLAUDE.md，0 tools | 849 | CLAUDE.md +694 |
| App system + CLAUDE.md，8 tools | 6,902 | Tool surface +6,053 |

SDK init 确认：实际模型为 `deepseek-v4-pro-0813`；八个工具全部挂载；skills、MCP servers 和 plugins 均为空。

结果：完整首轮中 97.76% 来自 Tool Surface 与 CLAUDE.md；加上应用 system 后，应用控制内容覆盖 98.18%。

### 实验 C：历史 JSONL 回放

目的：检查多轮、tool-use/tool-result 顺序以及缓存 usage。

一条真实 session 中：

- 8 个独立 API message ID；
- 6 个 message 被拆成多个流式 fragment；
- 4 次 tool-result transition；
- 检测到多轮用户输入；
- 5 个 message 的 fragment usage 相互冲突。

历史 session 多轮出现固定 `cache_read_input_tokens: 6144`。结合静态工具消融得到的 6,053 tokens，可判断该缓存块主要覆盖工具表面及其附近固定前缀，而不是 6,144 个 unknown tokens。缓存以块或前缀方式记账，因此不能要求它与工具增量逐 token 完全相等。

### 实验 D：一工具、多轮对话

目的：验证 tool result 是否只进入后续调用，并检查每调用 usage。

配置：只启用 `Read`，显式允许 `Read`，关闭 settings 自动加载，使用相同 system 和 CLAUDE.md。

第一次实验成功完成一次读取和后续回答：

- 首调用约 1,267 input tokens；
- 工具结果 358 个序列化字符；
- 第一轮两次调用累计 3,618 input tokens；
- 第二调用通过累计差分约为 2,351 input tokens；
- 第二用户轮没有再次读取文件。

结果：多轮来源顺序可以追踪，但 SDK/proxy 没有稳定提供每个 assistant message 的权威 usage。

#### 成功轨迹的调用级重建

成功重复中，第一用户 run 产生两个模型调用：第一次生成 `Read`，第二次消费工具结果并回答。

```text
Call 1 logical input                         1,267
Run total logical input                     3,618
Call 2 inferred input = 3,618 - 1,267       2,351
Call 2 growth over Call 1                   1,084
```

这 1,084 token 的增长不能全部标成 Tool Results。可观测新增来源至少包括：

- 第一次 assistant thinking；
- `Read` tool-use block 和参数；
- 358 字符 tool result；
- tool-result role/block wrapper；
- 第二次请求新增的 harness serialization；
- 缓存边界造成的 uncached/cache-read 重分类。

生产实现应捕获 Call 2 的真实 outbound request，再用 count-tokens 对 thinking、tool-use 和 tool-result 分别做增量计数。没有真实请求前，只能把 1,084 标为“动态历史增量”，不能全部归给工具结果。

第二用户 run 的 prompt 明确要求不要再次读取。成功实验中没有出现新的 tool result，说明可以用工具调用数验证行为；但“没有再次读取”本身不能证明 context 正确，仍需检查第二 run 的真实 messages 是否包含第一轮结果或摘要。

### 实验 E：工具失败与最大轮数

重复实验中模型连续生成 `Read` 调用，出现九个已返回的 tool errors，并达到十轮上限：

- 结束状态：`error_max_turns`；
- run usage：3,197 uncached + 5,120 cache-read；
- run output：1,065 tokens；
- per-fragment usage 多次重复 `input_tokens: 1267, output_tokens: 0`；
- `modelUsage` 与 run-level usage 使用不同累计口径。

这是一条可用于作业失败分析的真实轨迹。初步分类为 observability/harness failure 候选：工具错误本身是直接证据，而 usage 在 fragment、run 和 cumulative modelUsage 三个层级不一致，阻止了可靠的逐调用归因。最终归因前仍需检查每个 Read 参数和错误正文，先排除纯 tool failure。

#### 失败轨迹中的累计量

失败 run 的两种统计口径差异很大：

```text
run_result logical input = 3,197 + 5,120 = 8,317
modelUsage logical input  = 7,691 + 43,008 = 50,699
```

两者相差 42,382 tokens。`modelUsage` 同时报告 2,296 output tokens，而 run result 只报告 1,065 output tokens，较大的数字很可能包含 session 累计、辅助调用或不同聚合范围。不能把该差额解释成 context 内容，更不能标成 unknown prompt。

此轨迹有多个 distinct message ID，但 assistant usage 反复报告 `1,267`。这说明仅依赖 SDK assistant messages 无法满足“每次调用 95% token 来源归因”。透明请求代理是达到逐调用目标所需的测量边界。

#### 多轮的正确事件状态机

```text
user/run begins
  → capture outbound request N
  → count and classify request N
  → receive assistant text/thinking/tool-use
  → receive zero or more tool results
  → capture outbound request N+1
  → count newly resident assistant/tool history
  → ...
  → run_result closes this user run
```

如果只在 `run_result` 时统计，会失去 run 内调用边界；如果只看 assistant fragment，则会遇到本实验中的重复 usage。两者必须通过真实 outbound request ID 连接。

### 实验 F：`/messages/count_tokens` 能力验证

课程代理的 Anthropic-compatible `/v1/messages/count_tokens` 已实测返回 HTTP 200 和有效 `input_tokens`。这意味着可以在不生成模型输出的情况下，对捕获的真实请求执行逐类反事实计数。

结果：保留 SDK 的同时实现精确统计是可行的；不需要为了可观测性放弃 Claude Code runtime。

### 实验 G：SDK debug/runtime 行为

一次四变体长进程最初没有正常退出。debug 日志显示：

- 主响应已经开始 streaming；
- Claude Code 尝试访问课程代理不支持的 `claude-haiku-4-5-20251001` 辅助模型，返回 `Model not exist`；
- Windows 上 subagent transcript symlink 返回 `EPERM`；
- telemetry event export 失败；
- tool search 被禁用。

将实验改为每变体独立进程并在收到 result 后退出，四个静态变体均在约 1.4–1.8 秒 API 时间内成功。该现象说明端到端 wall-clock 还包含 SDK 周边任务，不能只看主模型延迟。

## 5. 生产逐调用统计方案

### 5.1 保留 SDK，加入本地透明观测代理

推荐路径：

```text
Web UI
  → Claude Agent SDK / Claude Code
  → localhost observation proxy
  → course ANTHROPIC_BASE_URL
```

观测代理只做以下工作：

1. 删除认证 header 后保存请求元数据；
2. 捕获每个真实 `/v1/messages` 请求中的 `system`、`tools` 和 `messages`；
3. 捕获响应 usage；
4. 对同一请求调用 `/messages/count_tokens`；
5. 生成逐调用 provenance ledger；
6. 原始请求只保存在本地，并对文件内容、路径和凭据做现有 redaction。

透明代理不执行 agent loop、不改变工具调用、不修改响应，因此仍然是 Claude Code 应用，而不是重新实现作业二的 agent。

### 5.2 固定顺序的增量计数

对每个实际请求构造以下 count-tokens 变体：

```text
C0 = API/model minimal framing
C1 = C0 + application system prompt
C2 = C1 + CLAUDE.md
C3 = C2 + tool definitions
C4 = C3 + user messages
C5 = C4 + assistant text/thinking/tool-use history
C6 = C5 + tool results/errors/permission/hook/compaction content
```

各类 token 为相邻差值：

```text
System       = C1 - C0
CLAUDE.md    = C2 - C1
Tools        = C3 - C2
User         = C4 - C3
Assistant    = C5 - C4
Tool results = C6 - C5
```

固定顺序很重要，因为 tokenizer 可能跨边界合并 token；不同加入顺序可能带来少量差异。报告中必须固定并公开此顺序，不能为得到理想比例临时调整。

完整请求的 `C6` 必须与响应的逻辑 input usage 比较。cache-read 和 cache-write 是同一逻辑 context 的存储/计费属性，应另做 stacked overlay，不能作为新的内容来源类别。

### 5.3 95% 覆盖率定义

对调用 `t`：

```text
reported_input_t = input_tokens
                 + cache_read_input_tokens
                 + cache_creation_input_tokens

residual_t = reported_input_t - counted_full_request_t

coverage_t = 1 - abs(residual_t) / reported_input_t
```

验收条件：

- 每个正常调用 `coverage_t >= 95%`；
- session 中至少 95% 的调用达到该条件；
- 未达到时必须显示 residual 和原因，不得按比例强行分摊；
- source category 的 token 合计必须等于 count-tokens 的完整请求值；
- cache 分类与内容来源分类分别显示。

首轮静态实验的应用控制来源覆盖率为：

```text
(6,053 + 694 + 29) / 6,902 = 98.18%
```

加入已校准的 API framing、SDK overhead 和 user 后，首轮分层来源覆盖为 100%；这不代表知道所有内部文本，只代表所有 token 已定位到可复现的来源层。

## 6. 接下来要执行的完整测试矩阵

每项至少重复三次，记录模型、日期、Claude Code/SDK 版本、冷/热缓存、wall-clock、input/output/cache tokens、cost 和完整 trace。

### T1：空请求与固定 framing

- 空用户，无 system，无 tools；
- 同一请求重复三次；
- 验证 framing 是否稳定以及 cache 是否改变内容总数。

### T2：System Prompt 消融

- 无 system；
- 应用 system；
- 等字节随机 system 作为控制；
- 验证内容变化不会被错误解释成工具或用户 token。

### T3：CLAUDE.md 消融

- 无 CLAUDE.md；
- 当前 CLAUDE.md；
- 等长度随机文本；
- 修改一行并记录 hash；
- 验证每次 request snapshot 与实际捕获请求一致。

### T4：逐工具 schema 消融

- 0 tools；
- 分别只启用 Read、Write、Edit、Glob、Grep、Bash、WebSearch、WebFetch；
- 完整八工具；
- 比较单工具之和与完整工具集，测量共享工具 prompt 开销。

### T5：无工具多轮对话

- 固定五轮短消息；
- 检查 User 和 Assistant history 逐轮增长；
- 验证 transcript 重建与实际请求 messages 完全一致。
- 每轮分别报告 `new user`、`prior user`、`prior assistant` 和 framing，不能只给 session 汇总。

### T6：小、中、大工具结果

- Read 返回约 100、1,000、10,000 字符；
- 确认 Tool Results 只进入后续调用；
- 测量截断前后 token 和上下文占比。
- 每个尺寸都至少产生 `tool call → tool result → final answer` 两次模型调用，并验证 tool result 在前一调用为 0、后一调用才出现。

### T6b：Thinking 与 Tool Result 分离

- 使用同一工具结果构造 thinking 较短与较长的任务；
- 分别 count assistant thinking、tool-use 和 tool-result；
- 证明后续调用增长不能仅由 tool-result 字节数解释；
- 如果 thinking 被 redacted，只报告可见 block 与 residual，不反推隐藏文本。

### T7：工具成功、显式错误和静默空结果

- 成功 Read；
- 路径不存在；
- wrapper 返回空结果但成功；
- 手工重放工具调用，区分 tool failure 与 harness/model failure。

### T8：缓存冷启动与热启动

- 完全相同请求至少运行三次；
- 分开记录 uncached、cache-read 和 cache-write；
- 验证来源比例不因计费桶改变而改变。

### T9：Compaction

- 构造足够长的工具输出触发 compaction；
- 捕获 `compact_boundary` 和 summary；
- 对比 compaction 前的真实历史、summary 和下一调用实际 messages；
- 把被移除历史与新增 summary 分开报告。

### T10：Resume

- 结束 session 后通过 session ID 恢复；
- 检查恢复后第一调用携带哪些历史；
- 验证 UI transcript 与实际请求的差异。
- 分别比较同一进程连续多轮、关闭后 resume、重新创建 session 三种路径。

### T10b：Run usage 与 session cumulative usage

- 连续提交三个用户 run；
- 保存每个 `run_result.usage` 和 `modelUsage` 快照；
- 用相邻 `modelUsage` 差分检查它是否为 session cumulative；
- 与透明代理捕获的逐请求 usage 求和比较；
- 给每个字段确定唯一、可测试的语义后再进入 UI。

### T11：SDK、CLI 与直接 API 对照

- 相同 system、tools、messages；
- Agent SDK；
- Claude CLI `stream-json`；
- 直接 Messages API；
- 判断 CLI 是否真的改善可观测性。预期 CLI 与 SDK 共享 Claude Code runtime，不会消除最终 prompt 的黑箱。

### T12：工具错误循环

- 重现本报告中的 Read error/max-turns 轨迹；
- 保存每次参数和完整错误正文；
- 检查模型是否重复相同无效调用；
- 按 tool → harness → specification → model 的顺序归因。

## 7. SDK 是否保留

结论：**保留 Claude Agent SDK，不改成纯 Messages API agent。**

理由：

- 作业一要求围绕真实 Claude Code 构建 Web UI，并分析其 lifecycle；作业二才要求自己实现 model/tool loop：<https://cs2680.com/assignments/>。
- SDK 提供工具执行、权限、hooks、session/resume 和真实 Claude Code 行为。
- 直接 API 的优势是请求透明，适合作为基线、消融和 count-tokens 对照；用它替代 SDK 会改变被研究系统。
- CLI `stream-json` 与 SDK 共享 Claude Code runtime 和多数事件/usage 限制，单纯换 CLI 不会解决逐调用归因。
- 本地透明代理加 count-tokens 可以同时保留真实 runtime 和请求级可观测性。

因此最终架构应是：**SDK 负责执行，透明代理负责捕获，count-tokens 负责计数，trace viewer 负责解释。**

## 8. 报告时必须披露的限制

1. 实际模型是课程代理提供的 `deepseek-v4-pro-0813`，不是 Anthropic 原生 Claude 模型；结果不能直接外推到其他模型。
2. SDK assistant fragment usage 在当前代理下存在重复和 output=0，不能作为逐调用权威值。
3. run-level usage、`modelUsage` 和历史 JSONL usage 可能采用不同累计口径，必须分别命名。
4. 工具消融得到的是 `tool definitions + tool-use instructions` 的总贡献，不等于只计算 JSON schema 字面量。
5. 增量 count-tokens 归因依赖固定加入顺序；tokenizer 跨边界可能使其他顺序出现小差异。
6. 本地透明代理会看到 system prompt、文件内容和工具输出，必须仅本地保存、移除认证 header，并继续使用项目的 redaction。
7. 单次实验不是可靠性结论；正式提交表格应使用至少三次重复，并报告均值和范围。

## 9. 最终应在 UI 中展示的格式

每次调用分别展示内容来源与缓存状态：

```text
Input provenance — Call 1                  tokens   share   evidence
Tool definitions + instructions            6,053   87.70%  ablation/count
CLAUDE.md + wrapper                           694   10.06%  observed/count
API/model framing                              96    1.39%  calibrated
Application system prompt                      29    0.42%  observed/count
SDK/Claude Code framing                        20    0.29%  calibrated
User message                                   10    0.14%  observed/count
Unexplained residual                            0    0.00%  reported − counted
Total                                        6,902  100.00%

Cache overlay
Uncached input                              6,902
Cache read                                      0
Cache write                                     0
```

后续调用再加入 Assistant、Tool Calls、Tool Results、Permission/Hook、Compaction 等行。任何无法达到 95% coverage 的调用必须显示为警告，并提供 raw request、count-tokens 值、reported usage 和 residual 原因。

## 10. 实现追加记录（不修改上文历史实测数字）

- 日期：`2026-09-03`
- Schema：事件 schema v2；`callUsage` / `runUsage` / `modelUsageSnapshot` 分字段；v1 JSONL migrate-on-read。
- 观测：`server/observation-proxy.ts` 本地透明代理捕获 `/v1/messages`，记录 queued/sent/firstByte/firstVisible/firstUseful/completed；SSE `text_delta` → firstVisible+firstUseful，`tool_use` → firstUseful。
- Ledger：`token-counter.ts` + `context-ledger.ts`，固定 `CONTEXT_RULE_VERSION`，95% coverage gate；6902 fixture 回归。
- 价格：`pricing.ts` DeepSeek V4 Pro 峰段 0.044 / 1.32 / 3.96；cache-write 按 miss；provider 与 normalized 分字段。
- UI：Trace Viewer Calls 视图展示 provenance、cache overlay、成本、TTFB/TTFV/TTFU、residual、相邻 Context Diff。
- 测试：截至本追加为 `105` pass（含 SSE timing 单测）。
- 说明：本节只记录工程落地与字段能力；第 1–9 节历史实测表与 6,902 分解保持不变。
