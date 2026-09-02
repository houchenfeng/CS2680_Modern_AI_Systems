# Assignment 1 前端全功能测试 TODO

> 测试目标：验证 `simple-chatapp` 的所有主要前端功能、真实 LLM 回应、工具审批、运行控制、Trace 与恢复流程。
>
> 测试入口：`http://127.0.0.1:5173/`。后端：`http://127.0.0.1:3001/`。
>
> 安全约束：测试工作目录限定在 `AGENT_WORKSPACE_ROOT`；写入仅使用 `simple-chatapp/browser-validation-temp.txt`；Bash 只运行安全等待/输出命令；不输入、显示或下载真实密钥。

## 0. 环境与自动化策略

- [x] 前端使用 `127.0.0.1:5173`，内置浏览器可正常访问，无需改变端口。
- [x] 后端使用 `3001`，前端 REST 通过 Vite proxy，WebSocket 直接连接 `ws://127.0.0.1:3001/ws`。
- [x] Browser 插件可用，优先使用内置浏览器自动化；不使用外部浏览器绕过安全策略。
- [x] 记录桌面视口、390×844 窄屏视口、浏览器控制台和关键页面截图证据。

## 1. 页面基础与会话列表

- [x] 页面标题、URL 和首屏内容正确，不是空白页。
- [x] 无 Vite/React 错误覆盖层。
- [x] Workspace path 可输入 `simple-chatapp`；`.` 由同一 workspace 校验逻辑覆盖。
- [x] New session 能创建、自动选中，并显示真实 cwd、权限策略与 `new/resumable` 状态。
- [x] 选择不同会话不会崩溃或丢失列表。
- [ ] 删除会话按钮尚未单独点击验收；为保留本轮 Trace 证据未删除测试会话。
- [x] 空状态和未选择会话状态清晰。

## 2. 对话与真实 LLM 回应

- [x] 普通文本任务能收到 `assistant_message` 和成功 `run_result`。
- [x] Read demo：LLM 使用 Read 读取 `simple-chatapp/package.json`。
- [x] Read 工具卡片从 `running` 更新为 `success`，结果不会只存在于最终回答。
- [x] Read 最终回答正确包含项目名 `simple-chatapp`、关键 scripts 和主要依赖。
- [x] 同一会话连续追问及后端重启后均能获得依赖前文的 LLM 回应（返回 `ALLOW_TEST`）。
- [x] 运行期间输入框和 Send 状态正确，完成后恢复可用。
- [x] LLM/SDK/工具拒绝错误能在页面显示，不造成整页崩溃。

## 3. 工具审批

- [x] Write demo 触发审批卡片，展示工具名和输入。
- [x] Deny 后产生 `permission_result=deny`，工具不执行，LLM 能解释拒绝结果。
- [x] Allow once 后仅本次 Write 获准，文件 `browser-validation-temp.txt` 内容曾校验为 `ALLOW_TEST`，验收结束已清理。
- [ ] Always this session 尚未单独执行浏览器验收；会话内存隔离由实现保证，但不在本轮标记通过。
- [x] 重复点击/过期 requestId 不造成串线或页面崩溃（自动化测试覆盖 requestId 隔离与重复决定幂等）。
- [x] 客户端断开时待审批默认拒绝，重连时未决审批会明确重放（自动化测试覆盖）。

## 4. Stop 与继续运行

- [x] 安全长任务触发 Bash 审批并可 Allow。
- [x] `running/waiting_permission` 时 Stop 可用，其他状态不可用。
- [x] Stop 后产生 `run_result=stopped`，已有轨迹保留。
- [x] 重复 Stop 幂等，不产生重复停止事件（自动化测试覆盖）。
- [x] Stop 后可发送普通消息并收到新的 LLM 回应。

## 5. Trace Viewer、Token 与导出

- [x] Trace Viewer 可打开并列出当前会话 runs。
- [x] 事件按 sequence 排序，显示相对耗时、eventId、runId、toolUseId。
- [x] `tool_start` 与 `tool_result/tool_error` 视觉配对。
- [x] Event type、Tool、Errors only 过滤器可用。
- [x] 长输入/输出默认折叠，截断规则与 `truncated/originalLength` 由自动化测试覆盖。
- [x] Token ledger 显示 input/output/cache read/cache write/total/cost/duration/measurement。
- [x] 隐藏上下文明确显示 `unavailable`。
- [x] Context 汇总事件数、bytes、estimatedTokens 合理。
- [x] Download JSONL 可用，HTTP 200，下载字节与落盘 JSONL 完全一致。
- [x] Context CSV 可下载为 UTF-8；中文、引号和多行转义由自动化测试覆盖。

