# Assignment 1 — 第二步：失败原始证据与四步诊断 TODO

> 前置条件：`Assignment1_Token_Observability_TODO.md` 已完成并成功 push。
>
> 文档规则：实施记录、命令、错误、测试、commit SHA 和 push 结果只写在本文件。不得创建其他进度、总结或测试报告 Markdown。每个重大阶段必须 commit 并 push；push 失败不得勾选完成。

## 0. 开始检查与规则

- [ ] 第一步最终 commit 已在远端可见：`待填写`。
- [ ] 记录本阶段 baseline commit、branch、模型/SDK/Claude Code 版本和日期。
- [ ] 所有证据 append-only；分类修改必须新增 revision，不能覆盖旧判断。
- [ ] 原始证据保存完整脱敏版本；UI 可以折叠，但不能只保存 UI 摘要。
- [ ] 诊断顺序固定：**Tool → Harness/Context → Specification → Model**。
- [ ] 前一步 fail 后，后续步骤标为 `not_reached`；模型失败只能在前三项 pass 后选择。

### 开始记录

- 日期：`待填写`
- Branch：`待填写`
- Baseline commit：`待填写`
- 第一步远端 commit：`待填写`

## 1. 完成标准

- [ ] SDK、HTTP、tool、permission、hook、storage、validation 和 verifier 的完整失败消息均可追溯。
- [ ] 每个 tool call 可生成安全 replay bundle，在 agent 外重放并对比 ground truth。
- [ ] 每个失败 call 可比较 designed transcript 与真实 sent transcript。
- [ ] 每个 task/run 有运行前冻结的 spec snapshot。
- [ ] UI 强制按 Tool→Harness→Specification→Model 顺序诊断，并要求 evidence refs。
- [ ] 至少重现并完整诊断四条轨迹：tool、harness、specification、model 各一条。
- [ ] 已观察到的 Read error/max-turns 循环得到有证据的最终分类，而不是凭最终屏幕猜测。

## 2. 阶段 F1 — 完整错误与 Evidence Artifact Store

### F1.1 Evidence store

- [ ] 新增 `evidence/<chatId>/<runId>/<sha256>.json|txt` 内容寻址存储。
- [ ] JSONL 保存 hash、MIME、原始长度、保存长度、是否截断、redaction 状态和相对路径。
- [ ] 超过 64KB 的 tool output/error 在 UI 中折叠，但本地保存完整脱敏 artifact。
- [ ] artifact 写入原子化；同 hash 去重；失败时写独立 emergency log，避免递归 logger failure。
- [ ] runtime evidence 默认 gitignore，不提交真实用户内容。

### F1.2 完整失败字段

- [ ] tool input、output、stdout、stderr、exit code、signal、duration、isError。
- [ ] exception name/code/message/cause/stack。
- [ ] HTTP method、安全 URL、status、安全 response body、provider request ID。
- [ ] timeout、retry number/backoff、fallback target/result。
- [ ] permission ask/allow/deny/timeout/disconnect/late callback。
- [ ] hook name/event/stdout/stderr/exit code。
- [ ] compaction boundary、pre_tokens、summary 和 compact 后 request。
- [ ] 失败前最后成功事件、所有恢复尝试、terminal event。
- [ ] 未识别 SDK raw block 作为 artifact，不静默丢弃。

### F1.3 测试

- [ ] 64KB+ stdout/stderr 完整 hash 可验证，UI 摘要有截断标记。
- [ ] 嵌套 API key、Bearer token、环境变量凭据均脱敏。
- [ ] tool error 与 terminal run error 不重复覆盖。
- [ ] storage error、HTTP error、SSE error、timeout 和 abort 都有完整链。

### F1 记录与 Push

- 修改文件：`待填写`
- 证据样例 IDs：`待填写`
- 脱敏检查：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] F1 已测试、commit 并成功 push。

## 3. 阶段 F2 — Tool Ground Truth 与 Agent 外重放

诊断问题：**在 agent 外重放完全相同的工具调用，结果是否与实际情况相符？若不符则停止，不再追踪模型。**

### F2.1 Replay bundle

- [ ] 保存 tool name/version、完整脱敏 input、cwd、允许环境变量名称、fixture/repository hash、原 result hash 和时间。
- [ ] 新增 `server/tool-replay.ts` 与安全 replay API/CLI。
- [ ] Read/Glob/Grep 可在只读 sandbox 重放。
- [ ] Write/Edit/Bash 必须在该 attempt 的隔离副本重放，禁止作用于用户工作树。
- [ ] replay 产生新 evidence，不覆盖原事件。
- [ ] 保存 replay stdout/stderr/exit/status/duration/hash。

### F2.2 Ground truth

- [ ] Read：检查文件存在性、realpath、内容 hash、权限和读取范围。
- [ ] Glob/Grep：独立命令验证目标确实存在/不存在，记录工具版本。
- [ ] Bash：记录实际 cwd、shell、exit code 和副作用 diff。
- [ ] Write/Edit：验证目标文件最终 bytes/hash，而不是相信成功字符串。
- [ ] Web/Search：记录请求状态、时间、缓存/超时和独立查询结果；空成功结果必须区分“确实为空”和“没有执行”。

### F2.3 分类停止规则

- [ ] original tool result 与 replay/ground truth 不一致 → `tool_failure`。
- [ ] tool failure 记录差异 artifact，harness/spec/model 均标 `not_reached`。
- [ ] replay 本身失败 → `inconclusive`，不得直接归模型。

### F2 记录与 Push

- 成功 replay：`待填写`
- 失败 replay：`待填写`
- Tool failure case：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] F2 已测试、commit 并成功 push。

## 4. 阶段 F3 — Context Integrity：Designed vs Sent

