# 第四讲：Agent Design I — Context Management and Tool Design — 讲稿

---

## Slide 1 — 标题页

大家好，欢迎来到第四讲。从今天开始，我们要换一个视角。

前三讲我们都是从"使用者"的角度来看 Agent——怎么用 Agent、怎么扩展 Agent 的能力。但从今天开始，我们要进入 **Agent Design**（Agent 设计）的部分，站在"设计者"的角度来思考：一个 Agent 到底是怎么被构建出来的？

这一讲的主题是 **Context Management and Tool Design**——上下文管理和工具设计。这两个主题是 Agent 设计中最核心的部分，因为 Agent 的能力本质上就取决于两件事：它能看到什么（上下文），以及它能做什么（工具）。

---

## Slide 2 — 课程大纲

这一讲的内容分为三个部分：

**第一部分：ReAct Loop**。这是 Agent 最基本的推理模式。我们会搞清楚 Agent 是怎么"思考"和"行动"的。

**第二部分：The Agent Loop**。我们会深入到 Agent 循环的内部，看看每一轮迭代中到底发生了什么，以及作为 Agent 的设计者，你需要负责哪些事情。

**第三部分：Tool Design**。这是这一讲的重点。我们会详细讨论 Agent 的工具系统——它怎么搜索代码、怎么编辑文件，以及不同设计方案的优缺点。

---

## Slide 3 — 课程目标

学完这一讲之后，你应该能做到四件事：

第一，**Explain（解释）** ReAct 循环的原理，以及为什么"推理+行动"的组合比单独推理或单独行动更好。

第二，**Trace（追踪）** Agent 循环的完整流程，说清楚每一轮迭代中发生了什么。

第三，**Identify（识别）** Agent 设计者的四个核心职责：写工具定义、组装上下文、验证请求并执行、处理结果并管理上下文。

第四，**Compare（比较）** 不同的工具设计方案，特别是搜索和编辑两大类工具的不同实现方式及其优缺点。

---

## Slide 4 — 从一个问题开始

让我们从一个基本问题开始：**一个 Agent 是怎么完成复杂任务的？**

想象一下，你让 Agent 帮你修复一个 bug。这个任务看起来简单，但实际上涉及很多步骤：

1. Agent 需要先理解 bug 是什么
2. 然后找到相关的代码文件
3. 阅读代码，理解逻辑
4. 定位问题所在
5. 修改代码
6. 运行测试，确认修复成功

这每一步都需要 Agent 做出"决策"——我接下来应该做什么？而且每一步的结果都会影响下一步的决策。

那么，Agent 是怎么组织这些决策的呢？答案就是 **ReAct Loop**。

---

## Slide 5 — ReAct Loop：推理与行动的循环

**ReAct** 是一个非常重要的概念，它是 **Re**asoning + **Act**ing 的缩写。

核心思想很简单：Agent 在每一轮中做两件事——先 **Reason**（推理/思考），再 **Act**（行动）。

具体来说，一个 ReAct 循环包含三个步骤：

**Thought（思考）**：Agent 分析当前的情况，决定下一步应该做什么。比如"我需要先找到处理登录的代码文件"。

**Action（行动）**：Agent 执行一个操作，比如调用一个搜索工具来查找文件。

**Observation（观察）**：Agent 获取行动的结果，比如搜索返回了文件列表。然后基于这个结果，进入下一轮循环。

这个过程不断循环，直到任务完成。

---

## Slide 6 — 三种模式对比

让我们对比一下三种不同的模式，来理解为什么 ReAct 是最好的。

**模式一：Reason Only（只推理不行动）**
Agent 只能思考，不能和外界交互。就像一个人在封闭的房间里想问题——他可以推理，但他无法获取新的信息。这种模式的局限是：它只能基于已有的知识来推理，不能主动去探索。

**模式二：Act Only（只行动不推理）**
Agent 只能执行操作，但不经过思考。就像一个机器人按照预设的程序执行——它可以操作，但不会根据情况调整策略。这种模式的局限是：它无法处理需要灵活应变的复杂任务。

**模式三：ReAct（推理+行动）**
Agent 既能思考，又能行动。每一轮先思考该做什么，然后执行操作，再观察结果，然后基于结果继续思考。这种模式结合了两者的优点：它能根据新信息调整策略，也能通过行动来获取更多信息。

这就是为什么 ReAct 是当前 Agent 系统的主流范式。

---

## Slide 7 — The Agent Loop：Agent 循环详解

现在让我们更深入地看看 Agent 循环的内部机制。

一个完整的 Agent 循环是这样的：

