# Assignment 1 — 第三步：冻结十任务与重复评测 TODO

> 前置条件：Token Observability 与 Failure Evidence 两份 TODO 已完成并成功 push。
>
> 文档规则：评测准备、pilot、final runs、异常、统计、commit SHA 和 push 结果只更新本文件。不得创建额外进度/总结/测试报告 Markdown。机器可读 manifest、verifier、脱敏 results 和 runtime artifacts 属于实现产物；大体积原始 artifacts 必须 gitignore。每个重大阶段必须 commit 并 push。

## 0. 开始规则

- [ ] 记录 Token/Failure 两阶段远端 commit。
- [ ] 冻结 evaluation baseline commit，所有 attempt 从该 commit 建立隔离 worktree/副本。
- [ ] 任务 prompt、acceptance criteria、first-useful predicate、verifier 和 scorer 在第一轮前版本化并 hash。
- [ ] 任何修改发布新 task/scorer version；不能覆盖旧结果或把不同版本混在同一统计中。
- [ ] agent 自报“完成”不参与 success；只依据最终 repository state 和 frozen verifier。
- [ ] Pilot 与 Final 分开；pilot 结果不混入 final。

### 开始记录

- 日期：`待填写`
- Branch：`待填写`
- Token 阶段 commit：`待填写`
- Failure 阶段 commit：`待填写`
- Evaluation baseline commit：`待填写`
- Requested/resolved model：`待填写`
- SDK/Claude Code/Node/OS：`待填写`

## 1. 版本化价格与统一指标

### 1.1 DeepSeek V4 Pro 峰段美元价格

截至 2026-09-02：cache-hit input `$0.044/M`、cache-miss input `$1.32/M`、output `$3.96/M`。来源：<https://api-docs.deepseek.com/quick_start/pricing/>。

- [ ] 每 attempt 固定 `pricingVersion`、retrievedAt、effectiveAt、model/version 和 source。
- [ ] 保存 provider-reported cost 与 normalized peak cost，分别统计。
- [ ] cacheWrite 按 miss 费率的假设写入 price version。

### 1.2 指标定义

```text
success_rate = successes / attempts

cost_per_completed_task = sum(cost of all attempts, including failures)
                          / successes
```

- [ ] 零成功时 cost/completion 为 `undefined`，不写 0。
- [ ] 用测试验证：`7×0.18 + 3×0.55 = 2.91`，`2.91/7 = 0.4157...`，报告 `$0.42/completion`。
- [ ] 记录 wall-clock、time-to-first-visible、time-to-first-useful、API duration、turns、tool calls/failures/retries。
- [ ] First useful predicate 必须在 task manifest 中预先定义；未产生时为 null。
- [ ] 成本、wall-clock、TTFU 报 mean、sample stddev、median、min/max；长尾加 IQR。
- [ ] 成功率保留每次 0/1，并报告 Bernoulli 方差 `p(1-p)`。
- [ ] 冷/热 cache 分层，避免混杂。

## 2. 冻结的十任务评测集

每项都是基于当前项目真实模块的稍复杂 coding task，要求检查文件、修改代码、运行工具并可能从错误恢复。每个任务独立从 baseline 开始，不能串联前一任务的修改。

### E01 — Assistant fragment 去重与调用关联

**冻结 prompt：** 修改事件规范化和 trace 分析，使同一 SDK assistant message ID 的 thinking、text、tool-use fragments 关联同一 callId，usage 不重复求和。保留 block 顺序，并增加重复 usage 与 output=0 测试。

- 允许路径：`server/events.ts`、`event-normalizer.ts`、`trace-analysis.ts`、对应 tests。
- 成功标准：同 message ID 多 fragment 只有一个 call usage；block 不丢；现有测试通过。
- Hidden verifier：三个 fragment fixture，检查 calls=1、usage 不翻倍、blocks=3。
- First useful：首次修改允许模块且该修改保留在最终通过 diff。

### E02 — Compaction、Hook 与未知 SDK block

**冻结 prompt：** 记录 `compact_boundary`、`hook_response`、status 和未知 SDK block；未知内容必须经过脱敏并可下载，不能静默丢弃。

- 成功标准：pre_tokens、hook stdout/stderr/exit、status、unknown artifact 可恢复。
- Verifier：合成 SDK messages、JSONL 字段与敏感值扫描。
- First useful：第一个新增事件类型通过测试。

### E03 — 逐调用 Context Ledger 与 95% gate

**冻结 prompt：** 实现纯函数 Context Ledger，输入 captured request、count-tokens 与 provider usage，输出固定类别、占比、coverage、residual 和 measurement；低于 95% 警告。

- 成功标准：6,902 fixture 得到工具 6,053、CLAUDE.md 694、system 29；cache 不作为来源。
- Verifier：count failure、负 residual、estimated 降级和规则版本。
- First useful：fixture 首次 coverage >=0.95。

### E04 — 版本化 DeepSeek Peak Pricing

