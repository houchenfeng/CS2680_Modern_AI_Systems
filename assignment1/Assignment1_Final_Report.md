# Assignment 1 Final Report / 最终报告  
## Trajectory Observability, Context Attribution, and Failure Diagnosis  
## 轨迹观测、上下文归因与失败诊断

> **Course / 课程：** CS2680 Modern AI Systems  
> **Assignment / 作业：** Experience a Coding Agent — Build a Web UI for Claude Code  
> **Repository / 仓库：** `G:/CS2680_Modern_AI_Systems`（branch `main`）  
> **App root / 应用根目录：** `assignment1/simple-chatapp/`  
> **Report date / 报告日期：** 2026-09-04  
> **Tip commit / 本报告入库 commit：** `43e4b9b4130894b05ad1177a3a5eeceb18e59d08`

---

## 0. Mapping Requirements to This Report / 作业要求如何映射到本报告

The assignment brief (`assignment1/readme-a1.md`) decomposes into four layers. This report follows the same order.

作业要求（见 `assignment1/readme-a1.md`）可拆成四层，本报告按同一顺序展开：

| Requirement / 作业要求 | Artifact in this repo / 本仓库产物 | Section / 章节 |
|---|---|---|
| Build a Web UI that drives a real agent session / 构建驱动真实 agent 会话的 Web UI | `client/` + `server/` + Claude Agent SDK | §1 |
| Instrument the trajectory; classify what actually filled context / 记录轨迹并对实际填充 context 的内容分类 | Schema v2, observation proxy, context ledger, Trace Viewer Calls | §2 |
| Analyze substantive failures (Tool / Harness / Spec / Model) / 分析实质性失败 | evidence store, tool replay, context diff, diagnosis wizard | §3 |
| Support conclusions with reproducible evaluation / 用可复现评测支持结论 | frozen 10 tasks, pilot/final, verifiers, aggregates | §4–§5 |

**Grading focus (per assignment) / 评分重心（与作业一致）：**  
We are not graded on how impressive the UI looks. We are graded on what we learned about how the agent executed—especially where tokens went, how failure evidence supports classification, and whether conclusions trace back to raw data.

我们不对界面视觉美观评分，而是评估对智能体执行过程的理解——尤其是 token 去了哪里、失败证据如何支撑分类、以及结论能否回溯到原始数据。

---

## 1. System Overview and Reproducible Baseline / 系统概览与可复现基线

### 1.1 Runtime Environment / 运行环境

| Item / 项目 | Value / 值 |
|---|---|
| Node | `v24.13.0` |
| Agent SDK | `@anthropic-ai/claude-agent-sdk`（declared `^0.1.28`, resolved `0.1.77`） |
| Requested model / 请求模型 | `deepseek-v4-pro-0813` |
| Claude Code init (historical) / 历史实测 | `2.0.77`（`system/init` → `claudeCodeVersion`） |
| OS | Windows 10 |
| Peak pricing version / 峰段价格版本 | `deepseek-v4-pro-peak-2026-09-02`（cache-hit `$0.044/M`, miss `$1.32/M`, output `$3.96/M`） |

### 1.2 Milestone Commits on `origin/main` / 关键阶段 commit

| Stage / 阶段 | Commit | Notes / 说明 |
|---|---|---|
| Token Observability (docs tip) | `6dfb02bc300aed5eb8ca6bf592e7da9951bdbafe` | Schema v2 / proxy / ledger / pricing / Calls |
| Failure Evidence | `405c3d1d0a9e207eeed35a25d52021c16020ef57` | evidence / replay / diff / diagnosis |
| Evaluation baseline | same `405c3d1…` | All attempts fork from this commit / 所有 attempt 从此 commit 建隔离副本 |
| Eval harness + verifiers | `12f7ac80d7cd71b70f51ed220ea8c3881042c322` | tasks-v1 + runner + metrics |
| Pilot/Final results | `361b5a39ed80c0772cc2c80be9beb080b28a7a7c` | 30+100 summaries + aggregates |
| Audit follow-up | `71a9c5a3c9e78e8080f30b5593bbc29080b4854e` | coverage fields, diagnosis step lock, Calls gate / 本报告数据口径 |

