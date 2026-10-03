# 第三讲：Agent Use II — Multi-agent and Best Practice — 讲稿

---

## Slide 1 — 标题页

大家好，欢迎来到第三讲。今天我们要聊的主题是 **Agent Use Part II**，也就是从使用者视角来看 Agent 的多智能体协作和最佳实践。

在上一讲中，我们了解了 Agent 的核心运行机制——Agentic Loop，以及它的记忆系统。今天我们更进一步，来看看当一个 Agent 不够用的时候，我们怎么让多个 Agent 协同工作，以及在实际开发中怎么用好 Agent。

我们会通过两个真实的案例来学习：一个是 **Superpowers**，一个教 Agent 按照最佳实践来写代码的插件；另一个是 **Caveman**，一个通过压缩 token 来延长 Agent 工作时间的工具。

---

## Slide 2 — 课程大纲

这一讲的内容分为四个部分：

**第一部分：Superpowers 案例研究**。这是一个非常有趣的插件，它能让你原本"自由散漫"的 Agent 变成一个严格遵守软件工程最佳实践的"专业开发者"。

**第二部分：Skills 深入解析**。我们会拆解 Superpowers 的核心机制——Skills，看看它是怎么通过一系列精心设计的指令文件来规范 Agent 行为的。

**第三部分：Caveman 案例研究**。这是一个解决"token 焦虑"的工具——当你的对话越来越长、上下文越来越大的时候，Caveman 帮你压缩信息，让 Agent 能工作更久。

**第四部分：Plugin 打包与分发**。最后我们会看看怎么把这些工具打包成可以分享和安装的插件。

---

## Slide 3 — 问题引入：为什么需要 Best Practice？

让我们先想一个问题：当你让 Claude Code 帮你实现一个功能的时候，它通常是怎么做的？

大多数情况下，流程是这样的：你告诉它"帮我加一个功能"，然后它直接开始写代码，写完之后再通过不断的修修补补来解决问题。我们可以把这个叫做 **DEFAULT 模式**——"Feature request → Start coding → Fix by iteration"。

这个模式有什么问题呢？想象一下，你让一个实习生帮你写代码，他二话不说就开始敲键盘，没有设计方案，没有测试，写完也不检查——你是不是会很担心？

Agent 也是一样的。它默认的行为就是"拿到需求就开干"，但一个专业的软件工程师应该怎么做呢？他应该先理解需求，然后设计方案，再开始编码，写完之后还要测试和 review。

**Superpowers** 这个插件就是来解决这个问题的。

---

## Slide 4 — Superpowers 是什么？

**Superpowers** 是一个为 Claude Code 设计的 **Plugin**（插件）。你可以把它理解为给 Agent 装的一套"工作方法论"。

安装很简单，一行命令：

```
/plugin install superpowers@claude-plugins-official
```

安装之后，Agent 的行为模式就会发生根本性的变化。它不再是你说什么就做什么的"工具人"，而是变成了一个有完整工作流程的"专业工程师"。

具体来说，Superpowers 把开发流程分成了三个阶段：**PLAN**（规划）、**BUILD**（构建）、**SHIP**（交付）。每个阶段都有明确的步骤和要求。

---

## Slide 5 — DEFAULT vs HUMAN：两种工作流对比

让我们更详细地对比一下这两种模式。

**DEFAULT 模式**（也就是没有 Superpowers 的时候）：
- 你提出功能需求
- Agent 直接开始写代码
- 出了问题再修
- 循环往复，直到"能用"

**HUMAN 模式**（装了 Superpowers 之后）：
Agent 会严格按照 7 个步骤来工作：
1. 先理解你要做什么
2. 做头脑风暴，探索各种可能性
3. 写一个详细的实施计划
4. 在一个隔离的环境中开始工作
5. 用测试驱动的方式写代码
6. 请求代码审查
7. 验证完成后再交付

这就像是从"野路子"变成了"正规军"。每一步都有章法，每一步都有质量保障。

---

## Slide 6 — Nine Skills：九个核心技能

