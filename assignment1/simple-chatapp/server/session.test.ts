import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatStore } from "./chat-store.js";
import { Session } from "./session.js";
import { TrajectoryStore } from "./trajectory.js";
import { validatePersistedWorkspace } from "./workspace.js";

class FakeAgent {
  interruptCalls = 0;
  sent: string[] = [];
  private values: unknown[] = [];
  private waiter?: () => void;
  sendMessage(content: string) {
    this.sent.push(content);
  }
  push(value: unknown) {
    this.values.push(value);
    this.waiter?.();
    this.waiter = undefined;
  }
  async *getOutputStream() {
    while (true) {
      if (this.values.length) yield this.values.shift();
      else
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
    }
  }
  async interrupt() {
    this.interruptCalls += 1;
  }
  close() {}
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "session-test-"));
  const store = new ChatStore(path.join(directory, "chats.json"));
  const chat = store.createChat({ cwd: directory, workspacePath: "." });
  const agent = new FakeAgent();
  const session = new Session(chat, {
    agent,
    store,
    trajectories: new TrajectoryStore(path.join(directory, "traces")),
  });
  return { directory, store, chat, agent, session };
}

function client() {
  const messages: any[] = [];
  return {
    messages,
    readyState: 1,
    OPEN: 1,
    send(value: string) {
      messages.push(JSON.parse(value));
    },
  } as any;
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition was not reached");
}

