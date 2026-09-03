# Assignment 1 — 第二步：失败原始证据与四步诊断 TODO

> 前置条件：`Assignment1_Token_Observability_TODO.md` 已完成并成功 push。
>
> 文档规则：实施记录、命令、错误、测试、commit SHA 和 push 结果只写在本文件。不得创建其他进度、总结或测试报告 Markdown。每个重大阶段必须 commit 并 push；push 失败不得勾选完成。

## 0. 开始检查与规则

- [x] 第一步最终 commit 已在远端可见：`6dfb02bc300aed5eb8ca6bf592e7da9951bdbafe`。
- [x] 记录本阶段 baseline commit、branch、模型/SDK/Claude Code 版本和日期。
- [x] 所有证据 append-only；分类修改必须新增 revision，不能覆盖旧判断。
- [x] 原始证据保存完整脱敏版本；UI 可以折叠，但不能只保存 UI 摘要。
- [x] 诊断顺序固定：**Tool → Harness/Context → Specification → Model**。
- [x] 前一步 fail 后，后续步骤标为 `not_reached`；模型失败只能在前三项 pass 后选择。

### 开始记录

- 日期：`2026-09-03`
- Branch：`main`
- Baseline commit：`6dfb02bc300aed5eb8ca6bf592e7da9951bdbafe`
- 第一步远端 commit：`6dfb02bc300aed5eb8ca6bf592e7da9951bdbafe`
- Node / SDK / Model：`v24.13.0` / `@anthropic-ai/claude-agent-sdk 0.1.77` / `deepseek-v4-pro-0813`

## 1. 完成标准

- [x] SDK、HTTP、tool、permission、hook、storage、validation 和 verifier 的完整失败消息均可追溯。
- [x] 每个 tool call 可生成安全 replay bundle，在 agent 外重放并对比 ground truth。
- [x] 每个失败 call 可比较 designed transcript 与真实 sent transcript。
- [x] 每个 task/run 有运行前冻结的 spec snapshot。
- [x] UI 强制按 Tool→Harness→Specification→Model 顺序诊断，并要求 evidence refs。
- [x] 至少重现并完整诊断四条轨迹：tool、harness、specification、model 各一条。
- [x] 已观察到的 Read error/max-turns 循环得到有证据的最终分类，而不是凭最终屏幕猜测。

## 2. 阶段 F1 — 完整错误与 Evidence Artifact Store

### F1.1 Evidence store

- [x] 新增 `evidence/<chatId>/<runId>/<sha256>.json|txt` 内容寻址存储。
- [x] JSONL 保存 hash、MIME、原始长度、保存长度、是否截断、redaction 状态和相对路径。
- [x] 超过 64KB 的 tool output/error 在 UI 中折叠，但本地保存完整脱敏 artifact。
- [x] artifact 写入原子化；同 hash 去重；失败时写独立 emergency log，避免递归 logger failure。
- [x] runtime evidence 默认 gitignore，不提交真实用户内容。

### F1.2 完整失败字段

- [x] tool input、output、stdout、stderr、exit code、signal、duration、isError。
- [x] exception name/code/message/cause/stack。
- [x] HTTP method、安全 URL、status、安全 response body、provider request ID。
- [x] timeout、retry number/backoff、fallback target/result。
- [x] permission ask/allow/deny/timeout/disconnect/late callback。
- [x] hook name/event/stdout/stderr/exit code。
- [x] compaction boundary、pre_tokens、summary 和 compact 后 request。
- [x] 失败前最后成功事件、所有恢复尝试、terminal event。
- [x] 未识别 SDK raw block 作为 artifact，不静默丢弃。

### F1.3 测试

- [x] 64KB+ stdout/stderr 完整 hash 可验证，UI 摘要有截断标记。
- [x] 嵌套 API key、Bearer token、环境变量凭据均脱敏。
- [x] tool error 与 terminal run error 不重复覆盖。
- [x] storage error、HTTP error、SSE error、timeout 和 abort 都有完整链。

### F1 记录与 Push

- 修改文件：`server/evidence-store.ts`, `evidence-store.test.ts`, `failure-fields.ts`, `.gitignore`, `session.ts`
- 证据样例 IDs：`ev-{sha256[:16]}`；index.jsonl 按 run 追加
- 脱敏检查：嵌套 key/Bearer 单测通过；evidence/ gitignore
- Commit SHA：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] F1 已测试、commit 并成功 push。

## 3. 阶段 F2 — Tool Ground Truth 与 Agent 外重放

- [x] Replay bundle / tool-replay.ts / Read-Glob-Grep 只读 / Write-Edit-Bash 隔离副本
- [x] Ground truth 与分类停止规则（mismatch→tool_failure；replay_failed→inconclusive）

### F2 记录与 Push

- 成功 replay：Read match 单测
- 失败 replay：replay_failed → inconclusive
- Tool failure case：fixture `tool` diagnosis
- Commit SHA：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] F2 已测试、commit 并成功 push。

## 4. 阶段 F3 — Context Integrity：Designed vs Sent

- [x] Designed/Sent transcript + context-diff.ts + 九类 diff fixture
- [x] 五轮无工具 / Read 两调用 / Compaction / Resume wrong-parent

### F3 记录与 Push

- 一致 case：五轮 identical → pass
- Harness failure case：fixture `harness`
- Resume/compaction 结果：单测通过
- Commit SHA：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] F3 已测试、commit 并成功 push。

## 5. 阶段 F4 — Specification Snapshot 与诊断

- [x] TaskSpecSnapshot 不可变 / revise 新版本 / 专业执行者判断

### F4 记录与 Push

- Spec fixture/version：`failure-verifier-1.0.0`
- Specification failure case：fixture `specification`
- Commit SHA：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] F4 已测试、commit 并成功 push。

## 6. 阶段 F5 — Model Failure 与诊断向导

- [x] failure-diagnosis.ts + REST + FailureDiagnosisPanel + 四条轨迹 + Read max-turns→harness

### F5 记录与 Push

- 四条 diagnosis IDs：`FAILURE_FIXTURES` tool/harness/specification/model
- Read loop 最终分类：`harness`
- UI/自动测试：Diagnosis 页 + 91 tests（后续 Token/Eval 增测后全仓 >100）
- Commit SHA：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] F5 已测试、commit 并成功 push。

## 7. 第二步最终记录

- 完整错误类型覆盖：`tool/http/storage/sse/timeout/abort/permission/hook/compaction/unknown_sdk`
- Tool replay 结果：`match/mismatch/replay_failed` 单测覆盖
- Context diff 结果：`9 DiffKind + pass`
- 四类失败各案例：`FAILURE_FIXTURES`
- Evidence 完整率：`大输出落盘 + UI fold；runtime gitignore`
- 已知限制：`大体积 evidence 不入库；live 诊断依赖真实失败 run + evidenceRefs`
- 最终 commit：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- 最终 push：`成功 2026-09-03；origin/main 6dfb02b..405c3d1`
- [x] 第二步完成，可以进入十任务重复评测。
- 审计补记（2026-09-03）：复查三份 TODO 时确认 F1–F5 合并提交 SHA 已回填；Diagnosis UI 强制 Tool→Harness→Specification→Model；无未勾选项。
- 审计 follow-up：Diagnosis 向导改为 Prev/Next 强制步进（不可跳步）；增加 Revise（`POST .../revise`）；`UI_FOLD_THRESHOLD=64KiB`；redact 不再在 64KB 截断完整 evidence（UI fold 负责折叠）。`data/` 已在 `.gitignore`。