Superpowers 的核心是 **9 个 Skills**（技能）。你可以把每个 Skill 理解为一个"标准操作流程"——它告诉 Agent 在特定场景下应该怎么做。

让我们逐一了解：

1. **using-superpowers**：这是"元技能"，教 Agent 怎么使用其他技能。就像一本说明书的目录，告诉 Agent 什么时候该调用哪个技能。

2. **brainstorming**：头脑风暴技能。在开始写代码之前，Agent 会先和你讨论需求，探索不同的实现方案，而不是拿到需求就开干。

3. **writing-plans**：写计划技能。Agent 会把要做的事情拆成具体的步骤，写成一个详细的计划文档。

4. **using-git-worktrees**：使用 Git Worktree 技能。Agent 会创建一个独立的工作空间来做开发，不会影响你正在使用的代码。

5. **test-driven-development**：测试驱动开发技能。Agent 会先写测试，再写实现代码，确保每一行代码都有测试覆盖。

6. **systematic-debugging**：系统化调试技能。遇到 bug 的时候，Agent 不会盲目地改代码，而是会系统地分析问题根因。

7. **requesting-code-review**：请求代码审查技能。写完代码后，Agent 会自己检查一遍，确保代码质量。

8. **verification-before-completion**：完成前验证技能。在宣布"我做完了"之前，Agent 会先验证所有功能都正常工作。

9. **finishing-a-development-branch**：完成开发分支技能。最后把开发分支合并回主分支，完成整个流程。

---

## Slide 7 — Superpowers 架构

现在让我们看看 Superpowers 的技术架构。

作为一个 Claude Code 的 **Plugin**，它的文件结构是这样的：

```
.claude-plugin/          # 插件的根目录
├── hooks/               # 钩子——在特定事件发生时自动执行的脚本
│   └── session-start.sh # 会话开始时自动运行的脚本
├── skills/              # 技能库——9 个技能的定义文件
│   ├── brainstorming/
│   ├── writing-plans/
│   ├── test-driven-development/
│   └── ...
└── tests/               # 测试文件
```

这里有两个关键概念需要解释：

**Hooks（钩子）**：你可以把它理解为"触发器"。比如"SessionStart hook"就是在每次新对话开始的时候自动执行的脚本。Superpowers 用它来在对话一开始就把所有技能的说明加载到 Agent 的上下文中。

**Skills（技能）**：每个技能是一个文件夹，里面有一个 `SKILL.md` 文件，用自然语言描述了这个技能的使用方法和规则。

---

## Slide 8 — Anatomy of a Skill：技能的结构

让我们深入看一个 Skill 的内部结构。

每个 Skill 都是一个文件夹，核心是一个 `SKILL.md` 文件。这个文件分为两部分：

**Front Matter（前置元数据）**：文件开头的 YAML 格式信息，包含了技能的名称、描述、触发条件等元数据。就像一张名片，告诉 Agent "我是谁，什么时候该用我"。

**Body（正文）**：用 Markdown 写的详细指令，告诉 Agent 具体应该怎么做。

一个 SKILL.md 文件包含 **6 个核心组件**：

1. **name**：技能名称，比如 "brainstorming"
2. **description**：描述，说明这个技能是做什么的
3. **Instructions**：具体指令，告诉 Agent 应该执行哪些步骤
4. **Checkpoints**：检查点，在关键步骤需要确认的地方
5. **References**：参考资料，指向其他相关文档或技能
6. **Scripts**：脚本，技能执行过程中可能需要运行的自动化脚本

---

## Slide 9 — Process Skill：流程型技能

在 Superpowers 中，很多技能属于 **Process Skill**（流程型技能）。这类技能的特点是：它定义了一个完整的工作流程，Agent 必须严格按照流程来执行。

一个 Process Skill 包含以下要素：

- **Entry conditions（进入条件）**：什么情况下可以启动这个技能。比如"brainstorming"技能的进入条件可能是"用户提出了一个新功能需求"。

