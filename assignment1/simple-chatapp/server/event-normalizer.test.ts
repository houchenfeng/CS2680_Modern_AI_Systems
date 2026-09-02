import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  normalizeSdkMessage,
  resetNormalizerState,
} from "./event-normalizer.js";
import {
  callUsageFromProvider,
  logicalInputTokens,
  migrateEvent,
  type AgentEvent,
} from "./events.js";
import { redact } from "./redaction.js";

function builder(schemaVersion: 1 | 2 = 2) {
  let sequence = 0;
  return (payload: any): AgentEvent => ({
    schemaVersion,
    eventId: randomUUID(),
    runId: "run-test",
    chatId: "chat-test",
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

test.beforeEach(() => {
  resetNormalizerState();
});

test("pairs tool start and result with the same toolUseId", () => {
  const build = builder();
  const [start] = normalizeSdkMessage(
    {
      type: "assistant",
      session_id: "sdk",
      message: {
        id: "msg-tool",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "package.json" },
          },
        ],
      },
    },
    build,
  );
  const [result] = normalizeSdkMessage(
    {
      type: "user",
      session_id: "sdk",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "{}" },
        ],
      },
    },
    build,
  );
  assert.equal(start.eventType, "tool_start");
  assert.equal(result.eventType, "tool_result");
  assert.equal(start.toolUseId, result.toolUseId);
  assert.ok(result.sequence > start.sequence);
});

test("normalizes failed tool results", () => {
  const [event] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-2",
            content: "missing",
            is_error: true,
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(event.eventType, "tool_error");
  assert.equal(event.error?.source, "tool");
});

test("marks missing result usage unavailable", () => {
  const [event] = normalizeSdkMessage(
    { type: "result", subtype: "success", is_error: false, duration_ms: 4 },
    builder(),
  );
  assert.equal(event.usage?.measurement, "unavailable");
  assert.equal(event.runUsage?.measurement, "unavailable");
});

test("normalizes observable command fields and deterministically truncates long output", () => {
  const [command] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "bash-1",
            content: { stdout: "ok", stderr: "warning", exit_code: 7 },
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(command.exitCode, 7);
  assert.equal(command.stdout, "ok");
  assert.equal(command.stderr, "warning");

  const [plain] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "bash-2",
            content: "ALLOW_MARKER",
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(plain.exitCode, 0);
  assert.equal(plain.stdout, "ALLOW_MARKER");

  const [interrupted] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "bash-3",
            is_error: true,
            content:
              "Exit code 137\n[Request interrupted by user for tool use]",
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(interrupted.exitCode, 137);
  assert.equal(
    interrupted.stderr,
    "[Request interrupted by user for tool use]",
  );

  const [denied] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "bash-4",
            is_error: true,
            content: "Denied by user",
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(denied.exitCode, undefined);
  assert.equal(denied.stdout, "Denied by user");

  const [large] = normalizeSdkMessage(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "read-1",
            content: "x".repeat(70_000),
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(large.truncated, true);
  assert.equal(large.originalLength, 70_000);
  assert.equal(String(large.output).length, 64_000);
});

test("same message ID with three fragments forms one call usage", () => {
  const build = builder();
  const usage = {
    input_tokens: 1267,
    output_tokens: 40,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 20,
  };
  const events = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-abc",
        usage,
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "text", text: "hello" },
          {
            type: "tool_use",
            id: "tool-x",
            name: "Read",
            input: { file_path: "a.txt" },
          },
        ],
      },
    },
    build,
  );
  assert.equal(events.length, 3);
  assert.equal(events[0].eventType, "assistant_thinking");
  assert.equal(events[1].eventType, "assistant_message");
  assert.equal(events[2].eventType, "tool_start");
  assert.ok(events.every((event) => event.callId === events[0].callId));
  assert.ok(events.every((event) => event.messageId === "msg-abc"));
  const withUsage = events.filter((event) => event.callUsage);
  assert.equal(withUsage.length, 1);
  assert.equal(withUsage[0].callUsage?.uncachedInputTokens, 1267);
  assert.equal(withUsage[0].callUsage?.logicalInputTokens, 1387);
  assert.equal(events[0].thinkingChars, 4);
});