## 6. 刷新、恢复与重启

- [x] 刷新页面后会话列表、消息和 Trace 可重新打开且不重复。
- [ ] “刷新瞬间恰有待审批”未单独手工制造；断线拒绝/重放由自动化测试覆盖。
- [x] 重启后端后原 chat 仍存在。
- [x] 使用同一 `sdkSessionId=7a2d7375-0b88-429c-9708-a261348d3c66` Resume，并正确回答依赖上一轮上下文的问题 `ALLOW_TEST`。
- [x] 页面明确说明恢复不是历史文件系统快照。

## 7. 控制台、网络和响应式

- [x] 创建、选择、发送、审批、Stop、Trace 过程中无应用自身 console error/warn。
- [x] REST `/api/chats`、workspace、traces 与 WebSocket 可用。
- [x] 后端错误提示和导出轨迹不会泄漏密钥或完整认证信息（redaction 测试及 diff 扫描通过）。
- [x] 桌面布局无明显遮挡、溢出、滚动陷阱。
- [x] 390×844 窄屏下 Workspace/New session、会话选择、输入、Stop、审批和 Trace 入口可用。

## 8. 工程回归

- [x] `npm run typecheck`。
- [x] `npm test`：25/25 通过。
- [x] `npm run lint`。
- [x] `npm run format:check`。
- [x] `npm run build -- --emptyOutDir`。
- [x] `npm audit --audit-level=moderate`：0 vulnerabilities。
- [x] `git diff --check` 与敏感值扫描。

## 9. 测试结果记录

- 测试日期：`2026-09-02`（首轮浏览器验收 + 10:40 调用路径复验）
- 浏览器：`Codex In-app Browser`（首轮）；本轮复验使用 REST/WebSocket 脚本 + 前端 HTTP 200
- 桌面视口：`内置浏览器默认桌面视口，通过`（首轮）
- 窄屏视口：`390×844，通过`（首轮）
- 自动化结论：`主要前端流程、真实 LLM、审批、Stop、Trace、导出、刷新和重启恢复均通过；2 个刻意保留的手工边界项未虚假勾选。2026-09-02 10:40 调用路径复验 18/18 检查项全部通过。`
- LLM demos：`Read、Write Deny、Write Allow once、Stop 后继续、重启 Resume 均获得真实 deepseek-v4-pro-0813 回应；本轮复验 CALL_PATH_OK 无工具调用。`
- 已发现并修复：`Vite 8 WebSocket hook 导入空白页；scrollIntoView effect 清理异常；跨会话事件串线；Session 异步创建竞态；完成后残留/迟到审批；窄屏横向裁切。`
- 尚未单独手工执行：`删除会话按钮；Always this session；刷新恰逢待审批。前两项保留为明确 TODO，最后一项已有断线安全自动化覆盖。`
- 端口/安全结论：`无需改端口。前端固定使用 127.0.0.1:5173；3001 是后端 API/WebSocket，不应作为 Vite 前端入口。自动化写入仅限临时文件且已清理。`
- 工程回归（10:40 复验）：`npm test 25/25 通过；verify-call-path.mjs 18/18 通过。`

## 10. Agent 对话调用路径与记录验收

### 10.1 调用路径

```text
ChatInput / Send
  -> App.sendJsonMessage({ type: "chat", chatId, content })
  -> WebSocket ws://127.0.0.1:3001/ws
  -> server.ts getOrCreateSession(chatId)
  -> Session.sendMessage(content)
  -> AgentSession.sendMessage(content)
  -> Agent SDK getOutputStream()
  -> normalizeSdkMessage()
  -> TrajectoryStore.append(JSONL)
  -> WebSocket agent_event
  -> App 按 chatId 去重并更新 ChatWindow / TraceViewer
```

- [x] 前端发送的 `chatId` 和内容由 WebSocket 正确到达服务端。
- [x] `getOrCreateSession` 使用 single-flight，订阅与发送并发时不会创建两个 Session。
- [x] 一个 WebSocket 客户端仅订阅当前会话，其他会话事件不会串入。
- [x] 用户消息先写入消息存储，再发送给 Agent SDK。
- [x] Agent SDK 输出由 `normalizeSdkMessage` 转换为统一 `AgentEvent`。
- [x] 每个事件先追加到 JSONL，再通过 `agent_event` 广播；前端看到的事件包含落盘后的 sequence。
- [x] Assistant 文本同时进入消息历史和 Trace，内容一致。
- [x] `run_result` 更新会话状态并携带 token、cost、duration 与 measurement。
- [x] 前端按 `eventId` 去重、按当前 `chatId` 隔离，并在 `run_result` 后刷新会话列表。
- [x] 下载 JSONL 与服务端落盘文件逐字节一致，记录链没有二次转换差异。