Process logs (not this report) / 过程记录（非本报告）：

- `assignment1/Assignment1_Token_Observability_TODO.md`
- `assignment1/Assignment1_Failure_Evidence_TODO.md`
- `assignment1/Assignment1_Evaluation_TODO.md`

### 1.3 Application Capabilities / 应用能力摘要

1. **Session & tools / 会话与工具：** Browser-driven Claude Agent SDK; tool approval, Stop, resume, workspace bounds.  
   浏览器驱动 Claude Agent SDK；工具审批、Stop、resume、workspace 约束。

2. **Trajectory / 轨迹：** JSONL schema v2; separate `callUsage` / `runUsage` / `modelUsageSnapshot`; assistant fragments deduped by messageId.  
   JSONL schema v2；usage 分字段；assistant fragment 按 messageId 去重。

3. **Request observation / 请求观测：** Local transparent proxy `server/observation-proxy.ts` captures `/v1/messages` with queued/sent/firstByte/firstVisible/firstUseful/completed.  
   本地透明代理捕获 `/v1/messages`，记录完整 timing 戳。

4. **Context attribution / 上下文归因：** `server/context-ledger.ts` + count-tokens ladder; 95% coverage gate.  
   count-tokens 差分 ledger；95% coverage gate。

5. **Failure evidence / 失败证据：** `server/evidence-store.ts` (≥64KiB folded in UI, full redacted artifact on disk); out-of-agent tool replay; designed vs sent diff.  
   大输出 UI 折叠但本地完整脱敏；agent 外 replay；designed vs sent diff。

6. **Diagnosis wizard / 诊断向导：** UI enforces Tool → Harness → Specification → Model; append-only revise.  
   UI 强制四步顺序；支持 append-only revise。

7. **Evaluation panel / 评测面板：** `EvaluationPanel` reads `evaluation/results/{pilot,final}-aggregate.json`.

---

## 2. Token / Context Classification: Method, Review, Evidence  
## Token / Context 分类：方法、审查与证据

### 2.1 Classification Goals / 分类目标

We do **not** guess proportions from the final chat transcript. For **each real model call** we answer:

不是根据最终聊天 transcript 猜比例，而是对**每一次真实模型调用**回答：

1. Which **content categories** (provenance) contributed input tokens?  
   输入 token 来自哪些**内容类别**（provenance）？

2. Which buckets are **cache billing state** (uncached / cache-read / cache-write), not content sources?  
   哪些是 **cache 计费状态**，而不是内容来源？

3. What is the residual between reported logical input and `countTokens(full request)`? Is coverage ≥ 95%?  
   报告的 logical input 与完整 count-tokens 的残差是多少？coverage 是否 ≥95%？

### 2.2 Provenance Ladder (fixed order) / 内容来源阶梯（固定顺序）

Rule version / 规则版本：`CALL_CONTEXT_RULE_VERSION = call-1.0.0`  
Implementation / 实现：`assignment1/simple-chatapp/server/context-ledger.ts`

| Step / 阶梯 | Meaning / 含义 | Evidence type / 证据类型 |
|---|---|---|
| C0 | Minimal legal API/model framing / 最小合法 API/model framing | calibrated (baseline request) |
| C1 | + application system | observed + count delta |
| C2 | + CLAUDE.md / project instructions | observed + count delta |
| C3 | + tool definitions / tool config / tool-specific system | observed + ablation/count |
| C4 | + user messages | observed + count delta |
| C5 | + assistant text/thinking history | observed (only blocks present in the real request) |
| C6 | + historical tool-use | observed |
| C7 | + tool results/errors | observed (counted from the next call after production) |
| C8 | + permission/hook/compaction/retrieval | observed |

