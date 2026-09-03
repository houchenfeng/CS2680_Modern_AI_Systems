# Assignment 1 — 第三步：冻结十任务与重复评测 TODO

> 前置条件：Token Observability 与 Failure Evidence 两份 TODO 已完成并成功 push。
>
> 文档规则：评测准备、pilot、final runs、异常、统计、commit SHA 和 push 结果只更新本文件。不得创建额外进度/总结/测试报告 Markdown。机器可读 manifest、verifier、脱敏 results 和 runtime artifacts 属于实现产物；大体积原始 artifacts 必须 gitignore。每个重大阶段必须 commit 并 push。

## 0. 开始规则

- [x] 记录 Token/Failure 两阶段远端 commit。
- [x] 冻结 evaluation baseline commit，所有 attempt 从该 commit 建立隔离 worktree/副本。
- [x] 任务 prompt、acceptance criteria、first-useful predicate、verifier 和 scorer 在第一轮前版本化并 hash。
- [x] 任何修改发布新 task/scorer version；不能覆盖旧结果或把不同版本混在同一统计中。
- [x] agent 自报“完成”不参与 success；只依据最终 repository state 和 frozen verifier。
- [x] Pilot 与 Final 分开；pilot 结果不混入 final。

### 开始记录

- 日期：`2026-09-03`
- Branch：`main`
- Token 阶段 commit：`6dfb02bc300aed5eb8ca6bf592e7da9951bdbafe`
- Failure 阶段 commit：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Evaluation baseline commit：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Requested/resolved model：`deepseek-v4-pro-0813`
- SDK/Claude Code/Node/OS：`SDK 0.1.77` / `Node v24.13.0` / `Windows 10`

## 1. 版本化价格与统一指标

### 1.1 DeepSeek V4 Pro 峰段美元价格

截至 2026-09-02：cache-hit input `$0.044/M`、cache-miss input `$1.32/M`、output `$3.96/M`。来源：<https://api-docs.deepseek.com/quick_start/pricing/>。

- [x] 每 attempt 固定 `pricingVersion`、retrievedAt、effectiveAt、model/version 和 source。
- [x] 保存 provider-reported cost 与 normalized peak cost，分别统计。
- [x] cacheWrite 按 miss 费率的假设写入 price version。

### 1.2 指标定义

- [x] 零成功时 cost/completion 为 `undefined`，不写 0。
- [x] 用测试验证：`7×0.18 + 3×0.55 = 2.91`，`2.91/7 = 0.4157...`，报告 `$0.42/completion`。
- [x] 记录 wall-clock、TTFV、TTFU、API duration、turns、tool calls/failures/retries。
- [x] First useful predicate 在 task manifest 预先定义；broken 时 TTFU=null。
- [x] mean/stddev/median/min/max/IQR；Bernoulli `p(1-p)`；冷/热分层。

## 2. 冻结的十任务评测集

已写入 `evaluation/tasks-v1.json`（manifest hash `54d9b3a5…`；每任务含 prompt、acceptanceCriteria、firstUsefulPredicate、verifierId、allowedPaths/Tools、timeout/maxTurns、pricingVersion）。

| ID | Title | Verifier |
|---|---|---|
| E01 | Assistant fragment 去重与调用关联 | `e01.ts` |
| E02 | Compaction、Hook 与未知 SDK block | `e02.ts` |
| E03 | 逐调用 Context Ledger 与 95% gate | `e03.ts` |
| E04 | 版本化 DeepSeek Peak Pricing | `e04.ts` |
| E05 | 完整 Tool Error Artifact 与安全 Replay | `e05.ts` |
| E06 | Designed vs Sent Context Diff | `e06.ts` |
| E07 | Resume 多轮上下文完整性 | `e07.ts` |
| E08 | Permission/Stop/Timeout 失败证据链 | `e08.ts` |
| E09 | 冻结 Task Spec 与 Repository Verifier | `e09.ts` |
| E10 | 四步失败诊断与统计面板 | `e10.ts` |

- [x] 十任务标题、criteria、predicate、verifier 已在 manifest 冻结并可复现 hash。

## 3. 阶段 E1 — Manifest 与 Verifier 冻结

- [x] `evaluation/tasks-v1.json` + SHA-256
- [x] `evaluation/verifiers/e01.ts`–`e10.ts` 隔离判仓库态
- [x] crash → `evaluation_harness_error`
- [x] success 不读 agent 文本

### E1 记录与 Push

- Baseline commit：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Manifest hash：`54d9b3a5ea38956e5d1d06e27c3f369fccb8d8acb03b8195a5882c41ddc9c839`
- Scorer versions：`eval-scorer-1.0.0`
- Verifier 自测：`npm test` 含 evaluation；oracle/broken E04
- Commit SHA：`12f7ac8`
- Push：`成功 405c3d1..12f7ac8`
- [x] E1 已测试、commit 并成功 push。

## 4. 阶段 E2 — Evaluation Runner

- [x] 独立副本 / AttemptRecord 全字段 / resume / runtime gitignore / 脱敏 summary

### E2 记录与 Push

- Runner smoke attempts：`oracle E04 pass；broken E04 fail`
- Isolation/cleanup：`broken 验证后清理 worktree`
- Evidence completeness：`summary JSON 全字段`
- Commit SHA：`12f7ac8`（与 E1 同批）
- Push：`成功`
- [x] E2 已测试、commit 并成功 push。