1. **User request（用户请求）**：用户提出一个需求
2. **Model（模型处理）**：模型根据当前上下文生成下一步操作
3. **Next action?（判断下一步）**：模型决定是调用工具还是直接回复用户
4. **Execute tool（执行工具）**：如果模型决定调用工具，系统就执行对应的操作
5. **Return tool result（返回结果）**：工具执行的结果被添加到上下文中，然后回到步骤 2

这个过程可以用一段伪代码来表示：

```python
messages = [user_request]  # 初始化消息列表

while True:
    response = call_model(messages)  # 调用模型

    if response is a final answer:
        break  # 任务完成，退出循环

    validate(response)  # 验证模型的请求
    result = execute_tool(response)  # 执行工具
    messages.append(serialize(result))  # 把结果加入上下文
```

这段代码看起来简单，但它包含了 Agent 运行的全部核心逻辑。

---

## Slide 8 — Agent Harness Designer 的职责

作为 Agent 的设计者（harness designer），你有四个核心职责。

**Harness** 这个词原意是"马具"——就是套在马身上的那一套装备。在 Agent 的语境中，harness 指的是围绕模型的整个运行框架。模型是"马"，harness 就是控制马的那套系统。

作为 harness designer，你需要负责：

1. **Write tool definitions（编写工具定义）**：定义 Agent 可以使用哪些工具，每个工具的参数和返回值是什么。

2. **Assemble context（组装上下文）**：在每次调用模型之前，把所有需要的信息组装好——系统指令、对话历史、工具定义、记忆等。

3. **Validate request / Check permission / Run it（验证请求/检查权限/执行操作）**：当模型请求调用工具时，你需要验证这个请求是否合法，检查 Agent 是否有权限执行，然后执行它。

4. **Optionally process result and manage context（处理结果并管理上下文）**：工具执行完之后，你可能需要处理结果（比如格式化输出），然后把它添加到上下文中。你还需要管理上下文的大小，避免超出模型的限制。

---

## Slide 9 — Three Components of a Coding Agent

一个 Coding Agent（编程 Agent）由三个核心组件构成：

**01 — Model + Agent Loop（模型 + Agent 循环）**
这是 Agent 的"大脑"。模型负责推理和决策，Agent 循环负责把推理和行动串联起来。

**02 — Tools and Guardrails（工具 + 防护栏）**
这是 Agent 的"手脚"和"安全边界"。工具让 Agent 能够执行操作（读文件、写代码、运行命令等），防护栏确保 Agent 不会做危险的事情（比如删除重要文件）。

**03 — State: Context and Memory（状态：上下文 + 记忆）**
这是 Agent 的"记忆系统"。Context（上下文）是当前对话中的工作记忆，Memory（记忆）是跨对话保存的持久信息。

这三个组件相互配合，构成了一个完整的 Agent 系统。

---

## Slide 10 — Tool Categories：工具分类

Agent 的工具可以分为四大类：

**1. Search/Read（搜索/读取）**
这类工具让 Agent 能够查找和阅读信息。比如：
- 搜索文件（glob、grep）
- 阅读文件内容（read）
- 搜索代码库中的特定内容

**2. Edit/Write（编辑/写入）**
这类工具让 Agent 能够修改和创建文件。比如：
- 编辑现有文件（edit）
- 创建新文件（write）

**3. Execution（执行）**
这类工具让 Agent 能够运行命令。比如：
- 执行 shell 命令（bash）
- 运行测试
- 启动服务

**4. Others（其他）**
不属于以上三类的工具。比如：
- 网络搜索
- 图片生成
- 与外部服务交互

在编程 Agent 中，Search/Read 和 Edit/Write 是最核心的两类工具，因为编程的主要工作就是阅读代码和修改代码。

---

## Slide 11 — Search Approaches：四种搜索方式

现在让我们深入到 Search 工具的设计中。

当一个 Agent 需要在代码库中查找信息时，有四种主要的方法：

**1. Glob/Grep（字面搜索）**
最基础的搜索方式。Glob 按文件名模式匹配（比如"找到所有 .py 文件"），Grep 按文本内容匹配（比如"找到包含 'login' 的所有行"）。

**2. Semantic Index（语义索引）**
更高级的搜索方式。把代码库中的代码块（chunk）转换成向量嵌入（embedding），然后基于语义相似度来搜索。比如搜索"用户认证"，它能找到包含 "authentication"、"login"、"auth" 等相关代码。

**3. Extrinsic Signals（外部信号）**
利用代码之外的信息来定位问题。比如：
- Stack traces（堆栈跟踪）——告诉你错误发生在哪一行
- Failing tests（失败的测试）——告诉你哪个功能出了问题
- Git history（Git 历史）——告诉你谁最近改了什么