**Review rules / 审查原则：**

- Missing fields stay `null`; never pad with zeros. / 缺失字段记 `null`，禁止补 0。  
- Byte/4 estimates must not enter authoritative coverage. / estimate 不得进入权威 coverage。  
- Cache overlay and provenance are **separate fields**; never label cache-read as unknown content. / cache 与来源分字段；禁止把 cache-read 标成 unknown。  
- Duplicate usage for the same messageId is counted once; conflicts set `usageConflict=true`. / 同 messageId usage 只取一次；冲突记 `usageConflict=true`。

### 2.3 First-turn Measured Breakdown (historical, immutable)  
### 首轮实测分解（历史实测，数字不改）

Primary analysis report / 原始分析报告：

- **Path / 路径：** `assignment1/simple-chatapp/TOKEN_PROVENANCE_REPORT.md`  
- **Engineering addendum / 工程追加：** same file §10 (2026-09-03)

Of 6,902 input tokens / 在 6,902 个输入 token 中：

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

**Key findings / 关键结论：**

- Application-controlled sources (tools + CLAUDE.md + application system) ≈ **98.18%**.  
  应用可控来源约 **98.18%**。  
- There is **no evidence** to label ~6,144 cache-read tokens as unknown content.  
  **没有证据**支持把约 6,144 cache-read token 标成 unknown content。  
- Cost is dominated by **tool schemas + tool instructions**, not the user utterance.  
  主要成本驱动是**工具 schema + 工具指令**，不是用户一句话。

### 2.4 Coverage Gate and Review Workflow / Coverage gate 与审查流程

Formula / 公式（`server/context-ledger.ts`）：

```text
reportedLogicalInput = uncached + cacheRead + cacheWrite
residual = reportedLogicalInput - countTokens(fullCapturedRequest)
coverage = 1 - abs(residual) / reportedLogicalInput
passesGate = coverage >= 0.95
```

| Case / 情况 | Handling / 处理 |
|---|---|
| Missing usage / usage 缺失 | `coverage = null`; never fake 100% / 禁止伪造 100% |
| count_tokens degraded to estimate | `authoritative = false`; not authoritative gate |
| `passesGate === false` | Persist requestHash, residual, reason; Calls UI warns / Calls UI 醒目警告 |

**UI review entry / UI 审查入口：** Trace Viewer → **Calls**  
Implementation / 实现：`client/components/TraceViewer.tsx`, `client/call-view.ts`  
Shows / 展示：provenance table (with evidence column), cache overlay, provider/normalized cost, TTFB/TTFV/TTFU, residual, adjacent Context Diff, gate-failure warning.

### 2.5 Raw Data & Code Index (Token) / Token 相关原始数据与代码索引

| Type / 类型 | Path / 路径 | Notes / 说明 |
|---|---|---|
| Method + measured report | `assignment1/simple-chatapp/TOKEN_PROVENANCE_REPORT.md` | Historical 6902 breakdown + §10 |
| Event schema | `assignment1/simple-chatapp/server/events.ts` | schema v2, `callUsage`, etc. |
| Normalizer / fragment dedupe | `server/event-normalizer.ts` + `*.test.ts` | |
| Transparent proxy | `server/observation-proxy.ts` + `*.test.ts` | SSE firstVisible/firstUseful |
| Ledger / gate | `server/context-ledger.ts` + `*.test.ts` | |
| Count tokens | `server/token-counter.ts` | |
| Peak pricing / timing | `server/pricing.ts` + `*.test.ts` | |
| Runtime traces (local, not committed) | `traces/`, `data/` (`.gitignore`) | Large JSONL / evidence |
| Process TODO | `assignment1/Assignment1_Token_Observability_TODO.md` | Stage SHAs and tests |

---

## 3. Failure Classification and Review / 失败分类与审查

### 3.1 Fixed Diagnosis Order (enforced) / 固定诊断顺序（强制）

