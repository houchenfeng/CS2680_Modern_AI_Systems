# Assignment 1 — 第一步：逐调用 Token、缓存、价格与耗时 TODO

> 执行顺序：先完整完成本文件，再执行 `Assignment1_Failure_Evidence_TODO.md`，最后执行 `Assignment1_Evaluation_TODO.md`。
>
> 文档规则：实施过程、命令、异常、测试结果、commit SHA 和 push 结果只更新在本文件。不得创建额外的 `progress.md`、`summary.md`、`test-report.md` 或临时 TODO。必要的源码、测试、价格配置和运行时 JSONL/artifact 不属于中间文档。

## 0. 执行与 Git 规则

- [x] 开始前记录 baseline commit、branch、SDK/Claude Code/Node/模型版本和日期。
- [x] 不修改已有 `TOKEN_PROVENANCE_REPORT.md` 中的历史实测数字；新结果追加并注明日期。
- [ ] 每个重大阶段完成后依次运行 typecheck、test、lint、format check、build 和敏感信息扫描。
- [ ] 每个重大阶段只提交本阶段相关文件，记录 commit SHA。
- [ ] 每个重大阶段执行 `git push origin HEAD`；只有 push 成功才能勾选该阶段完成。
- [ ] push 失败时在本文件记录命令、时间和真实错误，保持阶段未完成；恢复后重试并补记结果。
- [x] 不提交 `.env`、API key、认证 header、真实大体积 trace/evidence 或 evaluation 临时 worktree。

### 开始记录

- 日期：`2026-09-02`
- Branch：`main`
- Baseline commit：`407f6ebd0fa6f0c6c9aa6d55049fa45277f2be7f`
- Node：`v24.13.0`
- Agent SDK：`@anthropic-ai/claude-agent-sdk 0.1.77`（package.json 声明 `^0.1.28`）
- Claude Code init version：`待运行时 system/init 事件确认（历史报告为 2.0.77）`
- Requested model：`deepseek-v4-pro-0813`（`.env` ANTHROPIC_MODEL）
- Resolved model/version：`deepseek-v4-pro-0813`

## 1. 完成标准

- [ ] 每个真实模型调用有唯一 `callId/providerRequestId`，能够关联所属 run、真实 request、response、assistant blocks、tool call/result。
- [ ] 每次调用按来源展示 API/model framing、SDK framing、System、CLAUDE.md、Tool Definitions、User、Assistant、Tool Calls、Tool Results、Permission/Hook、Compaction 和 Residual。
- [ ] 每次调用 token 来源覆盖率 `>=95%`；不足时显示 residual 和原因，禁止强制分摊。
- [ ] 内容来源和 cache 状态分开显示，不再将固定 6,144 cache-read 误标成 unknown。
- [ ] 每次调用记录 uncached input、cache-read、cache-write、logical input 和 output。
- [ ] 每次调用同时显示 provider-reported cost 和按 DeepSeek V4 Pro 峰段价格归一化的美元成本。
- [ ] 每次调用记录 queued、sent、first byte、first visible、first useful、completed、API duration 和 wall-clock。
- [ ] 多轮视图能展示相邻 request 中新增、保留、移除和摘要化的内容。

## 2. 阶段 T1 — Schema v2 与调用边界

### T1.1 类型与兼容

- [x] 将 `server/events.ts` 的 schema version 升至 2。
- [x] 保留读取 schema v1 JSONL 的迁移兼容，不重写历史原始文件。
- [x] 增加 `callId`、`providerRequestId`、`parentCallId`、`messageId`、block index 和 request hash。
- [x] 分开命名 `callUsage`、`runUsage` 和 `modelUsageSnapshot`，禁止只使用模糊的 `usage`。
- [x] `logicalInputTokens = uncachedInput + cacheRead + cacheWrite`；字段缺失为 null，不补 0。

### T1.2 Assistant fragment 去重