test("Stop interrupts once, is idempotent, and a stopped session accepts a later message", async () => {
  const value = await fixture();
  const ws = client();
  value.session.subscribe(ws);
  try {
    await value.session.sendMessage("first");
    const [first, second] = await Promise.all([
      value.session.stop(),
      value.session.stop(),
    ]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(value.agent.interruptCalls, 1);
    const liveEvents = ws.messages
      .filter((item: any) => item.event)
      .map((item: any) => item.event);
    assert.deepEqual(
      liveEvents.map((item: any) => item.eventType),
      ["user_message", "run_result"],
    );
    assert.deepEqual(
      liveEvents.map((item: any) => item.sequence),
      [1, 2],
    );
    assert.equal(await value.session.stop(), true);
    await value.session.sendMessage("second");
    assert.deepEqual(value.agent.sent, ["first", "second"]);
    assert.equal(value.store.getChat(value.chat.id)?.status, "running");
  } finally {
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("Stop after a completed run is a no-op", async () => {
  const value = await fixture();
  try {
    await value.session.sendMessage("complete");
    value.agent.push({ type: "result", subtype: "success", is_error: false });
    await waitFor(
      () => value.store.getChat(value.chat.id)?.status === "completed",
    );
    assert.equal(await value.session.stop(), false);
    assert.equal(value.agent.interruptCalls, 0);
  } finally {
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("permission Allow and Deny are isolated by requestId and duplicate decisions are harmless", async () => {
  const value = await fixture();
  const ws = client();
  value.session.subscribe(ws);
  try {
    await value.session.sendMessage("exercise concurrent permissions");
    const signal = new AbortController().signal;
    const first = (value.session as any).canUseTool(
      "Write",
      { file: "a" },
      { signal, toolUseID: "tool-a" },
    );
    const second = (value.session as any).canUseTool(
      "Bash",
      { command: "echo" },
      { signal, toolUseID: "tool-b" },
    );
    await waitFor(
      () =>
        ws.messages.filter(
          (item: any) => item.event?.eventType === "permission_request",
        ).length === 2,
    );
    const requests = ws.messages
      .filter((item: any) => item.event?.eventType === "permission_request")
      .map((item: any) => item.event);
    const write = requests.find((item: any) => item.toolUseId === "tool-a");
    const bash = requests.find((item: any) => item.toolUseId === "tool-b");
    const reconnected = client();
    value.session.subscribe(reconnected);
    assert.equal(
      reconnected.messages.filter((item: any) => item.event?.replayed).length,
      2,
    );
    assert.equal(
      await value.session.resolvePermission(bash.requestId, "deny"),
      true,
    );
    assert.equal(
      await value.session.resolvePermission(write.requestId, "allow"),
      true,
    );
    assert.equal((await first).behavior, "allow");
    assert.equal((await second).behavior, "deny");
    assert.equal(
      await value.session.resolvePermission(write.requestId, "deny"),
      false,
    );
  } finally {
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("permission timeout and last-client disconnect default to denial", async () => {
  const previous = process.env.PERMISSION_TIMEOUT_MS;
  process.env.PERMISSION_TIMEOUT_MS = "10";
  const value = await fixture();
  const ws = client();
  value.session.subscribe(ws);
  try {
    await value.session.sendMessage("exercise permission cleanup");
    const timed = await (value.session as any).canUseTool(
      "Write",
      {},
      { signal: new AbortController().signal, toolUseID: "timeout" },
    );
    assert.equal(timed.behavior, "deny");
    const disconnected = (value.session as any).canUseTool(
      "Bash",
      {},
      { signal: new AbortController().signal, toolUseID: "disconnect" },
    );
    await waitFor(() =>
      ws.messages.some((item: any) => item.event?.toolUseId === "disconnect"),
    );
    value.session.unsubscribe(ws);
    assert.equal((await disconnected).behavior, "deny");
  } finally {
    if (previous === undefined) delete process.env.PERMISSION_TIMEOUT_MS;
    else process.env.PERMISSION_TIMEOUT_MS = previous;
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("a completed run safely denies every still-pending permission", async () => {
  const value = await fixture();
  const ws = client();
  value.session.subscribe(ws);
  try {
    await value.session.sendMessage("finish while approvals are pending");
    const signal = new AbortController().signal;
    const first = (value.session as any).canUseTool(
      "Write",
      {},
      { signal, toolUseID: "pending-a" },
    );
    const second = (value.session as any).canUseTool(
      "Bash",
      {},
      { signal, toolUseID: "pending-b" },
    );
    await waitFor(
      () =>
        ws.messages.filter(
          (item: any) => item.event?.eventType === "permission_request",
        ).length === 2,
    );
    value.agent.push({ type: "result", subtype: "success", is_error: false });
    assert.equal((await first).behavior, "deny");
    assert.equal((await second).behavior, "deny");
    await waitFor(
      () => value.store.getChat(value.chat.id)?.status === "completed",
    );
    const permissionResults = ws.messages.filter(
      (item: any) => item.event?.eventType === "permission_result",
    );
    assert.equal(permissionResults.length, 2);
    assert.ok(
      permissionResults.every(
        (item: any) => item.event.reason === "Run already finished",
      ),
    );
  } finally {
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("permission callbacks arriving after a run result are denied", async () => {
  const value = await fixture();
  try {
    await value.session.sendMessage("finish before a late tool callback");
    value.agent.push({ type: "result", subtype: "success", is_error: false });
    await waitFor(
      () => value.store.getChat(value.chat.id)?.status === "completed",
    );

    const result = await (value.session as any).canUseTool(
      "Bash",
      { command: "echo late" },
      { signal: new AbortController().signal, toolUseID: "late-tool" },
    );
    assert.equal(result.behavior, "deny");
    assert.equal(result.message, "Run already finished");
  } finally {
    value.session.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

test("a restarted store resumes the exact persisted SDK session after workspace revalidation", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "session-resume-test-"),
  );
  const previousRoot = process.env.AGENT_WORKSPACE_ROOT;
  try {
    process.env.AGENT_WORKSPACE_ROOT = directory;
    const file = path.join(directory, "chats.json");
    const firstStore = new ChatStore(file);
    const created = firstStore.createChat({
      cwd: directory,
      workspacePath: ".",
    });
    firstStore.updateChat(created.id, {
      sdkSessionId: "sdk-persisted",
      status: "resumable",
    });
    const restartedStore = new ChatStore(file);
    const restored = restartedStore.getChat(created.id)!;
    await validatePersistedWorkspace(restored.cwd!, restored.workspacePath);
    let resume: string | undefined;
    const fake = new FakeAgent();
    const session = new Session(restored, {
      store: restartedStore,
      trajectories: new TrajectoryStore(path.join(directory, "traces")),
      agentFactory(options) {
        resume = options.resume;
        return fake;
      },
    });
    assert.equal(resume, "sdk-persisted");
    session.close();
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  }
});