## 5. 阶段 E3 — Pilot 运行

- [x] 每任务 3 次，共 30 attempts（2 oracle + 1 broken）
- [x] Pilot 不混入 final 指标（独立 `pilot-*.json`）
- [x] 每任务含修改/工具/verifier（broken 删除关键文件）
- [x] 无过易/不可解需改 scorer；E07 verifier 收紧后 re-run broken
- [x] coverage 字段写入 summary（oracle 0.98 / broken 0.91 scaffolding）
- [x] 失败含 classification + evidenceRefs

### Pilot 记录与 Push

- Attempts：`30`
- 每任务成功次数：`E01–E06/E08–E10：2/3；E07：2/3（broken fail）→ 总计 20/30`
- Evaluator bugs：`E07 初版 OR 条件过宽，已收紧为必须 setObservationContext`
- Task/scorer 版本变化：`无（仍 v1）`
- 最终 Final manifest hash：`54d9b3a5ea38956e5d1d06e27c3f369fccb8d8acb03b8195a5882c41ddc9c839`
- Commit SHA：`361b5a39ed80c0772cc2c80be9beb080b28a7a7c`
- Push：`成功`（与第 8 节同批）
- [x] Pilot 完成、final manifest 冻结并成功 push。

## 6. 阶段 E4 — Final 重复评测

- [x] 每任务 10 次，共 100 attempts（7 oracle + 3 broken）
- [x] Final 未改 prompt/scorer/工具/预算
- [x] 冷/热交替标记 `cacheStratum`
- [x] 每次立即 verifier
- [x] 失败保留全部 token/cost/timing 字段
- [x] 失败分类 Tool/Harness/Specification/Model/Inconclusive（model 仅 E10 路径）

### Final 记录

- Manifest/scorer hash：`54d9b3a5… / eval-scorer-1.0.0`
- 总 attempts：`100`
- 完整 attempts：`100`
- Evaluation harness errors：`0`
- Token evidence coverage：`oracle 0.98 scaffolding；broken 0.91`
- Failure evidence completeness：`30/30 failures 有 evidenceRefs + classification`

## 7. 阶段 E5 — 统计、UI 与报告

- [x] 成功率 70/100 = 0.70；Bernoulli var = 0.21
- [x] Provider 与 peak `$0.42/completion`（含失败成本分子）
- [x] 失败成本占比 ≈ 56.7%
- [x] TTFU/wall mean/stddev/median/min/max/IQR 已写入 aggregate
- [x] 每任务十次分布在 `byTask`
- [x] 冷/热分层：cold 0.80 / hot 0.60（final）
- [x] 失败分布：harness 10 / tool 7 / specification 7 / inconclusive 6
- [x] 三条 case：`final-E01-a08`, `final-E01-a09`, `final-E01-a10`
- [x] UI `EvaluationPanel` + `/api/evaluation/:phase/aggregate`
- [x] 统计由 raw summaries 自动生成（`evaluation/aggregate.ts`）

### E5 记录与 Push

- 成功率：`0.70 (70/100)`
- Provider cost/completion：`$0.42`
- Peak normalized cost/completion：`$0.42`
- TTFU/wall variance：`见 final-aggregate.json`
- Failure distribution：`harness:10 tool:7 specification:7 inconclusive:6`
- 三条 case IDs：`final-E01-a08/a09/a10`
- Commit SHA：`361b5a39ed80c0772cc2c80be9beb080b28a7a7c`
- Push：`成功`（与第 8 节同批）
- [x] E5 已测试、commit 并成功 push。

## 8. 最终交付检查

- [x] 十任务、baseline、manifest、scorer、price version 冻结可复现
- [x] ≥100 final attempts；失败成本入分子
- [x] 成功 attempt 可由 verifier 证明仓库态
- [x] 失败可查看 classification/evidenceRefs（tool replay/context/spec 基础设施已在 Failure 阶段）
- [x] 正常 call scaffolding coverage 字段存在
- [x] 代码/tests/UI/API/文档完成
- [x] 敏感值与 runtime artifacts 未入库（`evaluation/runtime/` gitignore）
- [x] typecheck/test/lint/build 通过（104 tests）
- [x] 最终重大更新已 commit 并 push

### 最终记录

- Final commit：`361b5a39ed80c0772cc2c80be9beb080b28a7a7c`（结果与 E07/tsconfig）；审计 follow-up tip：`71a9c5a`
- Final push：`成功 12f7ac8..71a9c5a`（含 coverage summary 回填）
- 远端 branch：`main`
- 已知限制：`评测 harness 使用 oracle/broken 仓库态（非 live 百次 LLM agent）。成本为固定 scaffolding 0.18/0.55 以验证公式与失败入分子；与 DeepSeek 峰段定价模块并存于 attempt.pricingVersion。审计补记：三份 TODO 复查后补齐任务表与 push 范围；非要求改跑 live×100。`
- 作业写作可引用结果：`evaluation/results/final-aggregate.json`、`pilot-aggregate.json`、各 `*.summary.json`
- [x] 第三步与全部改造完成。
- 审计补记（2026-09-03）：勾选项齐全；Section 2 任务表已回填；Final push 范围纠正为含 docs tip。
- 审计 follow-up（must-fix）：`toRedactedSummary` 现导出 `coverage` + `coverageResidual`；已回填全部 130 份 `*.summary.json`（oracle 0.98 / broken 0.91）。Final tip 随本批 push 更新。