- **Required actions（必须执行的操作）**：在这个流程中，Agent 必须做的事情。比如"至少提出 3 个不同的方案"。

- **Prohibited actions（禁止的操作）**：在这个流程中，Agent 不能做的事情。比如"不能在 brainstorming 阶段就开始写代码"。

- **Human approval gates（人工审批节点）**：在哪些步骤需要等待用户确认才能继续。比如"在开始写代码之前，必须等用户确认方案"。

- **Verification requirements（验证要求）**：怎么判断这个流程已经正确完成了。比如"所有测试都通过了"。

- **Next applicable skill（下一个适用的技能）**：完成这个流程后，应该进入哪个技能。比如"brainstorming 完成后，进入 writing-plans"。

这就像一条流水线上的工序——每一步都有明确的输入、输出和质量标准。

---

## Slide 10 — Why Skills Alone Are Not Enough

讲到这里，你可能会想：既然 Skills 这么强大，那我们只需要写好 SKILL.md 文件不就行了吗？为什么还需要别的机制？

答案是：**Skills 本身是被动的**。

SKILL.md 文件只是一堆文本。它需要被加载到 Agent 的上下文中才能生效。但问题是——什么时候加载？怎么加载？

如果你只是把这些文件放在那里，Agent 不一定会去读它们。就像你给员工一本操作手册，他不一定会翻开来看。

所以我们需要一个 **确定性的时机** 来确保这些技能说明被加载。这就是 **Hooks（钩子）** 的作用。

---

## Slide 11 — Hooks：确保技能被加载

Superpowers 使用了一个 **SessionStart Hook**，也就是"会话开始钩子"。

它的工作原理是这样的：

```json
{
  "hooks": {
    "SessionStart": {
      "command": "bash hooks/session-start.sh"
    }
  }
}
```

这段配置的意思是：**每次新对话开始的时候，自动执行 `session-start.sh` 这个脚本**。

这就解决了一个关键问题：你不需要手动告诉 Agent "请去读一下技能说明"，系统会在对话开始的时候自动完成这件事。

这是一个非常重要的设计思想：**确定性（deterministic）的时机 + 动态的内容加载**。

---

## Slide 12 — Session-Start Script：启动脚本

让我们看看这个启动脚本具体做了什么。

```bash
#!/bin/bash
# 读取 bootstrap 技能文件
SKILL_CONTENT=$(cat skills/using-superpowers/SKILL.md)

# 将内容转义为 JSON 安全的格式
ESCAPED_CONTENT=$(echo "$SKILL_CONTENT" | jq -Rs .)

# 输出 JSON，将技能内容注入到 Agent 的上下文中
echo "{\"additionalContext\": $ESCAPED_CONTENT}"
```

这个脚本做了三件事：

1. **读取** bootstrap 技能文件（`using-superpowers/SKILL.md`）的内容
2. **转义**内容中的特殊字符，使其可以安全地嵌入 JSON
3. **输出**一个 JSON 对象，把技能内容作为 `additionalContext`（额外上下文）注入到 Agent 中

这样，当对话开始的时候，Agent 就已经"知道"了所有的技能规则。就像一个新员工入职的第一天，HR 就已经把公司规章制度发到了他的邮箱里。

---

## Slide 13 — End-to-End Walkthrough：完整流程演示

现在让我们通过一个完整的例子来看看 Superpowers 是怎么工作的。

假设你对 Agent 说：**"Add authentication"（添加认证功能）**

接下来会发生什么？

**Step 1 — Brainstorming（头脑风暴）**
Agent 不会直接开始写代码。它会先和你讨论：
- 你需要什么类型的认证？OAuth？用户名密码？
- 用什么方案？JWT？Session？
- 需要支持哪些功能？注册？登录？忘记密码？

**Step 2 — Writing Plans（写计划）**
讨论清楚之后，Agent 会写一个详细的实施计划：
- 第一步：创建用户模型
- 第二步：实现注册接口
- 第三步：实现登录接口
- ...

