/**
 * End-to-end call-path verification: REST + WebSocket + JSONL consistency.
 * Usage: node scripts/verify-call-path.mjs
 */
import WebSocket from "ws";
import { createHash } from "node:crypto";

const API = "http://127.0.0.1:3001/api";
const WS_URL = "ws://127.0.0.1:3001/ws";
const PROMPT =
  "这是调用路径验收。请只回答 CALL_PATH_OK，不要使用任何工具。";
const TIMEOUT_MS = 120_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex").toUpperCase();
}

async function waitForRunResult(chatId, events, startedAt) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const runResult = events.find((e) => e.eventType === "run_result");
    if (runResult) return runResult;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for run_result after ${TIMEOUT_MS}ms`);
}

async function main() {
  const report = {
    ok: false,
    checks: [],
    chatId: null,
    runId: null,
    sdkSessionId: null,
    model: process.env.ANTHROPIC_MODEL || "(env not exposed)",
    events: [],
    eventOrder: [],
    messages: [],
    jsonlSha256: null,
    rawDownloadSha256: null,
    tokenSummary: null,
  };

  const pass = (name, detail) => report.checks.push({ name, ok: true, detail });
  const fail = (name, detail) => {
    report.checks.push({ name, ok: false, detail });
    throw new Error(`${name}: ${detail}`);
  };

  // Health
  const workspace = await api("/workspace");
  pass("workspace API", workspace.root);

  const chat = await api("/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspacePath: "simple-chatapp", title: "call-path-verify" }),
  });
  report.chatId = chat.id;
  pass("create chat", chat.id);

  const events = [];
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), 15_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", reject);
  });
  pass("websocket connect", WS_URL);

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === "agent_event") events.push(message.event);
  });

  ws.send(JSON.stringify({ type: "subscribe", chatId: chat.id }));
  await sleep(300);
  ws.send(JSON.stringify({ type: "chat", chatId: chat.id, content: PROMPT }));

  const runResult = await waitForRunResult(chat.id, events);
  report.runId = runResult.runId;
  report.events = [...events].sort((a, b) => a.sequence - b.sequence);
  report.eventOrder = report.events.map((e) => `${e.sequence} ${e.eventType}`);

  const userMsg = report.events.find((e) => e.eventType === "user_message");
  const assistantMsg = report.events.find((e) => e.eventType === "assistant_message");
  const systemEvt = report.events.find((e) => e.eventType === "system");

  if (!userMsg) fail("user_message recorded", "missing");
  pass("user_message recorded", `seq ${userMsg.sequence}`);

  if (!assistantMsg) fail("assistant_message recorded", "missing");
  pass("assistant_message recorded", assistantMsg.content?.slice(0, 80));

  if (!runResult || runResult.status !== "success") {
    fail("run_result success", JSON.stringify(runResult));
  }
  pass("run_result success", `seq ${runResult.sequence}`);

  const chatIds = new Set(report.events.map((e) => e.chatId));
  if (chatIds.size !== 1 || !chatIds.has(chat.id)) {
    fail("chatId consistency", [...chatIds].join(", "));
  }
  pass("chatId consistency", chat.id);

  const runIds = new Set(report.events.map((e) => e.runId));
  if (runIds.size !== 1) fail("runId consistency", [...runIds].join(", "));
  pass("runId consistency", runResult.runId);

  const sequences = report.events.map((e) => e.sequence);
  for (let i = 1; i < sequences.length; i++) {
    if (sequences[i] <= sequences[i - 1]) {
      fail("sequence monotonic", sequences.join(", "));
    }
  }
  pass("sequence monotonic", sequences.join(" -> "));

  if (systemEvt?.sdkSessionId) report.sdkSessionId = systemEvt.sdkSessionId;
  else if (runResult.sdkSessionId) report.sdkSessionId = runResult.sdkSessionId;

  report.messages = await api(`/chats/${chat.id}/messages`);
  const userHistory = report.messages.filter((m) => m.role === "user").at(-1);
  const assistantHistory = report.messages.filter((m) => m.role === "assistant").at(-1);
  if (userHistory?.content !== PROMPT) {
    fail("message history user", userHistory?.content);
  }
  pass("message history user", "matches prompt");
  if (!assistantHistory?.content?.includes("CALL_PATH_OK")) {
    fail("message history assistant", assistantHistory?.content);
  }
  pass("message history assistant", assistantHistory.content.slice(0, 80));

  if (assistantMsg.content !== assistantHistory.content) {
    fail("trace vs history assistant", "mismatch");
  }
  pass("trace vs history assistant", "identical");

  const traces = await api(`/chats/${chat.id}/traces`);
  if (!traces.includes(runResult.runId)) {
    fail("trace list contains runId", traces.join(", "));
  }
  pass("trace list contains runId", runResult.runId);

  const rawDownload = await fetch(
    `${API}/traces/${chat.id}/${runResult.runId}/raw`,
  ).then((r) => r.text());
  report.rawDownloadSha256 = sha256(rawDownload);

  const diskEvents = rawDownload
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  report.jsonlSha256 = sha256(rawDownload);

  if (diskEvents.length !== report.events.length) {
    fail("jsonl event count", `ws=${report.events.length} disk=${diskEvents.length}`);
  }
  pass("jsonl event count", String(diskEvents.length));

  for (let i = 0; i < diskEvents.length; i++) {
    if (diskEvents[i].eventId !== report.events[i].eventId) {
      fail("jsonl vs ws eventId", `index ${i}`);
    }
    if (diskEvents[i].sequence !== report.events[i].sequence) {
      fail("jsonl vs ws sequence", `index ${i}`);
    }
  }
  pass("jsonl vs websocket events", "eventId and sequence match");

  const rawText = rawDownload.toLowerCase();
  if (rawText.includes("sk-") || rawText.includes(process.env.ANTHROPIC_AUTH_TOKEN || "__none__")) {
    fail("jsonl redaction", "possible secret leak");
  }
  pass("jsonl redaction", "no obvious secrets");

  const summary = await api(`/traces/${chat.id}/${runResult.runId}/summary`);
  report.tokenSummary = summary.ledger?.[0] || null;
  pass("token ledger", JSON.stringify(report.tokenSummary));

  const updatedChat = await api(`/chats/${chat.id}`);
  if (updatedChat.status !== "completed") {
    fail("chat status completed", updatedChat.status);
  }
  pass("chat status completed", updatedChat.status);

  ws.close();
  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