**4. Language Server / LSP（语言服务器）**
利用编译器/解释器的知识来搜索代码。LSP 是 Language Server Protocol 的缩写，它提供了代码的"符号图"——函数定义在哪里、被谁调用了、变量的类型是什么等。

---

## Slide 12 — Glob/Grep 详解

**Glob** 和 **Grep** 是最基础也是最常用的搜索工具。

**Glob** 是按文件名模式来搜索的。比如：
- `**/*.py` — 找到所有 Python 文件
- `src/**/*.ts` — 找到 src 目录下所有 TypeScript 文件
- `**/test_*` — 找到所有以 test_ 开头的文件

它的特点是：速度快，结果精确，但你需要知道文件名的模式。

**Grep** 是按文本内容来搜索的。比如：
- `grep -r "def login" .` — 在当前目录下递归搜索包含 "def login" 的文件
- `grep -r "TODO" src/` — 在 src 目录下搜索所有 TODO 注释

它的特点是：可以在所有内容中搜索，支持正则表达式，但你需要知道要搜索什么文本。

这两种方式都属于 **字面搜索（literal search）**——你搜索的是确切的字符串，而不是语义。它们的优势是速度快、结果确定，但劣势是你必须知道你要找的东西"长什么样"。

---

## Slide 13 — Semantic Index 详解

**Semantic Index（语义索引）** 是一种更高级的搜索方式。

它的工作原理是这样的：

1. 首先，把代码库中的所有代码分成小块（chunks）——比如每个函数或每个类是一个 chunk。
2. 然后，用嵌入模型（embedding model）把每个 chunk 转换成一个向量（一组数字）。这个向量代表了这段代码的"语义"。
3. 当你搜索的时候，你的搜索词也会被转换成向量。
4. 最后，通过比较向量之间的距离，找到语义最相近的代码块。

这种方式的优势是：你可以用自然语言来搜索代码。比如搜索"处理用户登录的逻辑"，它不需要代码中恰好有这几个字，只要语义相近就能找到。

劣势是：需要预先建立索引，而且结果不如字面搜索精确。

---

## Slide 14 — Extrinsic Signals 详解

**Extrinsic Signals（外部信号）** 是一种"借外力"的搜索方式。

它不是直接在代码中搜索，而是利用代码之外的信息来定位问题。常见的 extrinsic signals 包括：

**Stack Traces（堆栈跟踪）**：当程序出错时，系统会输出一个 stack trace，告诉你错误是在哪个文件的哪一行发生的。这是最直接的定位信息。

**Failing Tests（失败的测试）**：当测试失败时，测试框架会告诉你哪个测试失败了、期望什么结果但得到了什么结果。这能帮你快速定位有问题的功能。

**Git History（Git 历史）**：通过 `git log` 和 `git blame`，你可以看到谁在什么时候改了什么代码。如果你知道 bug 是最近引入的，git history 能帮你快速找到相关的改动。

这些信号的价值在于：它们不需要你去"搜索"，而是直接告诉你问题在哪里。Agent 如果能利用这些信号，就能大幅减少搜索的时间。

---

## Slide 15 — Language Server / LSP 详解

**Language Server Protocol（LSP，语言服务器协议）** 是一种让编辑器理解代码结构的协议。

你可能用过 VS Code 的"跳转到定义"、"查找所有引用"、"自动补全"等功能——这些功能的背后就是 Language Server。

LSP 为代码建立了一个"符号图"（symbol graph）——它知道：
- 每个函数定义在哪里
- 每个函数被谁调用了
- 每个变量的类型是什么
- 每个类的继承关系是什么

对于 Agent 来说，LSP 是一个非常强大的工具。比如当 Agent 想重命名一个函数时，它需要知道这个函数在哪里被调用了，才能更新所有的调用点。用 grep 搜索可能会漏掉一些情况（比如动态调用），但 LSP 能给出精确的结果。

劣势是：LSP 需要为每种编程语言单独配置，而且启动和维护成本较高。

---

## Slide 16 — Edit Approaches：四种编辑方式

现在让我们看看 Agent 怎么编辑代码。

和搜索一样，编辑代码也有四种主要的方法：

**1. Whole-file Rewrite（整文件重写）**
最简单的方式——Agent 重新生成整个文件的内容，然后替换原文件。

**2. Unified Diff / Patch（统一差异/补丁）**
Agent 不重新生成整个文件，而是只输出一个"差异描述"（diff），描述哪些行需要修改、添加或删除。然后由工具来应用这个 diff。

**3. Search and Replace（搜索替换）**
Agent 指定一个"锚字符串"（anchor string）和一个"替换字符串"（replacement string）。工具在文件中找到锚字符串，然后替换成替换字符串。就像你在编辑器里用 Ctrl+H 做替换一样。

