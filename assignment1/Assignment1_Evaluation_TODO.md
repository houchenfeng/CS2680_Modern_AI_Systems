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

```text
success_rate = successes / attempts

cost_per_completed_task = sum(cost of all attempts, including failures)
                          / successes
```

- [x] 零成功时 cost/completion 为 `undefined`，不写 0。
- [x] 用测试验证：`7×0.18 + 3×0.55 = 2.91`，`2.91/7 = 0.4157...`，报告 `$0.42/completion`。
- [x] 记录 wall-clock、time-to-first-visible、time-to-first-useful、API duration、turns、tool calls/failures/retries。
- [x] First useful predicate 必须在 task manifest 中预先定义；未产生时为 null。
- [x] 成本、wall-clock、TTFU 报 mean、sample stddev、median、min/max；长尾加 IQR。
- [x] 成功率保留每次 0/1，并报告 Bernoulli 方差 `p(1-p)`。
- [x] 冷/热 cache 分层，避免混杂。

## 2. 冻结的十任务评测集

（E01–E10 定义见原文件；已写入 `evaluation/tasks-v1.json`。）

## 3. 阶段 E1 — Manifest 与 Verifier 冻结

- [x] 新增 `evaluation/tasks-v1.json`…
- [x] manifest 计算 SHA-256；所有 v1 attempts 引用相同 hash。
- [x] 新增 `evaluation/verifiers/`，verifier 与 agent worktree 隔离。
- [x] verifier crash 标 `evaluation_harness_error`，不算 agent failure。
- [x] 保存 git status / file SHA / checks。
- [x] 检查禁止路径等（verifier helpers）。
- [x] agent 最终文本只作 trace，不参与 success。

### E1 记录与 Push

- Baseline commit：`405c3d1d0a9e207eeed35a25d52021c16020ef57`
- Manifest hash：`54d9b3a5ea38956e5d1d06e27c3f369fccb8d8acb03b8195a5882c41ddc9c839`
- Scorer versions：`eval-scorer-1.0.0`
- Verifier 自测：`E01–E10 file/content checks；runner oracle/broken`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] E1 已测试、commit 并成功 push。

## 4. 阶段 E2 — Evaluation Runner

- [x] runner 独立副本 / clean baseline 检查 / 固定参数 / token&failure 字段 / verifier 后清理
- [x] runtime gitignore；脱敏 summary 可提交
- [x] resume runner

### E2 记录与 Push

- Runner smoke attempts：`oracle E04 pass；broken E04 fail`
- Isolation/cleanup：`broken worktree 验证后清理`
- Evidence completeness：`AttemptRecord 全字段 + redacted summary`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] E2 已测试、commit 并成功 push。

## 5. 阶段 E3 — Pilot 运行

- [ ] 每任务 3 次，共 30 attempts。
- [ ] Pilot 只验证难度、runner、verifier 和记录完整性，不进入 final 指标。
- [ ] …
### Pilot 记录与 Push

- Attempts：`待填写`
- 每任务成功次数：`待填写`
- Evaluator bugs：`待填写`
- Task/scorer 版本变化：`无（v1）`
- 最终 Final manifest hash：`54d9b3a5ea38956e5d1d06e27c3f369fccb8d8acb03b8195a5882c41ddc9c839`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] Pilot 完成、final manifest 冻结并成功 push。

## 6. 阶段 E4 — Final 重复评测

- [ ] 每任务至少 10 次，共至少 100 attempts。
…

### Final 记录

- Manifest/scorer hash：`待填写`
- 总 attempts：`待填写`
- 完整 attempts：`待填写`
- Evaluation harness errors：`待填写`
- Token evidence coverage：`待填写`
- Failure evidence completeness：`待填写`

## 7. 阶段 E5 — 统计、UI 与报告

- [ ] …
### E5 记录与 Push

- …
- [ ] E5 已测试、commit 并成功 push。

## 8. 最终交付检查

- [ ] …
### 最终记录

- Final commit：`待填写`
- Final push：`待填写`
- 远端 branch：`main`
- 已知限制：`Harness 使用 oracle/broken 仓库态评测（verifier 判终态）；非 live LLM 百次调用。成本用固定 scaffolding 费率 0.18/0.55 以验证 cost/completion 公式与失败成本入分子。`
- 作业写作可引用结果：`evaluation/results/*-aggregate.json`
- [ ] 第三步与全部改造完成。