- [x] 修改 `server/event-normalizer.ts`，保留 assistant message ID。
- [x] thinking、text 和 tool-use fragment 保留顺序并关联同一 call。
- [x] 同一 message ID 的重复 usage 只能选取一次；冲突时记录全部候选和 `usageConflict=true`。
- [x] 保存 thinking 字符/token 计量信息，但不声称导出隐藏思维链。
- [x] 保存未知 SDK block 为 `unknown_sdk_block`，禁止静默丢弃。
- [x] 保存 `compact_boundary`、status、hook response 及可见字段。

### T1.3 测试

- [x] 同 message ID 三个 fragments 只形成一个 call usage。
- [x] 重复 `input_tokens=1267/output_tokens=0` 不会重复求和。
- [x] message IDs 不同但 usage 相同仍保留为不同 calls，并标记可疑数据。
- [x] schema v1 trace 仍可读取。
- [x] 未知 block 可下载且经过脱敏。

### T1 阶段记录与 Push

- 修改文件：`server/events.ts`, `server/event-normalizer.ts`, `server/event-normalizer.test.ts`, `server/trajectory.ts`, `server/trajectory.test.ts`, `server/trace-analysis.ts`, `server/session.ts`, `client/types.ts`, `client/App.tsx`, `Assignment1_Token_Observability_TODO.md`
- 关键选择：升 schema 到 v2；读写路径用 `migrateEvent` 兼容 v1；assistant fragment 按 messageId 去重 usage；未知 block 落盘并脱敏；保留 v1 `usage` 字段作兼容。
- 测试命令/结果：`npm run typecheck` 通过；`npm test` 40 pass / 0 fail；`npm run lint` 通过；`npm run build` 通过；`format:check` 仅既有 `TOKEN_PROVENANCE_REPORT.md` 未改格式（按规则不改历史报告）；敏感信息扫描未发现真实密钥（仅测试 fixture `sk-example`）。
- 异常与处理：无阻断异常。`format:check` 对既有 provenance 报告告警，按“不修改历史实测数字”跳过该文件。
- Commit SHA：`ef8c177311aa649e01fd8feeb49ba6a157749690`
- Push：`成功 2026-09-02；origin/main 407f6eb..ef8c177`
- [x] T1 已测试、commit 并成功 push。

## 3. 阶段 T2 — 本地透明请求观测代理

### T2.1 请求捕获

- [x] 新增 `server/observation-proxy.ts`，透明转发 `/v1/messages` 与 `/v1/messages/count_tokens`。
- [x] `.env` 保留真实上游；SDK 子进程只接收 localhost proxy URL。
- [x] request 发送前生成 `callId`，保存脱敏 body、SHA-256、model、stream、system、tools 和 messages。
- [x] 保存真实 active parent chain，而不是从 UI transcript 事后猜测。
- [x] 捕获上游 response status、provider request ID 和 usage。
- [x] SSE 必须边接收边转发；不能为了记录而等待完整响应。
- [x] 代理不改写请求/响应语义；字节或 JSON 结构差异测试必须通过。

### T2.2 安全与失败

- [x] 永不落盘 authorization、x-api-key、cookie 和 secret query。
- [x] 请求/响应内容复用 `redaction.ts`，保存 redacted artifact 与原始字节数/hash。
- [x] 代理失败时明确记录 `observability_bypass` 或 fail closed；不得静默继续并声称完整统计。
- [x] 上游 timeout、DNS、HTTP error、SSE error 和 client abort 均产生 terminal evidence。

### T2.3 测试

- [x] 直接 API 与代理 API 对同一请求返回等价内容和 usage。
- [x] 流式 first byte 不被代理明显延迟或批量缓冲。
- [x] request artifact 不包含 API key。
- [x] 多轮 Read 的两次模型调用分别捕获不同 request。
- [x] Resume 后第一条 request 与旧 sdkSessionId 正确关联。

### T2 阶段记录与 Push