Implementation / 实现：`server/failure-diagnosis.ts`, `client/components/FailureDiagnosisPanel.tsx`

```text
Tool → Harness/Context → Specification → Model
```

**Review rules / 审查规则：**

1. Every step needs **evidenceRefs**; without evidence, only `inconclusive` is allowed.  
   每一步必须有 evidenceRefs；无证据只能 `inconclusive`。  
2. After a prior `fail`, later steps are `not_reached`; do **not** jump to Model.  
   前一步 fail 后后续为 `not_reached`，不得直接断定 Model。  
3. Model failure is allowed only if Tool, Harness, and Specification all pass.  
   Model 仅当前三步均为 pass。  
4. Classification changes must be **append-only revisions** (`POST .../revise`); never overwrite.  
   分类修改必须 append-only revision，禁止覆盖旧判断。  
5. UI advances with Prev/Next only; skipping ahead is disabled.  
   UI 用 Prev/Next 强制步进，禁止跳步。

### 3.2 How Each Step Is Judged / 每一步如何判

| Step / 步骤 | Pass condition (summary) / 通过条件（摘要） | Evidence sources / 原始证据来源 |
|---|---|---|
| **Tool** | Out-of-agent replay matches ground truth / Agent 外重放与 ground truth 一致 | `server/tool-replay.ts`; Read/Glob/Grep read-only; Write/Edit/Bash on isolated copy; `match` / `mismatch` / `replay_failed` |
| **Harness/Context** | Designed transcript matches real Sent request / Designed 与真实 Sent 一致 | `server/context-diff.ts` (9 DiffKinds); proxy-captured requests |
| **Specification** | Frozen TaskSpec is decidable by a competent contractor; repo verifier reproducible / 冻结 TaskSpec 可判定；verifier 可复现 | `server/task-spec.ts`; spec hash; human-contractor field |
| **Model** | Prior three steps pass, yet model still misbehaves under correct context / 前三步 pass 后模型仍错 | callIds + redacted trajectory fragments |

Full failure fields (tool/http/storage/sse/timeout/permission/hook/compaction/unknown_sdk) live in `server/failure-fields.ts`. Large outputs are content-addressed under `evidence/<chatId>/<runId>/<sha256>.*` (gitignore).

完整错误字段见 `server/failure-fields.ts`；大输出经 evidence store 内容寻址保存（gitignore）。

### 3.3 Four Canonical Failure Trajectories + Read max-turns  
### 四条标准失败轨迹 + Read max-turns

Machine-readable fixtures / 机器可读 fixture：

- **Code / 代码：** `assignment1/simple-chatapp/server/failure-fixtures.ts`  
- **API：** `GET /api/failure-diagnoses/fixtures`  
- **Read loop / Read 循环：** `GET /api/failure-diagnoses/read-max-turns` → classifies as **`harness`**

| Fixture key | Final class / 最终分类 | Review focus / 审查要点 |
|---|---|---|
| `tool` | tool | Replay mismatch: tool layer disagrees with agent claims / 工具层与 agent 声称不一致 |
| `harness` | harness | Designed ≠ sent / observability or fragment conflicts corrupt context / 上下文被观测或片段冲突破坏 |
| `specification` | specification | Spec undecidable for a contractor or conflicts with verifier / 规格不可判定或与 verifier 冲突 |
| `model` | model | First three steps pass; residual blame is model / 前三步 pass，责任落到模型 |
| `readMaxTurns` | harness | Repeated Read + max-turns; prefer harness over “model looks dumb on screen” / 优先 harness，非凭最终屏幕猜测 |

### 3.4 Three Final Case Studies / 三条 Final case study

Selected from `evaluation/results/final-aggregate.json` → `caseStudies`.  
Each attempt’s redacted summary is the **commit-able raw record unit**.

选自 `final-aggregate.json` 的 `caseStudies`。每条脱敏 summary 是可提交的原始记录单元。

#### Case A — `final-E01-a08` → `inconclusive`

