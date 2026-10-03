# 第五讲：Agent Design II — Multi-Agent Systems — 讲稿

---

## Slide 1 — 标题页

大家好，欢迎来到第五讲。

这一讲的主题是 **Agent Design II: Multi-Agent Systems**——多 Agent 系统。

前面几讲我们一直在讨论单个 Agent 的设计：它怎么推理、怎么使用工具、怎么管理上下文。但现实世界中，很多任务太复杂了，一个 Agent 搞不定。就像一家公司不可能只有一个人干活一样，我们需要多个 Agent 协作。

这一讲我们就来讨论：怎么把多个 Agent 组织起来，让它们高效地协同工作。

---

## Slide 2 — Logistics（课程事务）

在正式开始之前，先说几个课程事务：

- **Claude Code Premium seat**：关于 Claude Code 的高级席位安排
- **Assignment 1**：第一次作业的提交方式——通过 Canvas 提交，需要提交 repo url 和 mini product
- **Assignment 2**：第二次作业已经发布了，大约两周后截止
- **Office hour**：下周四是下午 3:30 到 5 点，地点在 SEC 4.308
- **Pre-proposal**：项目预提案的相关事宜

---

## Slide 3 — Plan for today（今天的内容安排）

今天的内容分为两大块：

**第一块：Multi-agent design（多 Agent 设计）**，包含三个子话题：
- **Architecture（架构）**：多个 Agent 之间怎么组织？谁管谁？谁和谁通信？
- **Coordination: task decomposition（协调：任务分解）**：一个大任务怎么拆成多个小任务分给不同的 Agent？
- **Communication（通信）**：Agent 之间怎么传递信息？

**第二块：Agent memory（Agent 记忆）**：Agent 怎么记住过去的信息，在需要的时候取出来用。

---

## Slide 4 — 空白过渡页

这是一个过渡页，没有具体内容。我们从这里开始正式进入多 Agent 系统的讨论。

---

## Slide 5 — From one agent to many（从一个 Agent 到多个 Agent）

这一页的标题是 **From one agent to many**——从一个 Agent 到多个 Agent。

前面我们学的是怎么设计一个 Agent。现在我们要问一个自然的问题：**什么时候需要多个 Agent？**

这一页列出了三个核心问题，这也是后面整讲内容的主线：

- **Architecture（架构）**：多个 Agent 之间的组织结构是什么样的？
- **Coordination（协调）**：怎么让多个 Agent 协同工作？
- **Communication（通信）**：Agent 之间怎么交流？

底部有一行小字说：**Multi-agent is not new, it has decades of research history which we will not get into**——多 Agent 系统不是新概念，它有几十年的研究历史，但我们这节课不会深入那些历史，我们聚焦在现代 LLM Agent 的语境下讨论。

为什么要强调这一点？因为多 Agent 系统在传统 AI 领域（比如分布式 AI、机器人协作）已经研究了很长时间。但 LLM 时代的 Multi-Agent 有一些新的特点：Agent 之间传递的是自然语言，Agent 的能力来自大模型，协调方式也更灵活。

---

## Slide 6 — When and why split work across agents?（什么时候、为什么要把工作分给多个 Agent？）

这一页非常重要，它回答了"为什么要用多 Agent"这个根本问题。

右上角有个 **Hands up** 的标记，说明这是一个互动环节——老师会让同学们举手回答。

画面中有四个卡片，分别对应四个理由：

**1. Specialization（专业化）**：
不同的 Agent 可以使用不同的模型、不同的 Prompt、不同的工具。就像公司里有前端工程师、后端工程师、测试工程师，每个人专精不同的领域。比如你可以让一个 Agent 专门做代码生成（用擅长 coding 的模型），另一个 Agent 专门做文档总结（用擅长长文本的模型）。

**2. Isolation（隔离）**：
给不同的 Agent 不同的权限。这个很重要——比如一个 Agent 负责读文件，另一个 Agent 负责写文件。读文件的 Agent 不应该有写权限。这样即使某个 Agent 出了问题，它的破坏范围也是有限的。这就是安全设计中的 **Principle of Least Privilege**（最小权限原则）。

**3. Parallelism（并行）**：
独立的子任务可以同时执行。比如你要分析 10 个文件，如果让一个 Agent 串行地一个一个读，要花 10 倍的时间。但如果拆成 10 个 Agent 同时读，时间就大大缩短了。前提是这些子任务之间没有依赖关系。

