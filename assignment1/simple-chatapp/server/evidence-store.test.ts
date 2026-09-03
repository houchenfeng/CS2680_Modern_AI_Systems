import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  EvidenceStore,
  hashContent,
  uiFold,
  UI_FOLD_THRESHOLD,
} from "./evidence-store.js";
import { stripUrlSecrets } from "./failure-fields.js";

test("64KB+ stdout is fully hashed while UI preview is folded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evidence-test-"));
  try {
    const store = new EvidenceStore(root);
    const stdout = "A".repeat(UI_FOLD_THRESHOLD + 1200);
    const meta = await store.store({
      chatId: "chat-1",
      runId: "run-1",
      content: { stdout, stderr: "B".repeat(100), exitCode: 1 },
      kind: "tool_error",
    });
    const raw = await store.read("chat-1", "run-1", meta.sha256);
    assert.equal(meta.sha256, createHash("sha256").update(raw).digest("hex"));
    assert.ok(raw.byteLength > UI_FOLD_THRESHOLD);
    const folded = uiFold({ stdout, stderr: "err" }, meta);
    assert.equal(folded.truncated, true);
    assert.equal(folded.evidenceSha256, meta.sha256);
    assert.ok(String(folded.preview).length <= UI_FOLD_THRESHOLD);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nested API keys, Bearer tokens, and env credentials are redacted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evidence-redact-"));
  try {
    const store = new EvidenceStore(root);
    const meta = await store.store({
      chatId: "chat-2",
      runId: "run-2",
      content: {
        authorization: "Bearer sk-secret-value-abcdef",
        nested: {
          ANTHROPIC_API_KEY: "sk-nested-secret-999999",
          text: "token=sk-inline-secret-zzzzzz and Bearer sk-bearer-yyyyyyyyyyyy",
        },
      },
      kind: "http_error",
    });
    const raw = (await store.read("chat-2", "run-2", meta.sha256)).toString(
      "utf8",
    );
    assert.doesNotMatch(raw, /sk-secret-value-abcdef/);
    assert.doesNotMatch(raw, /sk-nested-secret-999999/);
    assert.doesNotMatch(raw, /sk-inline-secret-zzzzzz/);
    assert.match(raw, /\[REDACTED\]/);
    assert.equal(meta.redactionStatus, "redacted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same hash is deduped and index remains append-only metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evidence-dedupe-"));
  try {
    const store = new EvidenceStore(root);
    const payload = { message: "same" };
    const first = await store.store({
      chatId: "c",
      runId: "r",
      content: payload,
      kind: "tool_error",
      sourceEventId: "e1",
    });
    const second = await store.store({
      chatId: "c",
      runId: "r",
      content: payload,
      kind: "run_result",
      sourceEventId: "e2",
    });
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.sha256, hashContent(payload));
    const listed = await store.list("c", "r");
    assert.ok(listed.length >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stripUrlSecrets removes credential query params", () => {
  const safe = stripUrlSecrets(
    "https://example.com/v1?api_key=secret&q=hello&token=abc",
  );
  assert.match(safe, /api_key=%5BREDACTED%5D|api_key=\[REDACTED\]/);
  assert.match(safe, /q=hello/);
});

test("tool error and terminal run error keep distinct evidence ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evidence-distinct-"));
  try {
    const store = new EvidenceStore(root);
    const tool = await store.store({
      chatId: "c",
      runId: "r",
      content: { type: "tool_error", message: "ENOENT" },
      kind: "tool_error",
      sourceEventId: "tool-1",
    });
    const terminal = await store.store({
      chatId: "c",
      runId: "r",
      content: { type: "run_result", message: "error_max_turns" },
      kind: "run_result",
      sourceEventId: "run-1",
    });
    assert.notEqual(tool.sha256, terminal.sha256);
    assert.notEqual(tool.sourceEventId, terminal.sourceEventId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage/http/timeout/abort failure chains can be stored as artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evidence-chain-"));
  try {
    const store = new EvidenceStore(root);
    const kinds = [
      "storage_error",
      "http_error",
      "sse_error",
      "timeout",
      "abort",
    ] as const;
    for (const kind of kinds) {
      const meta = await store.store({
        chatId: "c",
        runId: "r",
        kind,
        content: {
          kind,
          http: { method: "POST", status: 502, safeUrl: "https://x/v1" },
          timeoutMs: kind === "timeout" ? 1000 : null,
          exception: { name: "Error", message: kind },
        },
      });
      assert.equal(meta.kind, kind);
      await readFile(path.join(root, meta.relativePath));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
