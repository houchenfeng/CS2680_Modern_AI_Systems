# Assignment 1 临时收尾 TODO

> 核对日期：2026-09-02  
> 事实基线：`Assignment1_Modification_TODO.md` 与当前 `simple-chatapp` 源码。  
> 用途：只跟踪尚未完成或缺少证据的项目；完成后把结果回填主 TODO，并删除本文件。不要再创建其他进度、总结或测试报告 Markdown。

## 当前结论

- 主 TODO 的阶段记录、修改摘要、结果摘要和运行指南均已填写，没有空白待填字段。
- 剩余内容不是文字补空，而是代码完善、自动化覆盖和浏览器验收。
- 主 TODO 末尾两个“完成定义”复选框只有在本清单相关任务完成后才能勾选。

## P0：安全与恢复

- [x] `R1` 恢复已有会话前，重新对持久化 `cwd` 执行存在性、目录类型、允许根目录和 `realpath` 边界验证。
- [x] `R2` 工作目录丢失或越界时，保留原 chat、消息和 trace，返回明确错误；不得静默创建新 SDK 会话。
- [x] `R3` 增加符号链接逃逸测试，以及恢复 cwd 丢失/越界测试。
- [x] `R4` 完成后更新主 TODO 的 B4、B5、E3、5.2、5.3、结果摘要和完成定义。

验收条件：创建与恢复路径共用同一安全解析规则；上述失败路径有自动化测试，且不会调用 SDK `query()`。

## P1：运行控制和审批边界

- [x] `C1` 明确每个 run 的 interrupt/abort 生命周期，防止上一轮句柄影响下一轮。
- [x] `C2` 前端 Stop 按钮严格依据 `running`/`waiting_permission` 状态启用，而不是仅依据本地 loading 状态。
- [x] `C3` 增加 Stop 正常中断、重复 Stop、已完成后 Stop 和停止后继续发送消息测试。
- [x] `C4` 增加 Allow、Deny、短超时、客户端断开、两个并发审批不串线测试。
- [x] `C5` 增加后端重启后恢复同一 SDK session 的自动化集成测试。
- [x] `C6` 增加 WebSocket 事件顺序测试，并检查断线重连后的审批状态。

验收条件：所有控制事件按 requestId/runId 隔离、默认安全拒绝、重复操作幂等，测试稳定通过。

## P1：事件、工具输出和轨迹完整性

- [x] `T1` SDK 可观察到退出码时，将其标准化并写入 `tool_error/tool_result` 和 JSONL。
- [x] `T2` Bash 工具卡片在字段可用时分别展示 stdout、stderr 和 exit code。
- [x] `T3` 对长输出执行确定上限的截断；事件记录 `truncated: true` 和 `originalLength`，UI 默认折叠。
- [x] `T4` 为 JSONL 下载内容与落盘内容一致性增加自动化测试。
- [x] `T5` 为 Trace Viewer、JSONL 和 Context CSV 增加敏感值不泄漏测试。

验收条件：标准事件、落盘 JSONL、下载数据和 UI 对同一工具结果表达一致，且不暴露凭证。

## P2：Trace、Token 和上下文分析

- [x] `A1` Trace 事件摘要显示相对耗时、eventId/runId/toolUseId 等关键关联 ID。
- [x] `A2` 在 Trace Viewer 中将 `tool_start` 与对应 `tool_result/tool_error` 视觉配对。
- [x] `A3` 保存 run 开始/结束时间并计算墙钟耗时。
- [x] `A4` Token 账本 UI 增加 cache read/write；未知字段继续显示 `unavailable`。
- [x] `A5` 决定并实现分类数据策略：采用导出时确定性计算，并在主 TODO 中明确该策略。
- [x] `A6` 对不可观察的隐藏上下文明确展示 `unavailable`，不得推测其内容或 Token。
- [x] `A7` 验证分类合计与事件数、字节数和估算 Token 的逻辑一致。

验收条件：Trace 中的关联关系可直接看懂，reported/estimated/unavailable 边界明确，汇总可由事件重算。

## P2：页面状态和浏览器验收

- [x] `U1` 页面明确展示工作目录以及当前只读/可写策略。
- [ ] `U2` 在真实浏览器中完成新会话、Read、Allow、Deny、Stop、服务重启 Resume 和 Trace Viewer 流程。
- [ ] `U3` 验证 Read 卡片由 running 更新为 success/error，工具结果不会只出现在最终回答中。
- [ ] `U4` 检查 Trace 顺序、工具配对、过滤、长文本折叠、Token 账本和 Context 汇总。
- [ ] `U5` 刷新页面和重启后端后重新打开原会话，确认轨迹仍可查看且不重复。
- [ ] `U6` 检查浏览器控制台、网络请求、前后端错误提示、空状态和断线重连。
- [ ] `U7` 检查窄屏下创建会话、输入、Stop、审批和 Trace 入口仍可使用。

验收条件：记录浏览器、视口和结果到主 TODO；不要求额外截图报告，必要证据只回填主 TODO。

## P3：工程检查与依赖

- [x] `Q1` 增加可重复执行的 format/lint 配置和 npm script，并修复其报告的问题。
- [x] `Q2` 运行 `npm ci`、typecheck、全部测试、lint、production build、`git diff --check` 和密钥扫描。
- [x] `Q3` 升级到 Vite 8.2.2 并验证兼容性；完整 `npm audit` 为 0。

验收条件：所有非阻塞检查通过；无法安全修复的开发依赖风险有明确、准确的处置记录。

## 最终收口

- [x] 将每项完成证据回填 `Assignment1_Modification_TODO.md`，同步勾选对应原始条目。
- [x] 更新主 TODO 的未完成项、结果摘要、验证命令和完成定义；Commit/Push 表待用户明确要求提交后填写真实值。
- [x] 确认仓库未跟踪 `.env`、真实 trace、SDK 私有 transcript 或密钥。
- [ ] 仅提交源代码、测试和主 TODO；完成后删除本临时文件。
- [ ] 经用户明确要求后再 push，记录真实 commit SHA 和远端结果。