**4. Context management（上下文管理）**：
不要给每个 Agent 完整的对话轨迹。这个可能不太好理解，让我举个例子：假设你有一个 100 轮对话的长对话，如果让一个 Agent 处理所有 100 轮，它的 Context Window 可能不够用。但如果把对话分成几段，每段交给不同的 Agent 处理，每个 Agent 只需要看到自己负责的那部分，就不会超出 Context Window 的限制。

这四个理由不是互斥的，实际系统中往往会同时用到多个。

---

## Slide 7 — Three questions / graphs behind every architecture（每种架构背后的三个问题/图）

这一页提出了一个非常重要的分析框架：**任何多 Agent 架构都可以用三个"图"（graph）来描述**。

这里的"图"不是图表的意思，而是图论中的"图"——由节点和边组成的结构。

**1. Control graph（控制图）：Who coordinates?（谁来协调？）**
- 是一个 Supervisor（监督者）？
- 还是一个层级结构（hierarchy）？
- 还是根本没有协调者？
- 这个结构在运行过程中会变化吗（handoff，交接）？

**2. Task graph（任务图）：How is work decomposed?（工作怎么分解？）**
- 是一开始就由 Planner（规划者）分好？
- 还是通过 bidding（竞标）的方式？
- 还是从局部规则中 emergently（涌现式地）产生？

**3. Communication graph（通信图）：How do they communicate?（它们怎么通信？）**
- 是直接发消息（direct messages）？
- 还是广播（broadcast）？
- 还是通过共享工作区（shared workspace）？

这三个问题构成了分析任何多 Agent 系统的通用框架。后面讲每种架构的时候，都会从这三个维度来分析。

---

## Slide 8 — Multi-agent architecture（多 Agent 架构总览）

这一页展示了八种多 Agent 架构的示意图。每个图都用方框和连线来表示 Agent 之间的关系。

让我逐个介绍一下这八种架构的图示：

**1. Supervisor-worker（监督者-工作者）**：一个顶层方框（Supervisor）下面连着三个方框（workers）。这是星型结构，所有通信都经过 Supervisor。

**2. Hierarchical（层级式）**：像一棵树，顶层一个方框，下面两层，每层又有多个方框。这是递归的 Supervisor-worker 结构。

**3. Pipeline / DAG（流水线/有向无环图）**：四个方框排成一行，用箭头依次连接。信息从前往后流动。

**4. Blackboard（黑板式）**：顶层一个长条方框（共享工作区），下面三个方框都连到它。Agent 之间不直接通信，都通过共享区交换信息。

**5. Committee（委员会式）**：几个方框围成一圈，互相连接。每个 Agent 都和其他 Agent 通信，最后汇聚到一个结果。

**6. Market（市场式）**：一个顶层方框，下面几个方框，其中有些方框用不同颜色（黄色）标注，表示竞标过程。

**7. Swarm（群体式）**：四个方框排成 2x2 的网格，每个方框都和相邻的方框双向连接。没有中心节点。

**8. Dynamic topology（动态拓扑）**：左边两个方框，右边分出两个不同颜色的方框（黄色），表示结构在运行中会变化。

这八种架构覆盖了从完全集中到完全去中心的各种组织方式。接下来我们会逐一详细讲解。

---

## Slide 9 — 1. Supervisor-worker（监督者-工作者架构）

**核心思想**：一个 Agent 负责规划、分配任务和整合结果；Worker Agent 只能看到自己的子任务。

画面上有一个图：红色的 **Supervisor** 方框在顶部，下面连着三个方框——**Researcher**（研究者）、**Coder**（编码者）、**Reviewer**（审查者）。这就是一个典型的星型结构。

**适用场景**（绿色文字）：当子任务之间相互独立、可以并行执行时，这种架构效果最好。比如你要同时做文献调研、写代码、和代码审查，这三件事可以同时进行。

**弱点**（红色文字）：**Supervisor bottlenecks**——Supervisor 成了瓶颈。因为它要重新读取每个 Worker 的结果，它的 Context 增长最快。想象一下，Supervisor 就像项目经理，所有汇报都汇总到它这里，它的"大脑"很快就装不下了。

底部总结了三个维度：
- **Task**：Supervisor  upfront 就把任务分好（splits up front）
- **Control**：只有一个 Supervisor
- **Comms**：星型通信，所有通信都经过 Supervisor

---

## Slide 10 — 2. Hierarchical agents（层级式 Agent）

**核心思想**：把 Supervisor-worker 模式递归地应用——Supervisor 管理 sub-supervisor（子监督者），sub-supervisor 再管理 Worker。