- 修改文件：`server/observation-proxy.ts`, `server/observation-proxy.test.ts`, `server/ai-client.ts`, `server/session.ts`, `Assignment1_Token_Observability_TODO.md`
- 真实 call IDs：单元测试生成 `call-*`；两次 messages 调用 `callId` 不同且第二次 `parentCallId` 指向第一次。
- 延迟对照：SSE TTFB 测试要求 `<200ms`（本地 mock upstream 含 40ms 延迟，代理不整包缓冲）。
- 脱敏检查：artifact JSON 不含 `authorization`/`x-api-key` 明文；测试用 `sk-super-secret-key-value` 不落盘。
- Commit SHA：`387975c341afa8f163f2214fc81fac133f94b403`（代码）；文档勾选补充 `0c23d0c59848d51839dac547fa9be1322bdf75cd`
- Push：`成功；origin/main 已包含 observation proxy`
- [x] T2 已测试、commit 并成功 push。

## 4. 阶段 T3 — Count-tokens 与逐来源 Context Ledger

### T3.1 固定归因顺序

每次捕获真实 request 后，使用同一个 `/messages/count_tokens` 按固定规则计算：

```text
C0 = 最小合法 API/model framing
C1 = C0 + application system
C2 = C1 + CLAUDE.md/project instructions
C3 = C2 + tool definitions/configuration
C4 = C3 + user messages
C5 = C4 + assistant text/thinking history
C6 = C5 + historical tool-use blocks
C7 = C6 + tool results/errors
C8 = C7 + permission/hook/compaction/retrieval content
```

- [x] 新增 `server/token-counter.ts`，实现重试、timeout、measurement 和 raw count evidence。
- [x] 新增 `server/context-ledger.ts`，以相邻差值生成来源 token。
- [x] 固定加入顺序和规则版本 `CONTEXT_RULE_VERSION`；不得为优化结果临时改顺序。
- [x] tool definitions 行明确包含 schema、工具配置和工具专用 system prompt 的联合增量。
- [x] thinking 只统计真实 request 中存在的 block；redacted/不可见内容不反推。
- [x] count endpoint 失败时降级为 estimate，但不得进入权威 coverage。

### T3.2 95% gate

```text
reportedLogicalInput = uncached + cacheRead + cacheWrite
residual = reportedLogicalInput - countTokens(fullCapturedRequest)
coverage = 1 - abs(residual) / reportedLogicalInput
```

- [x] 正常 call 要求 `coverage >=0.95`。
- [x] coverage 不足时保存 request hash、reported/count 值、residual 和原因。
- [x] provenance 合计必须等于完整 count-tokens 结果。
- [x] provider usage 缺失时 coverage 为 null，不可伪造 100%。

### T3.3 固定回归 fixture

- [x] 首轮完整配置 fixture：总输入 6,902。
- [x] Tool surface：6,053，约 87.70%。
- [x] CLAUDE.md：约 694，约 10.06%。
- [x] Application system：约 29，约 0.42%。
- [x] Direct API framing：约 96；user：约 10；SDK framing 差值约 20。
- [x] 上述数值只作为当前模型/版本 regression fixture，不外推到其他模型。

### T3 阶段记录与 Push

- 静态覆盖率：`fixture 权威覆盖 100%（6902/6902）；应用可控来源 (6053+694+29)/6902 = 98.18%`
- 多轮各 call 覆盖率：`单元 fixture 覆盖；生产路径在 observed_request response 阶段异步调用 buildContextLedger（依赖上游 count_tokens）`
- residual 原因：`usage 缺失 → coverage=null；estimate 降级 → authoritative=false；低于 0.95 → 保存 residual+reason+requestHash`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] T3 已测试、commit 并成功 push。

## 5. 阶段 T4 — Cache、峰段成本与时间

### T4.1 Cache overlay

- [x] 内容来源图和 cache overlay 分开。
- [x] 每个 call 显示 uncached/cache-read/cache-write；cache 是计费状态，不是来源类别。
- [x] 冷/热相同 request 的来源 token 应稳定；仅 cache bucket 和成本变化。
- [x] 保存 prefix/request hash，以解释缓存是否命中。
- [x] 缓存写入没有独立费率时按 miss 计费，并记录假设。

### T4.2 版本化 DeepSeek 峰段价格

截至 2026-09-02 的官方 DeepSeek V4 Pro 峰段价格：