**Step 3 — Isolated Worktree（隔离工作空间）**
Agent 会创建一个 Git Worktree——你可以把它理解为代码仓库的一个"分身"。在这个分身里工作不会影响你正在使用的代码。

**Step 4 — Test-Driven Build（测试驱动开发）**
Agent 会先写测试，再写实现。比如先写一个"用户应该能成功登录"的测试，然后再写实现代码让这个测试通过。

**Step 5 — Code Review（代码审查）**
写完之后，Agent 会自己审查一遍代码，检查有没有安全问题、性能问题等。

**Step 6 — Verification（验证）**
Agent 会运行所有测试，确保一切正常。

**Step 7 — Branch Integration（分支合并）**
最后，Agent 会把开发分支合并回主分支，完成整个流程。

---

## Slide 14 — Design Lessons From Superpowers

从 Superpowers 的设计中，我们可以总结出 6 个重要的设计问题和答案：

**Q1: 怎么让 Agent 知道有哪些技能可以用？**
A: 通过 SessionStart Hook 在对话开始时自动加载技能说明。

**Q2: 怎么控制技能的执行顺序？**
A: 在每个技能的定义中明确指定"下一个适用的技能"，形成一个技能链。

**Q3: 怎么防止 Agent 跳过某些步骤？**
A: 设置 Human approval gates（人工审批节点），在关键步骤必须等用户确认。

**Q4: 怎么让 Agent 在隔离的环境中工作？**
A: 使用 Git Worktree 技能，创建一个独立的工作空间。

**Q5: 怎么保证代码质量？**
A: 通过 Test-Driven Development 和 Code Review 技能来确保。

**Q6: 怎么知道任务真的完成了？**
A: 通过 Verification 技能来验证所有功能都正常工作。

这 6 个问题的答案，构成了一个完整的 Agent 行为控制框架。

---

## Slide 15 — Caveman 案例研究：Token 压缩

现在让我们来看第二个案例：**Caveman**。

如果说 Superpowers 解决的是"怎么让 Agent 做得更好"的问题，那 Caveman 解决的就是"怎么让 Agent 做得更久"的问题。

在讲 Caveman 之前，我们需要先理解一个背景问题：**为什么要压缩 token？**

在使用 Agent 的过程中，有三个核心痛点：

1. **Context fills up（上下文会填满）**：每次你和 Agent 对话，所有的历史记录、代码内容、工具输出都会占用上下文窗口。当窗口满了之后，Agent 就无法继续工作了。

2. **Every turn costs（每一轮都有成本）**：每一轮对话，Agent 都需要把整个上下文发送给模型。上下文越大，消耗的 token 越多，费用越高，速度也越慢。

3. **Compaction loses detail（压缩会丢失细节）**：当上下文快满的时候，系统会自动进行"压缩"（compaction），但这个过程会丢失很多重要细节。

---

## Slide 16 — Caveman 的解决方案：双向压缩

Caveman 的思路很巧妙：它从两个方向来压缩 token。

**方向一：输入压缩（Input Compression）**
当你和 Agent 交互时，会产生大量的输入信息：日志输出、代码 diff、文件内容等。Caveman 通过一个 **本地代理（local proxy）** 来压缩这些输入信息。

什么是本地代理？你可以把它理解为一个"中间人"。Agent 本来应该直接和 AI 模型通信，但现在中间多了一个代理层。这个代理会在发送请求之前，先把输入内容压缩一遍。

**方向二：输出压缩（Output Compression）**
Agent 的回复也可以被压缩。Caveman 通过一个专门的 **Response Skill** 来压缩 Agent 的输出，使其更简洁。据统计，这可以减少 **65%** 的输出 token。

两个方向加起来，Caveman 大幅减少了 token 的消耗，让 Agent 能工作更长时间。

---

## Slide 17 — Caveman 七步流程

让我们一步步走一遍 Caveman 的工作流程：

**Step 1 — Hook stores mode（钩子记录模式）**
当对话开始时，一个 Hook 会记录当前是否处于"Caveman 模式"。

