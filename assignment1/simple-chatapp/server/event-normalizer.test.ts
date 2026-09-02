import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { normalizeSdkMessage } from "./event-normalizer.js";
import type { AgentEvent } from "./events.js";

function builder() {
  let sequence = 0;
  return (payload: any): AgentEvent => ({
    schemaVersion: 1,
    eventId: randomUUID(),
    runId: "run-test",
    chatId: "chat-test",
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

test("pairs tool start and result with the same toolUseId", () => {
  const build = builder();
  const [start] = normalizeSdkMessage(
    {
      type: "assistant",
      session_id: "sdk",
      message: {
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