**冻结 prompt：** 新增版本化价格表与成本模块，分别保存 provider cost 和 V4 Pro peak normalized cost。

- 成功标准：正确使用 0.044/1.32/3.96 USD/M；历史版本不漂移。
- Verifier：固定 token fixture 精确至 1e-9 USD；缺失 usage 返回 null。
- First useful：第一个 pricing test 通过。

### E05 — 完整 Tool Error Artifact 与安全 Replay

**冻结 prompt：** 当前 UI 会截断长输出。实现完整脱敏 artifact 存储，并为 Read 增加 agent 外安全 replay 和 ground-truth diff。

- 成功标准：64KB+ error 可按 hash 取回；UI 仍折叠；replay 不修改用户工作树。
- Verifier：成功 Read、missing file、permission error、长 stderr。
- First useful：missing-file artifact 首次 hash 校验通过。

### E06 — Designed vs Sent Context Diff

**冻结 prompt：** 比较 designed transcript 与透明代理 sent transcript，检测 missing、unexpected、reordered、truncated、wrong-parent 和 wrong-tool-result-pair。

- 成功标准：六类隐藏 fixture 全识别；相同时为空 diff。
- Verifier：含 retrieval miss 和 resume wrong-parent。
- First useful：第一个 missing block 被准确定位。

### E07 — Resume 多轮上下文完整性

**冻结 prompt：** 新增集成测试：两轮对话、工具读取、后端重启、SDK Resume、第三轮依赖第一轮工具结果；验证恢复后真实 request parent chain。

- 成功标准：关键事实或合法 summary 存在；消息不重复；cwd/session 正确。
- Verifier：request hash、sdkSessionId、toolUseId/result 和最终 ground truth。
- First useful：Resume 后捕获第一条正确关联 request。

### E08 — Permission/Stop/Timeout 失败证据链

**冻结 prompt：** 完整记录 Allow、Deny、Timeout、Disconnect、Stop 和迟到 callback；每个 pending tool 最终只有一个 terminal permission result。

- 成功标准：所有分支有 IDs/reason/timing；完成 run 不回到 waiting。
- Verifier：两个并发审批及 allow/timeout/disconnect/stop 状态机。
- First useful：首个 terminal permission 与 request 正确配对。

### E09 — 冻结 Task Spec 与 Repository Verifier

**冻结 prompt：** 实现 task manifest、isolated attempt runner 和独立 repository verifier。成功由文件、hash、tests 和 git diff 判断，不能读取 agent 的完成声明。

- 成功标准：prompt/spec/scorer/version 运行前 hash；输出 verifier JSON。
- Verifier：真成功、agent 假完成、修改禁止路径，结果 pass/fail/fail。
- First useful：第一个 isolated verifier JSON 通过 schema。

### E10 — 四步失败诊断与统计面板

**冻结 prompt：** Trace Viewer 增加 Tool→Harness→Specification→Model 向导，并展示成功率、cost/completion、TTFU、方差和失败分类。

- 成功标准：tool fail 后 model 不可填写；每个结论有 evidenceRef；失败成本进入分子。
- Verifier：四类路径、inconclusive 和 7-success/3-failure 成本 fixture。
- First useful：第一条完整 diagnosis record 通过 schema。

## 3. 阶段 E1 — Manifest 与 Verifier 冻结

- [ ] 新增 `evaluation/tasks-v1.json`，包含上述完整 prompt、taskVersion、baselineCommit、allowed/forbiddenPaths、allowedTools、timeout、maxTurns、firstUsefulPredicate、acceptanceCriteria、verifierCommand、scorerVersion。
- [ ] manifest 计算 SHA-256；所有 v1 attempts 引用相同 hash。
- [ ] 新增 `evaluation/verifiers/`，verifier 与 agent worktree 隔离。
- [ ] verifier crash 标 `evaluation_harness_error`，不算 agent failure。
- [ ] 保存 `git status --porcelain=v2`、binary diff、文件 SHA、tests/typecheck/build stdout/stderr/exit。
- [ ] 检查禁止路径、越界副作用、删除 fixture 和多余生成文件。
- [ ] agent 最终文本只作 trace，不参与 success。

### E1 记录与 Push

- Baseline commit：`待填写`
- Manifest hash：`待填写`
- Scorer versions：`待填写`
- Verifier 自测：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] E1 已测试、commit 并成功 push。

## 4. 阶段 E2 — Evaluation Runner

- [ ] 新增 runner，为每 attempt 创建独立 worktree/临时完整副本。
- [ ] 运行前检查 clean baseline、HEAD、lockfile hash、Node/OS/SDK/Claude Code/model/date。
- [ ] 固定模型参数、工具、permission、maxTurns、timeout 和预算。
- [ ] 收集逐 call token provenance/cache/cost/timing。
- [ ] 收集完整失败证据和 terminal status。
- [ ] agent 结束后运行 frozen verifier，再归档 diff/evidence，最后清理 workspace。
- [ ] runtime results 默认 gitignore；只提交脱敏 machine-readable summary。
- [ ] 支持中断后 resume runner，但 attempt identity 不变且记录 interruption。