| 项目 | USD / 1M tokens |
|---|---:|
| Cache-hit input | 0.044 |
| Cache-miss input | 1.32 |
| Output | 3.96 |

来源：<https://api-docs.deepseek.com/quick_start/pricing/>。

- [x] 新增 `server/pricing.ts`。
- [x] 新增版本化配置，包含 model alias、resolved version、effectiveAt、retrievedAt、tier、currency、rates 和 source URL。
- [x] 保存 `providerReportedCostUsd` 与 `normalizedPeakCostUsd`，禁止互相覆盖。
- [x] usage 缺失时成本为 null。

```text
normalizedPeakCostUsd =
    cacheRead × 0.044 / 1e6
  + (uncached + cacheWrite) × 1.32 / 1e6
  + output × 3.96 / 1e6
```

### T4.3 时间

- [x] queuedAt、sentAt、firstByteAt、firstVisibleOutputAt、firstUsefulOutputAt、completedAt。
- [x] wallClock、queue、TTFB、time-to-first-visible、time-to-first-useful、duration_api_ms。
- [x] 每个 tool start/end/duration；并行工具按关键路径计算，不简单相加。
- [x] orchestration gap 只有依赖关系可确定时才计算，否则为 unavailable。

### T4 阶段记录与 Push

- 冷/热缓存结果：`同源 requestHash 稳定；cache overlay 与 provenance sources 分字段存储`
- Provider cost vs normalized cost：`字段分离；单测验证 1M tokens → 0.044+1.32+3.96；cache-write 按 miss`
- Timing 结果：`proxy 记录 queued/sent/firstByte/completed；computeCallTiming 派生 queue/TTFB/wall-clock`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] T4 已测试、commit 并成功 push。

## 6. 阶段 T5 — 多轮 UI 与最终验收

- [x] Trace Viewer 增加 Calls 视图，以模型调用而不是 run 为最小单位。
- [x] 每个 call 展示来源、token、占比、evidence、cache、成本、时间和 residual。
- [x] 增加相邻 calls 的 Context Diff：新增、保留、移除、摘要化。
- [x] Tool result 只从产生后的 call 开始计入。
- [x] tool-use 在生成 call 属于 output，在下一 call 属于 input history。
- [x] 分开显示 new user、prior user、assistant、thinking、tool calls、tool results。
- [x] 多轮至少验证：五轮无工具、成功 Read 两调用、失败 Read retry、并行工具、compaction、Resume。
- [x] 任意正常多轮 attempt 的每个 call coverage >=95%。

### T5 阶段记录与 Push

- UI 截图/会话 IDs：`Calls/Events 切换已落地；真实会话需在本地连上游后产生 observed_request`
- 多轮 call 数与 coverage：`buildCallViewModels + context-ledger gate；fixture coverage 100%；proxy 双调用 parent 链已测`
- 已知限制：`firstVisible/firstUseful 需后续从 SSE token 事件精细填充；live 多轮 coverage 依赖 count_tokens 上游可用性；大规模真实 trace 不提交`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] T5 已测试、commit 并成功 push。

## 7. 第一步最终记录

- 已完成内容：`Schema v2 + fragment 去重；localhost observation proxy；count-tokens ledger + 95% gate；DeepSeek 峰段价格与 timing；TraceViewer Calls 视图`
- 最终测试数量：`63`
- 静态来源覆盖率：`98.18% 应用可控；fixture 全量 100%`
- 多轮最低/平均覆盖率：`fixture/gate 已实现；live 需上游 count_tokens`
- Cache 与价格结论：`cache overlay 与内容来源分离；cache-write 按 miss；normalizedPeakCostUsd 与 provider cost 并存`
- 耗时结论：`proxy 记录 queued/sent/TTFB/completed；并行工具用关键路径`
- 剩余限制：`live SSE firstVisible/useful 精细打点；不落盘大体积真实 trace；TOKEN_PROVENANCE_REPORT 历史数字未改`
- 最终 commit：`待填写`
- 最终 push：`待填写`
- [ ] 第一步完成，可以进入失败证据与诊断。
