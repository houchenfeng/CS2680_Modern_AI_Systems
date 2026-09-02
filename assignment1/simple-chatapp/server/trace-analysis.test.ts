import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "./events.js";
import {
  classifyEvent,
  contextCsv,
  contextSummary,
  filterAndSortEvents,
  tokenLedger,
} from "./trace-analysis.js";

function event(sequence: number, changes: Partial<AgentEvent>): AgentEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    runId: "run",
    chatId: "chat",
    sequence,
    timestamp: "2026-09-01T00:00:00.000Z",
    eventType: "system",
    ...changes,
  };
}

test("filters trace events and sorts by sequence", () => {
  const events = [
    event(3, { eventType: "tool_error", toolName: "Read" }),
    event(1, { eventType: "tool_start", toolName: "Read" }),
    event(2, { eventType: "assistant_message" }),
  ];
  assert.deepEqual(
    filterAndSortEvents(events, { toolName: "Read" }).map(
      (item) => item.sequence,
    ),
    [1, 3],
  );
  assert.deepEqual(
    filterAndSortEvents(events, { errorsOnly: true }).map(
      (item) => item.sequence,
    ),
    [3],
  );
});

test("does not double count duplicate result event IDs and preserves measurement", () => {
  const result = event(1, {
    eventType: "run_result",
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      measurement: "reported",
    },
  });
  const ledger = tokenLedger([result, result]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].totalTokens, 5);
  assert.equal(ledger[0].measurement, "reported");
});

test("classifies Read, Bash, Edit, and errors deterministically", () => {
  assert.equal(
    classifyEvent(
      event(1, { eventType: "tool_result", toolName: "Read", output: "file" }),
    ).contextCategory,
    "file_content",
  );
  assert.equal(
    classifyEvent(
      event(2, {
        eventType: "tool_result",
        toolName: "Bash",
        output: "stdout",
      }),
    ).contextCategory,
    "command_output",
  );
  assert.equal(
    classifyEvent(
      event(3, { eventType: "tool_result", toolName: "Edit", output: "done" }),
    ).contextCategory,
    "edit_result",
  );
  assert.equal(
    classifyEvent(
      event(4, {
        eventType: "tool_error",
        toolName: "Read",
        error: { message: "missing", source: "tool" },
      }),
    ).utility,
    "harmful",
  );
});

test("CSV escapes commas, quotes, Chinese, and multiline source values", () => {
  const csv = contextCsv([
    event(1, {
      eventType: "tool_result",
      toolName: 'Read,"中文"\nnext',
      output: "内容",
    }),
  ]);
  assert.match(csv, /"Read,""中文""\nnext"/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("context category totals exactly match event count, bytes, and estimated tokens", () => {
  const events = [
    event(1, { eventType: "user_message", content: "hello" }),
    event(2, { eventType: "tool_result", toolName: "Read", output: "内容" }),
    event(3, {
      eventType: "tool_error",
      error: { message: "missing", source: "tool" },
    }),
  ];
  const rows = events.map(classifyEvent);
  const summary = contextSummary(events);
  assert.equal(
    Object.values(summary).reduce((sum, item) => sum + item.events, 0),
    events.length,
  );
  assert.equal(
    Object.values(summary).reduce((sum, item) => sum + item.bytes, 0),
    rows.reduce((sum, item) => sum + item.bytes, 0),
  );
  assert.equal(
    Object.values(summary).reduce((sum, item) => sum + item.estimatedTokens, 0),
    rows.reduce((sum, item) => sum + item.estimatedTokens, 0),
  );
});