test("duplicate input_tokens=1267/output_tokens=0 is not double-summed", () => {
  const build = builder();
  const usage = { input_tokens: 1267, output_tokens: 0 };
  const first = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-dup",
        usage,
        content: [{ type: "text", text: "a" }],
      },
    },
    build,
  );
  const second = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-dup",
        usage,
        content: [{ type: "text", text: "b" }],
      },
    },
    build,
  );
  assert.equal(first[0].callUsage?.uncachedInputTokens, 1267);
  assert.equal(second[0].callUsage, undefined);
  assert.equal(first[0].callId, second[0].callId);
});

test("different message IDs with identical usage remain separate suspicious calls", () => {
  const build = builder();
  const usage = { input_tokens: 1267, output_tokens: 0 };
  const a = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-1",
        usage,
        content: [{ type: "text", text: "one" }],
      },
    },
    build,
  );
  const b = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-2",
        usage,
        content: [{ type: "text", text: "two" }],
      },
    },
    build,
  );
  assert.notEqual(a[0].callId, b[0].callId);
  assert.equal(a[0].callUsage?.uncachedInputTokens, 1267);
  assert.equal(b[0].callUsage?.uncachedInputTokens, 1267);
  assert.equal(a[0].messageId, "msg-1");
  assert.equal(b[0].messageId, "msg-2");
});

test("schema v1 trace events migrate on read without rewriting source", () => {
  const legacy = {
    schemaVersion: 1,
    eventId: "e1",
    runId: "run-1",
    chatId: "chat-1",
    sequence: 1,
    timestamp: "2026-09-01T00:00:00.000Z",
    eventType: "run_result",
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      totalTokens: 18,
      measurement: "reported",
    },
    costUsd: 0.01,
  };
  const migrated = migrateEvent(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.runUsage?.logicalInputTokens, 16);
  assert.equal(migrated.providerReportedCostUsd, 0.01);
  assert.equal((legacy as { schemaVersion: number }).schemaVersion, 1);
});

test("unknown SDK blocks are preserved and redacted for download", () => {
  const [event] = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-unk",
        content: [
          {
            type: "mystery_block",
            authorization: "Bearer sk-secret-value-123456",
            payload: "visible",
          },
        ],
      },
    },
    builder(),
  );
  assert.equal(event.eventType, "unknown_sdk_block");
  assert.equal(event.blockType, "mystery_block");
  const redacted = redact(event) as AgentEvent;
  assert.equal(
    (redacted.rawBlock as { authorization?: string }).authorization,
    "[REDACTED]",
  );
  assert.ok(!JSON.stringify(redacted).includes("sk-secret-value-123456"));
});

test("logicalInputTokens stays null when any cache field is missing", () => {
  const usage = callUsageFromProvider({
    input_tokens: 10,
    output_tokens: 1,
    cache_read_input_tokens: 5,
  });
  assert.equal(usage.cacheWriteTokens, null);
  assert.equal(usage.logicalInputTokens, null);
  assert.equal(logicalInputTokens(10, 5, null), null);
  assert.equal(logicalInputTokens(10, 5, 2), 17);
});

test("compact_boundary and conflicting usage are recorded", () => {
  const [compact] = normalizeSdkMessage(
    {
      type: "system",
      subtype: "compact_boundary",
      message: "compacted",
      session_id: "sdk",
    },
    builder(),
  );
  assert.equal(compact.eventType, "compact_boundary");

  const build = builder();
  normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-conflict",
        usage: { input_tokens: 10, output_tokens: 1 },
        content: [{ type: "text", text: "a" }],
      },
    },
    build,
  );
  const [conflicted] = normalizeSdkMessage(
    {
      type: "assistant",
      message: {
        id: "msg-conflict",
        usage: { input_tokens: 99, output_tokens: 2 },
        content: [{ type: "text", text: "b" }],
      },
    },
    build,
  );
  assert.equal(conflicted.usageConflict, true);
  assert.equal(conflicted.callUsage?.usageConflict, true);
  assert.ok((conflicted.callUsage?.usageCandidates?.length || 0) >= 2);
});