### 10.2 真实 LLM 调用证据

#### 首轮（2026-09-02 浏览器验收）

- 验收会话：`5fc4eb97-b498-4d37-ae33-84e854fe1032`
- Run：`run-6dedcfbe-2135-43a3-ab3f-f42dbc35d94e`
- SDK Session：`cf0033c6-e1be-478f-b5b3-4c57409965ba`
- 模型：`deepseek-v4-pro-0813`
- 输入：`这是调用路径验收。请只回答 CALL_PATH_OK，不要使用任何工具。`
- 输出：`CALL_PATH_OK`
- 结果：`success`，总 Token `6272`（input `71`、output `57`、cache read `6144`、cache write `0`），reported cost `$0.0029112`，服务端记录 duration `5236ms`。
- 事件顺序：`1 user_message -> 2 system -> 3 assistant_message -> 4 run_result(success)`。
- 一致性：四个事件具有相同 `chatId` 和 `runId`；SDK 产生的三个事件具有相同 `sdkSessionId`；消息历史中的 user/assistant 文本与 Trace 完全一致。

#### 复验（2026-09-02 10:40，服务已运行 + `scripts/verify-call-path.mjs`）

- 服务状态：`127.0.0.1:5173`（Vite）与 `127.0.0.1:3001`（Express/WebSocket）均已监听；前端 HTTP 200。
- 验收会话：`df43b4b7-4619-4328-8df1-a4ee9b61aa74`
- Run：`run-3f1ca084-ea8c-4007-acee-994d11c89b88`
- SDK Session：`83be8091-d0b2-4129-8630-0f9e7dc64154`
- 模型：`deepseek-v4-pro-0813`
- 工作目录：`G:\CS2680_Modern_AI_Systems\assignment1\simple-chatapp`（workspacePath=`simple-chatapp`）
- 输入：`这是调用路径验收。请只回答 CALL_PATH_OK，不要使用任何工具。`
- 输出：`CALL_PATH_OK`
- 结果：`success`，总 Token `6220`（input `71`、output `5`、cache read `6144`、cache write `0`），reported cost `$0.0021312`，duration `4163ms`。
- 事件顺序：`1 user_message -> 2 system -> 3 assistant_message -> 4 run_result(success)`。
- JSONL SHA-256：`E5B9F3FBBDB94ECAA56687194351A40E2AEFF4610F5D03A7483C8E2412B891C4`（WebSocket 事件与 `GET /api/traces/.../raw` 下载逐字节一致）。
- 18 项检查：`workspace API、create chat、websocket connect、user/assistant/run_result 记录、chatId/runId/sequence 一致性、消息历史、Trace 列表、JSONL 配对、脱敏、Token 账本、chat status=completed` 全部通过。
- 会话状态：复验结束后 chat 状态为 `completed`，无残留 `running/waiting_permission`。

### 10.3 重启与异常记录

- [x] 服务重启后，带 `sdkSessionId` 的瞬态 `running/waiting_permission` 自动归一化为 `resumable`。
- [x] 服务重启后，不带 `sdkSessionId` 的瞬态 `running/waiting_permission` 自动归一化为 `error`。
- [x] 归一化结果立即重新持久化，未选择的旧会话也不会继续显示虚假的运行状态。
- [x] 完成后的未决权限会安全拒绝；迟到的权限回调直接拒绝，不会把已完成会话重新改为等待审批。
- [x] Stop、权限超时、客户端断开、重复 permission requestId 和轨迹脱敏均有自动化测试覆盖。

### 10.4 本轮发现与修复

- 发现：旧实现仅在某个会话被选中并创建 Session 时纠正重启前的瞬态状态，导致未选中的历史会话可能长期显示 `running/waiting_permission`。
- 修复：`ChatStore.load()` 在加载全部记录时统一归一化并持久化状态。
- 回归测试：新增“重载持久化记录时归一化中断状态”，同时保留 SDK Resume、消息映射、事件配对和权限安全测试。
- 最终结论：Agent 对话主调用路径、消息历史、运行轨迹、SDK 会话映射和恢复记录均可正常使用。

## 11. 调用路径复验脚本

复验命令（需后端 `3001` 已启动且 `.env` 已配置）：

```powershell
cd assignment1/simple-chatapp
npm test
node scripts/verify-call-path.mjs
```

脚本覆盖的调用链与 §10.1 一致：REST 创建会话 → WebSocket subscribe/chat → 收集 `agent_event` → 对照消息历史、Trace 列表、JSONL 落盘与 Token summary。2026-09-02 10:40 执行结果：`ok=true`，18/18 checks passed。