**Step 2 — Hook injects reminder（钩子注入提醒）**
如果是 Caveman 模式，Hook 会注入一条提醒，告诉 Agent "请用简洁的方式回复"。

**Step 3 — Agent executes（Agent 执行任务）**
Agent 正常工作——读文件、写代码、运行命令等。

**Step 4 — Proxy compresses（代理压缩输入）**
当 Agent 要向模型发送请求时，本地代理会拦截请求，把其中的日志、diff、文件内容等压缩成更简洁的版本。

**Step 5 — Model receives reduced context（模型收到精简的上下文）**
模型收到的是压缩后的上下文，而不是原始的完整信息。

**Step 6 — Model returns concise diagnosis（模型返回简洁的诊断）**
因为上下文已经被压缩了，模型的回复也会更加简洁。再加上 Response Skill 的压缩效果，输出 token 大幅减少。

**Step 7 — MCP retrieves original on demand（按需检索原始内容）**
如果模型需要查看原始内容（比如完整的日志），它可以通过 MCP 工具按需检索，而不是一开始就把所有内容都塞进上下文里。

这个流程的精妙之处在于：**它不是简单地丢弃信息，而是把信息分层——压缩版用于日常推理，原始版按需获取**。

---

## Slide 18 — Response Skill：输出压缩技能

Caveman 的 Response Skill 是一个专门用来压缩 Agent 输出的技能。

它的压缩策略很有意思——它不是简单地删减内容，而是有一套明确的规则：

**需要保留的内容**：
- Technical terms（技术术语）
- Commands（命令）
- Paths（路径）
- Code（代码）
- Errors（错误信息）
- Numbers（数字）
- Units（单位）
- Negation（否定表达，比如"不要做这个"）

**需要删除的内容**：
- Filler（填充词，比如"嗯"、"其实"）
- Repetition（重复内容）
- Pleasantries（客套话，比如"很高兴帮助你"）
- Hedging（模糊表达，比如"可能也许大概"）

这样做的效果是：输出的信息密度大幅提高，但关键信息一点没丢。

---

## Slide 19 — Plugin 打包与分发

最后，让我们看看怎么把这些工具打包成可以分享的插件。

一个 Plugin 的仓库结构通常是这样的：

```
my-plugin/
├── plugin.json           # 插件清单文件
├── .claude-plugin/
│   ├── hooks/            # 钩子脚本
│   ├── skills/           # 技能定义
│   └── scripts/          # 辅助脚本
└── README.md             # 说明文档
```

其中最重要的是 **plugin.json**——插件清单文件。它是一个 JSON 文件，包含了插件的所有元数据：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A plugin that does X",
  "hooks": {
    "SessionStart": {
      "command": "bash .claude-plugin/hooks/session-start.sh"
    }
  },
  "skills": [
    "skills/my-skill"
  ]
}
```

这个文件告诉 Claude Code：这个插件叫什么、有哪些钩子需要注册、有哪些技能需要加载。

打包好之后，其他用户就可以通过一行命令来安装你的插件了。

---

## Slide 20 — 总结

让我们总结一下这一讲的内容。

我们学习了两个重要的案例：

**Superpowers** 教我们怎么通过 **Skills** 和 **Hooks** 来规范 Agent 的行为，让它按照软件工程的最佳实践来工作。核心思想是：
- 用 Skills 定义标准操作流程
- 用 Hooks 确保技能在正确的时机被加载
- 用 Process Skill 控制执行顺序和质量

**Caveman** 教我们怎么通过 **Token 压缩** 来延长 Agent 的工作时间。核心思想是：
- 用本地代理压缩输入信息
- 用 Response Skill 压缩输出信息
- 按需检索原始内容，而不是一次性全部加载

这两个案例的共同点是：它们都是通过 **扩展机制**（Hooks、Skills、Plugin）来增强 Agent 的能力，而不是修改 Agent 本身。

这就是 Agent 生态的魅力——你不需要重新造一个 Agent，只需要给它装上合适的"装备"，它就能变成一个完全不同的"角色"。

---