- **File / 文件：** `assignment1/simple-chatapp/evaluation/results/final-E01-a08.summary.json`  
- **mode：** `broken` (deleted `server/event-normalizer.test.ts`)  
- **verifier：** fail (missing test file; fragment phrase check fails)  
- **classification：** `inconclusive`  
- **evidenceRefs：** `verifier:E01`, `attempt:final-E01-a08`  
- **cost：** `$0.55` (failure cost enters the cost/completion numerator)  
- **Interpretation / 审查解读：** Repo failure is proven by the verifier, but layered evidence is insufficient to lock a single diagnosis axis—consistent with “no sufficient stratified evidence → inconclusive”.  
  仓库失败已被 verifier 证实；但不足以单独锁定单一诊断轴 → `inconclusive`。

#### Case B — `final-E01-a09` → `tool`

- **File / 文件：** `…/final-E01-a09.summary.json`  
- Same broken E01 pattern / 同样 broken E01  
- **classification：** `tool`  
- **Interpretation / 审查解读：** In the scaffolding eval, this sample maps to the tool axis to exercise failure-distribution and evidenceRefs plumbing. Online, one would still run a tool-replay bundle to confirm or overturn.  
  脚手架中映射到 tool 轴以检验管道；线上仍应用 tool-replay 确认或推翻。

#### Case C — `final-E01-a10` → `specification`

- **File / 文件：** `…/final-E01-a10.summary.json`  
- **classification：** `specification`  
- **Interpretation / 审查解读：** Emphasizes consistency among acceptance criteria, frozen spec, and verifier. If a competent contractor cannot decide the expected repo state from the spec alone, classify as specification—not model.  
  强调接受标准 / 冻结 spec / verifier 一致性；规格不可判定则升格为 specification，而非 model。

> **Important disclosure / 重要披露：**  
> Failure classes inside Final×100 are produced by the oracle/broken harness with a deterministic attemptId mapping (`evaluation/runner.ts`). They validate the **metrics pipeline, failed-cost inclusion, and evidenceRefs completeness**. The **methodology and UI-enforced order** for the four diagnosis axes are defined in §3.1–§3.3 (Failure Evidence). Do not conflate the two.  
> Final 100 次中的失败分类由 harness 确定性映射生成，用于验证指标与字段管道；四类诊断方法论与 UI 强制顺序以 Failure Evidence 实现为准，二者不要混为一谈。

### 3.5 Raw Data Index (Failure) / Failure 相关原始数据索引

| Type / 类型 | Path / 路径 |
|---|---|
| Evidence store | `server/evidence-store.ts` (runtime `evidence/`, gitignore) |
| Tool replay | `server/tool-replay.ts` + `*.test.ts` |
| Context diff | `server/context-diff.ts` + `*.test.ts` |
| Task spec | `server/task-spec.ts` + `*.test.ts` |
| Diagnosis | `server/failure-diagnosis.ts` + `*.test.ts` |
| Fixtures | `server/failure-fixtures.ts` |
| UI | `client/components/FailureDiagnosisPanel.tsx` |
| Local diagnosis JSONL | `data/diagnoses/` (covered by `data/` gitignore) |
| Process TODO | `assignment1/Assignment1_Failure_Evidence_TODO.md` |

---

## 4. Frozen Evaluation: Design, Execution, Statistics  
## 冻结评测：设计、执行与统计

### 4.1 Design Principles / 评测设计原则

1. **Success** depends only on final repository state + frozen verifier—never on agent self-claim of “done”.  
   Success 只看最终仓库态 + 冻结 verifier，不看 agent 自报“完成”。  
2. **Versioned manifest/scorer：** `evaluation/tasks-v1.json`  
   - Manifest SHA-256：`54d9b3a5ea38956e5d1d06e27c3f369fccb8d8acb03b8195a5882c41ddc9c839`  
   - Scorer：`eval-scorer-1.0.0`  
