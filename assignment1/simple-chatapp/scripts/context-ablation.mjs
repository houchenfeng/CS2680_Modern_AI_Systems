import "dotenv/config";
import { readFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeMd = await readFile(path.join(root, "CLAUDE.md"), "utf8");
const baseSystem = `You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.`;
const tools = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"];
const prompt = "Reply with exactly OK. Do not use tools.";
const variants = [
  { name: "minimal", systemPrompt: "Reply concisely.", tools: [] },
  { name: "app_system", systemPrompt: baseSystem, tools: [] },
  { name: "app_system_plus_claude_md", systemPrompt: `${baseSystem}\n\n---\nProject instructions from simple-chatapp/CLAUDE.md:\n${claudeMd}`, tools: [] },
  { name: "full_app_configuration", systemPrompt: `${baseSystem}\n\n---\nProject instructions from simple-chatapp/CLAUDE.md:\n${claudeMd}`, tools },
];
const selected = process.argv[2] ? variants.filter((row) => row.name === process.argv[2]) : variants;
if (!selected.length) throw new Error(`Unknown variant: ${process.argv[2]}`);
const totalInput = (u = {}) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
const report = [];
for (const variant of selected) {
  const row = { variant: variant.name, configuredSystemBytes: Buffer.byteLength(variant.systemPrompt), configuredTools: variant.tools, init: null, result: null, assistantText: "" };
  try {
    for await (const message of query({ prompt, options: { cwd: root, env: { ...process.env }, model: process.env.ANTHROPIC_MODEL || "opus", systemPrompt: variant.systemPrompt, tools: variant.tools, settingSources: [], maxTurns: 1, persistSession: false } })) {
      if (message.type === "system" && message.subtype === "init") row.init = { model: message.model, claudeCodeVersion: message.claude_code_version, tools: message.tools, skills: message.skills, mcpServers: message.mcp_servers, plugins: message.plugins, outputStyle: message.output_style };
      else if (message.type === "assistant") row.assistantText += (message.message?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      else if (message.type === "result") { row.result = { subtype: message.subtype, usage: message.usage, totalInputTokens: totalInput(message.usage), modelUsage: message.modelUsage, numTurns: message.num_turns, durationApiMs: message.duration_api_ms, costUsd: message.total_cost_usd, errors: message.errors }; break; }
    }
  } catch (error) { row.error = error instanceof Error ? error.message : String(error); }
  report.push(row); console.error(JSON.stringify(row));
}
console.log(JSON.stringify({ prompt, modelRequested: process.env.ANTHROPIC_MODEL || "opus", runs: report }, null, 2));
process.exit(0);
