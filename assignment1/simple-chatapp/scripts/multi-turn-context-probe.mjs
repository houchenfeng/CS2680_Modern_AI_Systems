import "dotenv/config";
import { readFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeMd = await readFile(path.join(root, "CLAUDE.md"), "utf8");
const systemPrompt = `You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.

---
Project instructions from simple-chatapp/CLAUDE.md:
${claudeMd}`;
class Queue { values = []; waiter = null; push(content) { const value = { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" }; if (this.waiter) { this.waiter(value); this.waiter = null; } else this.values.push(value); } async *[Symbol.asyncIterator]() { while (true) { if (this.values.length) yield this.values.shift(); else yield await new Promise((resolve) => { this.waiter = resolve; }); } } }
const queue = new Queue();
const prompts = ["Use the Read tool to read test.txt, then answer with its first line only.", "Without reading the file again, state the filename you read. Answer with the filename only."];
queue.push(prompts[0]);
const report = { prompts, init: null, assistantCalls: [], toolResults: [], runResults: [] }; let completedRuns = 0;
for await (const message of query({ prompt: queue, options: { cwd: root, env: { ...process.env }, model: process.env.ANTHROPIC_MODEL || "opus", systemPrompt, tools: ["Read"], allowedTools: ["Read"], settingSources: [], maxTurns: 10, persistSession: false } })) {
  if (message.type === "system" && message.subtype === "init") report.init = { model: message.model, tools: message.tools, skills: message.skills, mcpServers: message.mcp_servers };
  else if (message.type === "assistant") report.assistantCalls.push({ messageId: message.message?.id, usage: message.message?.usage, blocks: (message.message?.content || []).map((block) => ({ type: block.type, toolName: block.type === "tool_use" ? block.name : undefined, toolUseId: block.type === "tool_use" ? block.id : undefined, textChars: block.type === "text" ? block.text.length : undefined, thinkingChars: block.type === "thinking" ? String(block.thinking || "").length : undefined, inputChars: block.type === "tool_use" ? JSON.stringify(block.input).length : undefined })) });
  else if (message.type === "user") for (const block of message.message?.content || []) if (block.type === "tool_result") report.toolResults.push({ toolUseId: block.tool_use_id, isError: Boolean(block.is_error), serializedChars: JSON.stringify(block.content).length });
  else if (message.type === "result") { report.runResults.push({ subtype: message.subtype, usage: message.usage, modelUsage: message.modelUsage, numTurns: message.num_turns, durationApiMs: message.duration_api_ms, costUsd: message.total_cost_usd }); completedRuns += 1; if (completedRuns === 1) queue.push(prompts[1]); else break; }
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