3. **Baseline commit：** `405c3d1d0a9e207eeed35a25d52021c16020ef57`  
4. **Pilot and Final stay in separate files**; never mix statistics.  
   Pilot 与 Final 分文件，禁止混统计。  
5. **Modes / 模式：**  
   - `oracle`: verify current features on an isolated copy → expect pass  
   - `broken`: delete a key file for the task, then verify → expect fail  
6. **Cost scaffolding** (formula check, not live billing): success `$0.18`, failure `$0.55`;  
   \(7\times0.18 + 3\times0.55 = 2.91\), \(2.91/7 \approx 0.4157\) → report **`$0.42/completion`**.  
7. Failed costs **enter** the cost/completion numerator; with zero successes, cost/completion is `undefined` (not 0).  
   失败成本进入分子；零成功时不写 0。

### 4.2 Ten Frozen Tasks / 十任务清单

Full machine-readable defs / 完整定义：`assignment1/simple-chatapp/evaluation/tasks-v1.json`  
Verifiers：`assignment1/simple-chatapp/evaluation/verifiers/e01.ts` … `e10.ts`

| ID | Title / 标题 | Verifier |
|---|---|---|
| E01 | Assistant fragment dedupe & call linking / fragment 去重与调用关联 | `e01.ts` |
| E02 | Compaction, Hook & unknown SDK blocks | `e02.ts` |
| E03 | Per-call Context Ledger & 95% gate | `e03.ts` |
| E04 | Versioned DeepSeek Peak Pricing | `e04.ts` |
| E05 | Full tool-error artifacts & safe replay | `e05.ts` |
| E06 | Designed vs Sent Context Diff | `e06.ts` |
| E07 | Resume multi-turn context integrity | `e07.ts` |
| E08 | Permission/Stop/Timeout evidence chain | `e08.ts` |
| E09 | Frozen Task Spec & repository verifier | `e09.ts` |
| E10 | Four-step failure diagnosis & stats panel | `e10.ts` |

### 4.3 Pilot (30 attempts) / Pilot（30 attempts）

- **Command / 命令：** `npm run eval:pilot`  
- **Design / 设计：** 3 attempts per task (2 oracle + 1 broken)  
- **Aggregate / 聚合：** `assignment1/simple-chatapp/evaluation/results/pilot-aggregate.json`  
- **Per-attempt summaries / 逐次 summary：** `evaluation/results/pilot-E{01-10}-a{01-03}.summary.json`

| Metric / 指标 | Value / 值 |
|---|---:|
| Attempts | 30 |
| Successes | 20 |
| Success rate | 0.667 |
| Bernoulli variance \(p(1-p)\) | 0.222 |
| Cost/completion (rounded) | **$0.45** |
| Failed cost share | 60.4% |
| Wall mean / median (ms) | 198.5 / 176 |
| TTFU mean / median (ms) | 160 / 160 |

During Pilot, **E07 verifier was too loose (OR)**; it was tightened to require `setObservationContext`, then broken was re-run (see Evaluation TODO).

Pilot 中曾发现 E07 verifier 过宽，收紧后重跑 broken。

### 4.4 Final (100 attempts) / Final（100 attempts）

- **Command / 命令：** `npm run eval:final`  
- **Design / 设计：** 10 attempts per task (7 oracle + 3 broken), alternating `cacheStratum` cold/hot  
- **Aggregate / 聚合：** `assignment1/simple-chatapp/evaluation/results/final-aggregate.json`  
- **Index / 索引：** `evaluation/results/final-index.json`  
- **Per-attempt summaries：** `evaluation/results/final-E{01-10}-a{01-10}.summary.json` (100 files)

| Metric / 指标 | Value / 值 |
|---|---:|
| Attempts / complete | 100 / 100 |
| Successes | 70 |
| Success rate | **0.70** |
| Bernoulli variance | 0.21 |
| Provider & peak cost/completion | **$0.42** |
| Failed cost share | **56.7%** |
| Wall mean / std / median / IQR (ms) | 259.7 / 76.5 / 236.5 / 103.8 |
| TTFU mean / std / median / IQR (ms) | 165.7 / 39.9 / 200 / 80 |
| Cold success rate | 0.80 (50 attempts) |
| Hot success rate | 0.60 (50 attempts) |

