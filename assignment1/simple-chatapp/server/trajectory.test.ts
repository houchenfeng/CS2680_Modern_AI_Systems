import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TrajectoryStore } from "./trajectory.js";
import type { AgentEvent } from "./events.js";
import { redact } from "./redaction.js";

function event(sequence: number): AgentEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    runId: "run",
    chatId: "chat",
    sequence,
    timestamp: new Date().toISOString(),
    eventType: "system",
    message: `event ${sequence}`,
  };
}

test("writes independently parseable serialized JSONL events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-test-"));
  try {
    const store = new TrajectoryStore(directory);
    await Promise.all([
      store.append(event(1)),
      store.append(event(2)),
      store.append(event(3)),
    ]);
    const lines = (
      await readFile(path.join(directory, "chat", "run.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).sequence),
      [1, 2, 3],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("redacts keys, API keys, and authorization values recursively", () => {
  const fakeKey = ["sk", "example", "123456789012"].join("-");
  const safe = redact({
    authorization: "Bearer secret-secret-secret",
    nested: { ANTHROPIC_API_KEY: "secret", text: `key ${fakeKey}` },
  }) as any;
  assert.equal(safe.authorization, "[REDACTED]");
  assert.equal(safe.nested.ANTHROPIC_API_KEY, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(safe), /sk-example/);
});

test("lists runs in chronological order by file modification time", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-list-test-"));
  try {
    const store = new TrajectoryStore(directory);
    const chatDir = path.join(directory, "chat");
    await mkdir(chatDir, { recursive: true });
    const first = path.join(chatDir, "run-first.jsonl");
    const second = path.join(chatDir, "run-second.jsonl");
    await writeFile(first, '{"eventType":"run_result"}\n', "utf8");
    await writeFile(second, '{"eventType":"run_result"}\n', "utf8");
    const older = Date.now() - 60_000;
    const newer = Date.now();
    await utimes(first, older / 1000, older / 1000);
    await utimes(second, newer / 1000, newer / 1000);

    assert.deepEqual(await store.list("chat"), ["run-first", "run-second"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloaded JSONL is byte-for-byte identical to persisted JSONL and remains redacted", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "trajectory-download-test-"),
  );
  try {
    const store = new TrajectoryStore(directory);
    const unsafe = {
      ...event(1),
      output: { authorization: "Bearer secret-secret-secret" },
    };
    await store.append(unsafe);
    const persisted = await readFile(
      path.join(directory, "chat", "run.jsonl"),
      "utf8",
    );
    const downloaded = await store.read("chat", "run");
    assert.equal(downloaded, persisted);
    assert.doesNotMatch(downloaded, /secret-secret-secret/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