### Attempt 必须字段

- task/version/manifestHash/scorerVersion/attemptId。
- run/chat/sdkSession/call IDs。
- baseline/final diff/hash/verifier result。
- model requested/resolved/version、SDK、Claude Code、UTC date/timezone。
- call token 来源、cache、coverage/residual、output。
- provider/normalized peak costs 与 price version。
- wall、TTFB、first-visible、TTFU、API/tool/orchestration timing。
- turns/tool calls/errors/retries/permissions。
- failure classification/confidence/evidenceRefs。

### E2 记录与 Push

- Runner smoke attempts：`待填写`
- Isolation/cleanup：`待填写`
- Evidence completeness：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] E2 已测试、commit 并成功 push。

## 5. 阶段 E3 — Pilot 运行

- [ ] 每任务 3 次，共 30 attempts。
- [ ] Pilot 只验证难度、runner、verifier 和记录完整性，不进入 final 指标。
- [ ] 每个 task 至少包含一次文件/代码修改、一次工具调用和 verifier。
- [ ] 检查是否有过易/不可解/规格歧义任务。
- [ ] 只因 evaluator bug 修改 verifier；任何 task/scorer 修改发布新版本并重新开始 pilot。
- [ ] 检查每次正常 call provenance coverage >=95%。
- [ ] 检查失败是否具备 tool replay、context diff、spec snapshot 和 terminal evidence。

### Pilot 记录与 Push

- Attempts：`待填写`
- 每任务成功次数：`待填写`
- Evaluator bugs：`待填写`
- Task/scorer 版本变化：`待填写`
- 最终 Final manifest hash：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] Pilot 完成、final manifest 冻结并成功 push。

## 6. 阶段 E4 — Final 重复评测

- [ ] 每任务至少 10 次，共至少 100 attempts。
- [ ] Final 中不修改 prompt、criterion、scorer、工具或预算。
- [ ] 同任务 attempts 按相同冷/热缓存策略运行并标记 cache stratum。
- [ ] 每次运行后立即 verifier，不批量依赖 agent 自报。
- [ ] 失败也保留全部 token、成本和耗时。
- [ ] 每个失败按 Tool→Harness→Specification→Model 分类；无足够证据则 inconclusive。
- [ ] 发现 evaluator 故障时暂停 final，修复后发布新 version；受影响 attempts 不混入新版本。

### Final 记录

- Manifest/scorer hash：`待填写`
- 总 attempts：`待填写`
- 完整 attempts：`待填写`
- Evaluation harness errors：`待填写`
- Token evidence coverage：`待填写`
- Failure evidence completeness：`待填写`

## 7. 阶段 E5 — 统计、UI 与报告

- [ ] 每任务与总体成功率：successes/attempts。
- [ ] Provider cost/completion 与 normalized peak cost/completion。
- [ ] 失败 attempts 占总成本比例。
- [ ] TTFU、wall-clock、cost、turns、tool failures 的 mean/stddev/median/min/max/IQR。
- [ ] 同任务十次分布单独显示，不只给总体均值。
- [ ] 冷/热 cache 分层统计。
- [ ] Tool/Harness/Specification/Model/Inconclusive 次数、成本、平均发现轮次和证据完整率。
- [ ] 选择至少三条 substantive failures 写完整证据 case study。
- [ ] UI 结果可追溯到 task manifest、attempt、calls、verifier、diagnosis 和 artifacts。
- [ ] 所有统计由 raw attempt summaries 自动生成，禁止手工修改数字。

### E5 记录与 Push

- 成功率：`待填写`
- Provider cost/completion：`待填写`
- Peak normalized cost/completion：`待填写`
- TTFU/wall variance：`待填写`
- Failure distribution：`待填写`
- 三条 case IDs：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] E5 已测试、commit 并成功 push。

## 8. 最终交付检查

- [ ] 十任务、baseline、manifest、scorer 和 price version 全部冻结且可复现。
- [ ] 至少 100 个 final attempts，失败运行成本包含在成本分子。
- [ ] 任一成功 attempt 可从 verifier 证明最终仓库状态正确。
- [ ] 任一失败 attempt 可按顺序查看 tool replay、context diff、spec 和 model gate。
- [ ] 任一正常多轮 attempt 可逐 call 解释 >=95% 输入来源、cache、成本和耗时。
- [ ] 代码、tests、UI、API 和文档完成；不是只勾 TODO。
- [ ] 敏感值与大体积 artifacts 未进入 Git。
- [ ] 最终 typecheck/test/lint/format/build 和敏感扫描通过。
- [ ] 最终重大更新已 commit 并 `git push origin HEAD` 成功。

### 最终记录

- Final commit：`待填写`
- Final push：`待填写`
- 远端 branch：`待填写`
- 已知限制：`待填写`
- 作业写作可引用结果：`待填写`
- [ ] 第三步与全部改造完成。
