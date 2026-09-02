import "dotenv/config";
const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/u, "");
const endpoint = `${base.endsWith("/v1") ? base : `${base}/v1`}/messages/count_tokens`;
const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": process.env.ANTHROPIC_API_KEY }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL, system: "You are concise.", messages: [{ role: "user", content: "Reply OK." }] }), signal: AbortSignal.timeout(20_000) });
const payload = await response.json().catch(() => ({}));
console.log(JSON.stringify({ supported: response.ok, status: response.status, inputTokens: payload.input_tokens, errorType: payload.error?.type, errorMessage: payload.error?.message }, null, 2));
if (!response.ok) process.exitCode = 1;
