import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TrajectoryStore } from "./trajectory.js";
import type { AgentEvent } from "./events.js";
import { redact } from "./redaction.js";

function event(sequence: number): AgentEvent {
  return { schemaVersion: 1, eventId: `event-${sequence}`, runId: "run", chatId: "chat", sequence, timestamp: new Date().toISOString(), eventType: "system", message: `event ${sequence}` };
}

test("writes independently parseable serialized JSONL events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-test-"));
  try {
    const store = new TrajectoryStore(directory);
    await Promise.all([store.append(event(1)), store.append(event(2)), store.append(event(3))]);
    const lines = (await readFile(path.join(directory, "chat", "run.jsonl"), "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line).sequence), [1, 2, 3]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("redacts keys, API keys, and authorization values recursively", () => {
  const safe = redact({ authorization: "Bearer secret-secret-secret", nested: { ANTHROPIC_API_KEY: "secret", text: "key sk-example-123456789012" } }) as any;
  assert.equal(safe.authorization, "[REDACTED]");
  assert.equal(safe.nested.ANTHROPIC_API_KEY, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(safe), /sk-example/);
});