**Failure distribution (30 failures) / 失败分布：**

| Class / 分类 | Count / 次数 |
|---|---:|
| harness | 10 |
| tool | 7 |
| specification | 7 |
| inconclusive | 6 |
| model | 0 (no model samples this scaffolding round; E10 path retained) |

Each summary includes / 每条 summary 含：`pricingVersion`, `coverage` / `coverageResidual` (oracle≈0.98, broken≈0.91 scaffolding), `failureClassification`, `evidenceRefs`, `verifier.checks`, `cacheStratum`, etc.

### 4.5 Raw Data Addresses (Evaluation) / 评测原始数据地址

| Purpose / 用途 | Path / 路径 |
|---|---|
| Task manifest | `assignment1/simple-chatapp/evaluation/tasks-v1.json` |
| Verifiers | `assignment1/simple-chatapp/evaluation/verifiers/` |
| Runner | `assignment1/simple-chatapp/evaluation/runner.ts` |
| Aggregator | `assignment1/simple-chatapp/evaluation/aggregate.ts` |
| Metrics tests | `assignment1/simple-chatapp/evaluation/metrics.ts` + `metrics.test.ts` |
| **Final aggregate** | `assignment1/simple-chatapp/evaluation/results/final-aggregate.json` |
| **Pilot aggregate** | `assignment1/simple-chatapp/evaluation/results/pilot-aggregate.json` |
| **Per-attempt redacted summaries** | `assignment1/simple-chatapp/evaluation/results/*.summary.json` |
| Temp worktrees (large, gitignore) | `assignment1/simple-chatapp/evaluation/runtime/` |
| Process TODO | `assignment1/Assignment1_Evaluation_TODO.md` |

---

## 5. Synthesis: What We Learned / 综合分析：学到了什么

### 5.1 About Context / 关于 Context

1. **Tool surface dominates input:** ~87.7% of first-turn tokens are tool definitions/instructions. Tuning user-prompt length barely moves cost; audit tool mounts and schema size first.  
   工具表面主导输入；应优先审查工具挂载与 schema 体积。  

2. **Cache ≠ provenance:** cache-read is billing state; labeling it unknown content hides structure.  
   Cache 是计费状态，不是来源类别。  

3. **95% gate is a review latch:** below threshold, expose residual and requestHash—do not smooth residuals into categories.  
   低于阈值必须暴露 residual，禁止强制分摊。

### 5.2 About Failures / 关于失败

1. **Final screen state is unreliable:** Read loops + max-turns are closer to harness/observability issues than “the model cannot use tools”.  
   屏幕终态不可靠；Read 循环更接近 harness。  

2. **Stratify:** Skipping Tool/Harness and blaming Model pollutes evaluation and remediation.  
   必须分层，禁止跳步骂模型。  

3. **Replay and Diff are actionable evidence:** mismatch → tool; designed≠sent → harness; undecidable spec → specification.  
   Replay 与 Diff 是可操作证据。

### 5.3 About Evaluation and Cost / 关于评测与成本

1. **Failures are expensive:** Final failed-cost share ≈ **56.7%**—even at 70% success, cost/completion is pulled up by failures.  
   失败很贵。  

2. **Cold/hot differ:** cold 0.80 vs hot 0.60 in this scaffolding; reports must stratify.  
   冷/热必须分层报告。  

3. **The verifier is ground truth:** an overly loose E07 verifier once let broken pass; tightening restored expected failure. Evaluation engineering itself can introduce harness error.  
   Verifier 即真相；评测工程本身也会引入 harness error。

### 5.4 Known Limitations (must disclose) / 已知限制（必须披露）