诊断问题：**故障调用实际发送的 context 是否与会话本应累积的内容一致？**

### F3.1 Designed transcript

- [ ] 根据 user、assistant blocks、tool call/result、permission、hook、retrieval、compaction、resume 和 active parent rules 构造 designed transcript。
- [ ] 每个 block 包含 role、type、ID、parent、顺序、hash、bytes、tokens 和应保留/摘要/移除状态。
- [ ] 明确 tool result 与 tool-use ID 配对。
- [ ] retrieval 保存 query、候选集合、top-k、返回 doc IDs/version/hash。

### F3.2 Sent transcript

- [ ] 从第一步透明代理取得真实 outbound messages/system/tools。
- [ ] 保存 request hash 和 count-tokens 结果。
- [ ] Resume 后检查真实第一条 sent request，不以 UI transcript 代替。

### F3.3 Diff

- [ ] 新增 `server/context-diff.ts`。
- [ ] 分类 missing、unexpected、reordered、truncated、stale、wrong-parent、wrong-tool-result-pair、summary-loss、retrieval-miss。
- [ ] 完全一致时生成空 diff 与 `pass`，不是缺少记录。
- [ ] context diff fail → `harness_failure`，spec/model 标 `not_reached`。
- [ ] 检索目标存在但未返回属于 harness，而不是模型失败。

### F3.4 测试

- [ ] 上述九类 diff 各有 fixture。
- [ ] 五轮无工具 transcript 完全一致。
- [ ] Read 两调用：tool result 只在第二 request 出现。
- [ ] Compaction：旧历史被合法 summary 替代不误判 missing。
- [ ] Resume wrong-parent 能被识别。

### F3 记录与 Push

- 一致 case：`待填写`
- Harness failure case：`待填写`
- Resume/compaction 结果：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] F3 已测试、commit 并成功 push。

## 5. 阶段 F4 — Specification Snapshot 与诊断

诊断问题：**专业人类执行者只获得相同文字、没有其他信息时，是否一定会执行我们想要的操作？**

- [ ] 新增不可变 `TaskSpecSnapshot`：prompt、acceptance criteria、out-of-scope、allowed tools、budget、done condition、verifier/scorer version。
- [ ] run 开始前计算 spec hash；失败后不能修改同一 task version。
- [ ] 修改 prompt/criterion/scorer 必须发布新版本，旧结果保留。
- [ ] 诊断表列出明确要求、隐藏意图、歧义和至少两个合理解释。
- [ ] 冻结“专业执行者判断”规则；判断者不先看 agent 最终回答。
- [ ] 专业执行者无法从文字唯一得到预期行为 → `specification_failure`。
- [ ] specification failure 后 model 标 `not_reached`。

### F4 记录与 Push

- Spec fixture/version：`待填写`
- Specification failure case：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] F4 已测试、commit 并成功 push。

## 6. 阶段 F5 — Model Failure 与诊断向导

### F5.1 Model failure gate

只有以下全部成立才可选择 model：

- [ ] 工具 replay 与 ground truth 一致。
- [ ] designed 与 sent context 一致，必要资料存在且已检索。
- [ ] frozen specification 对专业执行者足够明确。
- [ ] 模型仍选择错误工具、生成不存在的符号、忽略明确约束或错误解释正确证据。
- [ ] 引用具体 callId、模型可见证据、错误 action 和 verifier failure。

### F5.2 Failure record

```ts
interface FailureDiagnosis {
  diagnosisId: string;
  taskId: string;
  attemptId: string;
  terminalFailureEventId: string;
  symptom: string;
  impact: string;
  toolCheck: { status: "pass"|"fail"|"not_applicable"; evidenceRefs: string[]; conclusion: string };
  contextCheck: { status: "pass"|"fail"; designedRef: string; sentRef: string; diffRef: string; conclusion: string };
  specificationCheck: { status: "pass"|"fail"; specHash: string; humanContractorAnswer: string; conclusion: string };
  modelCheck: { status: "pass"|"fail"|"not_reached"; callIds: string[]; conclusion: string };
  classification: "tool"|"harness"|"specification"|"model"|"inconclusive";
  confidence: "high"|"medium"|"low";
  evidenceRefs: string[];
}
```

- [ ] 新增 `server/failure-diagnosis.ts` 和 REST API。
- [ ] UI 新增 `FailureDiagnosisPanel.tsx`，强制顺序填写。
- [ ] 每个结论必须有 evidenceRef；无证据只能 inconclusive。
- [ ] 修改分类采用 append-only revision，保存旧分类、时间和新增证据。

### F5.3 四条验收轨迹

- [ ] Tool：工具错误/空成功与独立 replay 不一致。
- [ ] Harness：实际 sent transcript 缺少设计中应保留的约束或 retrieval。
- [ ] Specification：prompt 对专业执行者也有两个合理解释。
- [ ] Model：前三项全部 pass，模型仍做出 verifier 可证伪的动作。
- [ ] Read error/max-turns 历史 case 得到最终分类和完整证据。

### F5 记录与 Push

- 四条 diagnosis IDs：`待填写`
- Read loop 最终分类：`待填写`
- UI/自动测试：`待填写`
- Commit SHA：`待填写`
- Push：`待填写`
- [ ] F5 已测试、commit 并成功 push。

## 7. 第二步最终记录

- 完整错误类型覆盖：`待填写`
- Tool replay 结果：`待填写`
- Context diff 结果：`待填写`
- 四类失败各案例：`待填写`
- Evidence 完整率：`待填写`
- 已知限制：`待填写`
- 最终 commit：`待填写`
- 最终 push：`待填写`
- [ ] 第二步完成，可以进入十任务重复评测。
