import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeMd = await readFile(path.join(root, "CLAUDE.md"), "utf8");
const baseSystem = `You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.`;
const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/u, "");
const endpoint = `${base.endsWith("/v1") ? base : `${base}/v1`}/messages`;
const variants = [
  { name: "empty_user_no_system", prompt: "" },
  { name: "no_system", prompt: "Reply with exactly OK. Do not use tools." },
  { name: "app_system", prompt: "Reply with exactly OK.", system: baseSystem },
  { name: "app_system_plus_claude_md", prompt: "Reply with exactly OK.", system: `${baseSystem}\n\n---\nProject instructions from simple-chatapp/CLAUDE.md:\n${claudeMd}` },
];
const rows = [];
for (const variant of variants) {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": process.env.ANTHROPIC_API_KEY }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL, max_tokens: 8, messages: [{ role: "user", content: variant.prompt }], ...(variant.system === undefined ? {} : { system: variant.system }) }), signal: AbortSignal.timeout(45_000) });
  const payload = await response.json(); const row = { variant: variant.name, ok: response.ok, status: response.status, configuredSystemBytes: Buffer.byteLength(variant.system || ""), usage: payload.usage, model: payload.model, stopReason: payload.stop_reason, error: response.ok ? undefined : payload.error }; rows.push(row); console.error(JSON.stringify(row)); if (!response.ok) break;
}
const byName = Object.fromEntries(rows.map((row) => [row.variant, row])); const input = (name) => byName[name]?.usage?.input_tokens;
console.log(JSON.stringify({ method: "raw Messages API", rows, deltas: { userMessageTokens: input("no_system") - input("empty_user_no_system"), appSystemTokens: input("app_system") - input("no_system"), claudeMdAndWrapperTokens: input("app_system_plus_claude_md") - input("app_system") } }, null, 2));