1. Pilot/Final agent execution is an **oracle/broken repo-state harness**, not 100 live LLM agent runs; costs are fixed scaffolding to validate formulas and field pipelines.  
   非 live 百次 LLM；成本为 scaffolding。  

2. Live coverage depends on upstream `count_tokens` availability.  
   Live coverage 依赖上游 count_tokens。  

3. Large traces / evidence / diagnoses / evaluation runtime are **gitignored by default**; the repo ships redacted summaries + code + this report as reviewable material.  
   大体积运行时产物默认不入库。  

4. Historical numbers in `TOKEN_PROVENANCE_REPORT.md` §§1–9 are unchanged; engineering capability is defined by §10 and current code.  
   历史实测数字不改；工程能力以 §10 与当前代码为准。

---

## 6. How to Verify (shortest path) / 如何复核（最短路径）

```bash
cd assignment1/simple-chatapp
npm test          # ~106 tests
npm run typecheck
npm run lint

# Read aggregates / 阅读聚合结果
# evaluation/results/final-aggregate.json
# evaluation/results/pilot-aggregate.json

# Spot-check three cases / 抽查三条 case
# evaluation/results/final-E01-a08.summary.json
# evaluation/results/final-E01-a09.summary.json
# evaluation/results/final-E01-a10.summary.json

# Local UI: Trace Viewer → Calls; Diagnosis; Evaluation
```

Reproduce evaluation (writes `evaluation/runtime/`; do not commit) / 复现评测（勿提交 runtime）：

```bash
npm run eval:pilot
npm run eval:final
```

---

## 7. Conclusion / 结论

This assignment closes the loop from a **runnable agent UI** to a system that is **observable, attributable, diagnosable, and evaluable**:

本作业完成了从 **“能跑的 agent UI”** 到 **“可观测、可归因、可诊断、可评测”** 的闭环：

1. **Classify / 分类：** Fixed provenance ladder + separate cache overlay + coverage gate.  
2. **Review / 审查：** Calls UI / Diagnosis forced order / frozen verifier on repo state.  
3. **Evidence / 证据：** Redacted JSONL, evidence hashes, replay/diff/spec, 130 attempt summaries, pilot/final aggregates.  
4. **Analyze / 分析：** Tool surface dominates cost; failures must be stratified; failed cost substantially raises cost/completion.

Cite raw data preferentially from the path tables in **§2.5, §3.5, §4.5**. Process checkboxes and SHAs live in the three `Assignment1_*_TODO.md` files.

原始数据请优先从 **§2.5、§3.5、§4.5** 路径引用；过程勾选与 SHA 以三份 TODO 为准。

---

## Appendix A — Quick File Index / 附录 A — 关键文件速查

```text
assignment1/readme-a1.md
assignment1/Assignment1_Final_Report.md          ← this report / 本报告
assignment1/Assignment1_Token_Observability_TODO.md
assignment1/Assignment1_Failure_Evidence_TODO.md
assignment1/Assignment1_Evaluation_TODO.md
assignment1/simple-chatapp/TOKEN_PROVENANCE_REPORT.md
assignment1/simple-chatapp/evaluation/tasks-v1.json
assignment1/simple-chatapp/evaluation/results/final-aggregate.json
assignment1/simple-chatapp/evaluation/results/pilot-aggregate.json
assignment1/simple-chatapp/evaluation/results/*.summary.json
```

## Appendix B — Final Failure Distribution & Case IDs / 附录 B

```json
"failureDistribution": {
  "inconclusive": 6,
  "tool": 7,
  "specification": 7,
  "harness": 10
},
"caseStudies": [
  { "attemptId": "final-E01-a08", "classification": "inconclusive", "costUsd": 0.55 },
  { "attemptId": "final-E01-a09", "classification": "tool", "costUsd": 0.55 },
  { "attemptId": "final-E01-a10", "classification": "specification", "costUsd": 0.55 }
]
```

Source / 来源：`assignment1/simple-chatapp/evaluation/results/final-aggregate.json`.