**4. Structured / AST Edits（结构化/抽象语法树编辑）**
最高级的方式。Agent 不是操作文本，而是操作代码的"结构"。比如"给这个函数添加一个参数"、"把这个类重命名"——这些操作是在语法层面进行的，而不是简单的文本替换。

---

## Slide 17 — Whole-file Rewrite 详解

**Whole-file Rewrite（整文件重写）** 是最直观的编辑方式。

工作原理：Agent 读取整个文件，然后重新生成整个文件的新版本，最后用新版本替换旧版本。

优势：
- 实现简单——只需要一个写文件的功能
- Agent 可以自由地做任意修改，不受格式限制

劣势：
- 浪费 token——即使只改了一行，也要重新输出整个文件
- 容易出错——文件越长，Agent 越容易在输出过程中"走神"，导致其他部分被意外修改
- 对于大文件（几百行以上），这种方式几乎不可行

这种方式适合小文件或者需要大幅重构的场景，但对于日常的小修改来说，效率太低。

---

## Slide 18 — Unified Diff / Patch 详解

**Unified Diff / Patch（统一差异/补丁）** 是一种更高效的编辑方式。

工作原理：Agent 不重新生成整个文件，而是输出一个"diff"——一个描述"哪些行需要修改"的格式化文本。然后由工具来解析这个 diff 并应用到文件中。

比如一个 diff 可能长这样：
```
--- a/src/login.py
+++ b/src/login.py
@@ -10,3 +10,5 @@
 def login(user):
-    check_password(user)
+    if not check_password(user):
+        return False
+    return True
```

这个 diff 说的是：在第 10 行附近，把 `check_password(user)` 这一行替换成三行新代码。

优势：
- 节省 token——只输出修改的部分
- 修改意图明确——diff 清楚地展示了要改什么

劣势：
- 解析 diff 需要精确的格式，格式错误会导致应用失败
- 对于大范围的修改，diff 也可能很复杂

---

## Slide 19 — Search and Replace 详解

**Search and Replace（搜索替换）** 是一种简洁而高效的编辑方式。

工作原理：Agent 提供两个信息：
1. **Anchor string（锚字符串）**：要被替换的原始文本
2. **Replacement string（替换字符串）**：替换后的新文本

工具在文件中找到锚字符串，然后用替换字符串替换它。

比如：
- Anchor: `check_password(user)`
- Replacement: `if not check_password(user): return False`

优势：
- 极其简洁——Agent 只需要输出两段文本
- 精确——只要锚字符串在文件中是唯一的，就不会出错
- 节省 token

劣势：
- 锚字符串必须是唯一的——如果文件中有多个相同的字符串，就不知道该替换哪一个
- 不适合大范围的修改

这是目前很多 coding agent（包括 Claude Code）使用的主要编辑方式，因为它在简洁性和精确性之间取得了很好的平衡。

---

## Slide 20 — 四种搜索方式对比总结

让我们用一张表来总结四种搜索方式的对比：

| 方式 | 通过什么找代码 | 最适合的场景 | 主要代价 |
|------|-------------|------------|---------|
| **Glob/Grep** | 字面名称/路径 | 你知道确切的文件名或文本 | 需要知道搜索什么 |
| **Semantic Index** | 嵌入向量的语义相似度 | 你只有模糊的概念描述 | 需要预建索引，结果可能不精确 |
| **Extrinsic Signals** | 堆栈跟踪、测试失败、Git 历史 | 有明确的外部错误信号 | 依赖于信号的存在和质量 |
| **Language Server/LSP** | 编译器的符号图 | 需要精确的代码结构信息 | 需要为每种语言配置 |

这四种方式不是互斥的——一个好的 coding agent 通常会同时使用多种方式。比如先用 grep 搜索关键词，再用 LSP 确认符号的引用关系。

---

## 总结

这一讲我们学习了 Agent 设计的核心基础：

**ReAct Loop** 告诉我们 Agent 是怎么"思考"和"行动"的——每一轮先推理，再行动，再观察结果，然后继续下一轮。

**Agent Loop** 告诉我们 Agent 循环的内部机制——消息列表、模型调用、工具执行、结果回传。

**Agent Harness Designer 的职责** 告诉我们作为设计者需要做什么——定义工具、组装上下文、验证请求、管理状态。

**Tool Design** 告诉我们搜索和编辑工具的四种设计方案及其优缺点。

这些知识不仅帮你理解 Agent 是怎么工作的，也为下一讲——更深入地设计 Agent 系统——打下了基础。

---