画面上的例子是 **feature build**（功能开发）：
- 顶层是 **Feature manager**（功能经理）
- 第二层是 **Backend lead**（后端负责人）和 **Frontend lead**（前端负责人）
- 第三层是 **API**、**Database**、**UI**、**E2E tests**

这就像公司的组织架构：CEO 管理各部门总监，总监管理各个团队的工程师。

**适用场景**（绿色文字）：适合那些本身就天然具有层级结构的任务——比如 storage（存储系统）、query engine（查询引擎）、testing（测试）。这些系统本身就是分层的，所以用层级式的 Agent 架构很自然。

**挑战**（红色文字）：**Where does decomposition happen, and how much context crosses each boundary?**——任务分解发生在哪一层？每一层之间要传递多少上下文？这两个问题很难回答。分解得太细，通信开销大；分解得太粗，单个 Agent 负担太重。

底部总结：
- **Task**：每一层都要再次分解（split again at each level）
- **Control**：嵌套的 Supervisor（nested supervisors）
- **Comms**：树形通信，只有 parent-child（父子）之间通信

---

## Slide 11 — 3. Pipeline / DAG（流水线/有向无环图）

**核心思想**：固定的阶段，每个阶段之间有类型化的契约（typed contract）。就像工厂的流水线，每个工位只做一件事，做完传给下一个工位。

画面的例子是 **invoice processing**（发票处理）：
- **OCR**（光学字符识别）→ **Extract fields**（提取字段）→ **Match to PO**（匹配采购单）→ **Approve**（审批）→ **Post to ledger**（入账）

注意图中有一条红色的回退箭头，从 **Approve** 指回 **OCR**，下面写着 **"one retry edge beats one more agent"**——加一条重试边比多加一个 Agent 更有效。意思是，如果审批没通过，不需要专门加一个 Agent 来处理返工，直接在流水线中加一条回退边就够了。

**优点**（绿色文字）：**Cheapest topology to debug**——最容易调试的拓扑结构。因为错误会 localize（定位）到某个阶段。如果出错了，你只需要检查那个阶段就行了。

**弱点**（红色文字）：**No path backwards**——没有回退路径。第四个阶段不能回头问第一个阶段要更好的输入源。流水线只能往前走，不能往后退（除非你专门加了回退边）。

底部总结：
- **Task**：阶段在设计时就固定了（stages fixed at design time）
- **Control**：顺序本身就是控制（the order is the control）
- **Comms**：阶段到阶段（stage to stage）

---

## Slide 12 — 4. Blackboard and shared memory（黑板与共享记忆）

**核心思想**：Agent 通过共享状态来协调，而不是直接发消息。

画面上的例子是 **agents sharing a Git repo**（多个 Agent 共享一个 Git 仓库）：
- 中间是 **Git repository**（包含 task list、commits、history）
- 下面三个 Agent——**Feature agent**、**Refactor agent**、**Test agent**——都通过双向箭头和 Git repo 连接

这意味着：Feature agent 写了代码提交到 Git，Test agent 从 Git 拉取代码来测试，Refactor agent 从 Git 看到代码后进行重构。它们之间不直接对话，而是通过 Git 这个共享空间间接协调。

**优点**（绿色文字）：Agent 可以随时加入或离开，不需要重新布线（rewiring）；共享状态是持久的（durable）和可检查的（inspectable）。

**挑战**（红色文字）：**Consistency**（一致性）、**concurrency control**（并发控制）、**provenance**（溯源）、**versioning**（版本管理）、**garbage collection**（垃圾回收）。这些都是分布式系统中的经典问题。

底部总结：
- **Task**：从共享状态中涌现（emerges from shared state）
- **Control**：没有中央控制（none central）
- **Comms**：间接通信，通过工作区（indirect, via workspace）

---

## Slide 13 — 5. Committee / debate（委员会/辩论）

**核心思想**：多个 Agent 各自提出方案并讨论，然后由一个 Judge（裁判）或投票来解决分歧。

画面的例子是 **essay grading**（论文评分）：
- 顶部是红色的 **Judge**（裁判）
- 下面是 **Grader A** 和 **Grader B** 两个评分者
- 两个评分者各自独立评分，然后把结果交给 Judge 做最终决定

**优点**（绿色文字）：在 **judgment-heavy tasks**（需要大量判断的任务）上能提高准确性。比如论文评分、代码审查、法律分析这类没有唯一正确答案的任务，多个 Agent 从不同角度分析可以减少偏见。

