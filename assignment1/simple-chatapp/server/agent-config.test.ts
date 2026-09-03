import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_TOOLS,
  SETTING_SOURCES,
  SYSTEM_PROMPT,
  buildObservableRequestSnapshot,
  composeSystemPrompt,
  loadProjectInstructions,
  resolveModel,
} from "./agent-config.js";
import { ChatStore } from "./chat-store.js";
import { Session } from "./session.js";
import { TrajectoryStore } from "./trajectory.js";
import { redact } from "./redaction.js";

test("SDK config and snapshot share the same prompt, tools, and model variables", () => {
  const projectInstructions = {
    text: "unavailable" as const,
    source: "unavailable" as const,
    status: "unavailable" as const,
  };
  const snapshot = buildObservableRequestSnapshot({
    cwd: "/tmp/demo",
    projectInstructions,
    systemPrompt: composeSystemPrompt(projectInstructions),
    model: resolveModel(),
    tools: AGENT_TOOLS,
  });
  assert.equal(snapshot.systemPrompt, SYSTEM_PROMPT);
  assert.deepEqual(snapshot.tools, [...AGENT_TOOLS]);
  assert.equal(snapshot.model, resolveModel());
  assert.deepEqual(snapshot.settingSources, SETTING_SOURCES);
  assert.deepEqual(SETTING_SOURCES, []);
});

test("loads CLAUDE.md when present and marks unavailable when missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-instructions-"));
  try {
    const missing = await loadProjectInstructions(root);
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.text, "unavailable");

    await writeFile(
      path.join(root, "CLAUDE.md"),
      "# Project\nUse relative paths.",
      "utf8",
    );
    const loaded = await loadProjectInstructions(root);
    assert.equal(loaded.status, "loaded");
    assert.match(String(loaded.text), /Use relative paths/);
    assert.match(String(loaded.source), /CLAUDE\.md$/);

    const composed = composeSystemPrompt(loaded);
    assert.match(composed, new RegExp(SYSTEM_PROMPT.slice(0, 40)));
    assert.match(composed, /Project instructions from/);
    assert.match(composed, /Use relative paths/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects CLAUDE.md that escapes the working directory via symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "project-outside-"));
  try {
    const secret = path.join(outside, "secret.md");
    await writeFile(secret, "ANTHROPIC_API_KEY=sk-example-secretvalue", "utf8");
    try {
      await symlink(secret, path.join(root, "CLAUDE.md"));
    } catch {
      // Windows may require elevated privileges for symlinks.
      return;
    }
    const loaded = await loadProjectInstructions(root);
    assert.equal(loaded.status, "error");
    assert.equal(loaded.text, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("request snapshot is redacted before persistence and emitted once before user_message", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snapshot-session-"));
  try {
    await writeFile(
      path.join(directory, "CLAUDE.md"),
      "token sk-example-123456789012 and Bearer secret-secret-secret",
      "utf8",
    );
    const store = new ChatStore(path.join(directory, "chats.json"));
    const trajectories = new TrajectoryStore(path.join(directory, "traces"));
    const chat = store.createChat({ cwd: directory, workspacePath: "." });
    const projectInstructions = await loadProjectInstructions(directory);
    const snapshotConfig = buildObservableRequestSnapshot({
      cwd: directory,
      projectInstructions,
    });
    const agent = {
      sent: [] as string[],
      getObservableRequest: () => snapshotConfig,
      sendMessage(content: string) {
        this.sent.push(content);
      },
      async *getOutputStream() {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
        await new Promise(() => undefined);
      },
      async interrupt() {},
      close() {},
    };
    const session = await Session.create(chat, {
      agent,
      store,
      trajectories,
      projectInstructions,
    });
    const messages: any[] = [];
    session.subscribe({
      readyState: 1,
      OPEN: 1,
      send(value: string) {
        messages.push(JSON.parse(value));
      },
    } as any);

    await session.sendMessage("hello");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const events = messages
      .filter((item) => item.type === "agent_event")
      .map((item) => item.event);
    const snapshot = events.find(
      (event: any) => event.eventType === "request_snapshot",
    );
    const user = events.find(
      (event: any) => event.eventType === "user_message",
    );
    const frozen = events.find(
      (event: any) =>
        event.eventType === "system" &&
        String(event.message || "").includes("Task specification frozen"),
    );
    assert.ok(snapshot);
    assert.ok(user);
    assert.ok(frozen);
    assert.ok(frozen.sequence < snapshot.sequence);
    assert.ok(snapshot.sequence < user.sequence);
    assert.equal(snapshot.runId, user.runId);
    assert.equal(snapshot.chatId, chat.id);
    assert.deepEqual(snapshot.settingSources, []);
    assert.deepEqual(snapshot.tools, [...AGENT_TOOLS]);
    assert.doesNotMatch(JSON.stringify(snapshot), /sk-example|secret-secret/);
    assert.match(String(snapshot.projectInstructions), /\[REDACTED\]/);

    const persisted = await trajectories.events(chat.id, snapshot.runId);
    assert.equal(
      persisted.filter((item) => item.eventType === "request_snapshot").length,
      1,
    );
    assert.ok(
      persisted.findIndex((item) => item.eventType === "request_snapshot") <
        persisted.findIndex((item) => item.eventType === "user_message"),
    );
    assert.doesNotMatch(
      JSON.stringify(redact(snapshot)),
      /sk-example|secret-secret/,
    );

    session.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("empty settingSources and explicit project instructions are part of the shared snapshot contract", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-session-cfg-"));
  try {
    await writeFile(path.join(directory, "CLAUDE.md"), "rule A", "utf8");
    const projectInstructions = await loadProjectInstructions(directory);
    const snapshot = buildObservableRequestSnapshot({
      cwd: directory,
      projectInstructions,
      systemPrompt: composeSystemPrompt(projectInstructions),
    });
    assert.deepEqual(snapshot.settingSources, []);
    assert.deepEqual(SETTING_SOURCES, []);
    assert.equal(
      snapshot.systemPrompt,
      composeSystemPrompt(projectInstructions),
    );
    assert.deepEqual(snapshot.tools, [...AGENT_TOOLS]);
    assert.equal(snapshot.model, resolveModel());
    assert.match(snapshot.systemPrompt, /rule A/);
    assert.match(snapshot.observabilityNote, /does not include hidden/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