**失败模式**（红色文字）：**Agreement without independence**——表面一致但没有独立性。如果所有 Agent 用的是同一个模型、同样的上下文，它们会有同样的 blind spot（盲点）。就像一群人用同样的思维方式思考，得出的结论当然一样，但这不代表结论正确。这就是 **Groupthink**（群体思维）问题。

底部总结：
- **Task**：同一个任务，并行重复执行（one task, repeated in parallel）
- **Control**：Judge 做决定（the judge decides）
- **Comms**：先 peer-to-peer（同伴之间），然后到 Judge

---

## Slide 14 — 6. Market and auction（市场与拍卖）

**核心思想**：Agent 根据自己的能力、成本和延迟来竞标（bid）被宣布的任务。

画面中有一个红色的横幅写着 **"Who can run this training job?"**（谁能运行这个训练任务？），下面有三个节点在竞标：
- **A100 node**：$0.20 · ETA 3s
- **T4 node**：$0.05 · ETA 10s
- **H100 node**：$0.40 · ETA 1s

底部显示 **Job goes to A100 node**——任务最终分配给了 A100 节点。为什么？因为它在价格和速度之间取得了最好的平衡。H100 最快但最贵，T4 最便宜但最慢，A100 居中。

**关键特点**（绿色文字）：Work lands on the **cheapest capable agent** with no central planner——工作落在最便宜的、有能力的 Agent 上，不需要中央规划者。

**弱点**（红色文字）：Bids are **self-reported**——竞标是自我报告的，所以一个 Agent 可以通过夸大自己的能力来赢得竞标。就像投标时虚报资质一样。

**异构性**：Heterogeneous agents differ in models, tools, machines, cost and expertise——不同的 Agent 在模型、工具、机器、成本和专长方面各不相同。

底部总结：
- **Task**：被宣布，通过竞标认领（announced, claimed by bid）
- **Control**：拍卖师清算（auctioneer clears）
- **Comms**：广播，竞标回复（broadcast, bids back）

---

## Slide 15 — 7. Swarm（群体/蜂群）

**核心思想**：没有永久的协调者，Agent 之间直接协商和交换发现。

画面的例子是 **warehouse robots negotiating who picks which order**（仓库机器人协商谁来拣哪个订单）：
- 四个 Picker（拣货员）排成 2x2 的网格
- 每个 Picker 都和相邻的 Picker 有双向箭头连接
- 它们之间直接协商，没有中央调度

**优点**（绿色文字）：没有协调者作为瓶颈或单点故障；工作可以继续，即使有 peer（同伴）加入或退出。就像蜂群，没有一只蜜蜂是领导者，但整个蜂群能高效运作。

**弱点**（红色文字）：**Communication complexity O(n²)**——通信复杂度是 O(n²)。每增加一个 Agent，通信量就平方级增长。而且 **conflict resolution are hard**（冲突解决很难）。所以这种架构 **rarely used in products**（很少在产品中使用）。

需要protocols for discovery（发现）、addressing（寻址）、synchronization（同步）、termination（终止）、trust（信任）。

底部总结：
- **Task**：局部协商（negotiated locally）
- **Control**：没有永久协调者（no permanent coordinator）
- **Comms**：全连接，O(n²)（all-to-all, O(n²)）

---

## Slide 16 — 8. Dynamic topology（动态拓扑）

**核心思想**：Agent 在任务运行过程中被添加、移除或重新连接。

画面的例子是 **support bot**（客服机器人）：
- 左边：**Routine ticket**（常规工单）——只有一个 **Support bot**
- 中间红色箭头：**ticket escalates**（工单升级）
- 右边：**After escalation**（升级后）——Support bot 下面多了 **Billing agent**（计费 Agent）和 **Log agent**（日志 Agent）

意思是：简单的客服问题，一个 Support bot 就能处理。但如果问题变复杂了（比如涉及账单问题），系统会动态地加入 Billing agent 和 Log agent 来协助。问题解决后，这些额外的 Agent 可能被移除。

**优点**（绿色文字）：**Capacity scales with difficulty**——能力随难度扩展；简单的工单保持低成本。

**弱点**（红色文字）：**Every run takes a different shape, so failures are hard to reproduce**——每次运行的结构都不同，所以故障很难复现。这对调试来说是个大问题。

底部总结：
- **Task**：工作变难时重新分解（re-split as work gets hard）
- **Control**：随着 Agent 加入而转移（shifts as agents join）
- **Comms**：运行时动态变化（dynamic at runtime）

---

## Slide 17 — Real systems are hybrids（真实系统是混合的）

这一页强调：**真实世界中的系统往往是多种架构的混合体**。

画面展示了一个复杂的混合架构：
- 顶部是 **Supervisor**（红色）
- 下面是 **Planner agent**（浅蓝色）
- 再下面是 **Dynamic task DAG**（黄色）
- 然后分出三个 Worker：**Coder**、**Researcher**、**Tester**
- 它们共享 **Shared Git**（粉色）
- 最下面是 **Reviewer**（浅蓝色）
- 右侧有一条红色箭头从 Reviewer 指回 Planner agent，标注 **"re-plan if needed"**（如果需要就重新规划）

左侧标注了 **Combines**（结合了）：
- **hierarchy**（层级）：Supervisor → Planner → Workers
- **shared memory**（共享记忆）：Shared Git
- **pipeline**（流水线）：Coder/Researcher/Tester → Reviewer

这个架构同时用了三种模式：层级式的管理结构、共享 Git 作为协作空间、以及从编码到审查的流水线流程。而且当 Reviewer 发现问题时，可以触发重新规划（re-plan），体现了动态性。

---

## Slide 18 — Eight architectures（八种架构总结表）

这一页用表格总结了八种架构，按类别分组：

**Centralized（集中式）**：
| 架构 | 核心思想 | 最适合 | 弱点 |
|------|---------|--------|------|
| **Supervisor-worker** | 一个规划者，多个工作者 | 可分离的子任务 | 规划者瓶颈 |
| **Hierarchical** | 监督者的监督者 | 递归分解 | 错误放大 |
| **Pipeline / DAG** | 每个阶段传给下一个 | 清晰的有序阶段 | 错误传播 |
| **Market / auction** | Agent 竞标任务 | 动态分配 | 虚假竞标 |

**Decentralized（去中心化）**：
| 架构 | 核心思想 | 最适合 | 弱点 |
|------|---------|--------|------|
| **Blackboard** | 共享工作区 | 一个共享产物 | 状态过时 |
| **Committee / debate** | 先回答再协调 | 判断类任务 | 群体思维 |
| **Swarm** | 直接对话，无控制器 | 局部协商 | O(n²) 消息 |

**Hybrid（混合式）**：
| 架构 | 核心思想 | 最适合 | 弱点 |
|------|---------|--------|------|
| **Dynamic topology** | 随工作进展重新布线 | 未知结构 | 难以调试 |

这张表非常实用，当你需要设计多 Agent 系统时，可以根据任务特点选择合适的架构。

---

## Slide 19 — Task decomposition（任务分解）

这一页用图展示了任务分解的基本概念：

- 顶部是红色的 **Complex task**（复杂任务）
- 中间分出三个子任务：**Sub-task 1**、**Sub-task 2**、**Sub-task 3**
- 底部是 **Merged result**（合并结果）

箭头从 Complex task 指向三个 Sub-task，再从三个 Sub-task 汇聚到 Merged result。

这就是任务分解的核心流程：把一个复杂任务拆成多个子任务，分别处理，最后把结果合并。

但关键问题是：**怎么拆？** 按什么维度来拆？这就是下一页要讨论的内容。

---

## Slide 20 — Task decomposition（任务分解的六个维度）

这一页列出了任务分解的六个维度：

**1. Data（数据）**：每个 Agent 处理一部分文档或记录。比如 100 个文件分给 10 个 Agent，每个处理 10 个。

**2. Expertise（专长）**：按专业领域分工。比如 Security（安全）、performance（性能）、correctness（正确性）、legal analysis（法律分析）各由不同的 Agent 负责。

**3. Stage（阶段）**：按流程阶段分工。Plan（规划）、implement（实现）、test（测试）、review（审查）。

**4. Hypothesis（假设）**：不同的 Agent 调查不同的竞争性解释。比如诊断一个 bug，一个 Agent 假设是内存泄漏，另一个假设是并发问题，各自验证。

**5. Tool（工具）**：按使用的工具分工。Web（网页搜索）、database（数据库）、code execution（代码执行）、internal documents（内部文档）各由不同的 Agent 负责。

**6. Authority（权限）**：Agent 在不同的管理域中行动。比如一个 Agent 有权限访问财务系统，另一个有权限访问 HR 系统。

底部的例子：**a 200-file PR split by data (files), then by expertise (security, perf)**——一个 200 个文件的 Pull Request，先按数据（文件）拆分，再按专长（安全、性能）拆分。这是两个维度的组合使用。

---
