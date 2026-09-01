import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace } from "./workspace.js";
import { ChatStore } from "./chat-store.js";

test("accepts a directory inside the configured workspace root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
  const previous = process.env.AGENT_WORKSPACE_ROOT;
  try {
    await mkdir(path.join(root, "project"));
    process.env.AGENT_WORKSPACE_ROOT = root;
    const resolved = await resolveWorkspace("project");
    assert.equal(resolved.relativePath, "project");
  } finally {
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT; else process.env.AGENT_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, absolute, drive, and UNC workspace paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
  const previous = process.env.AGENT_WORKSPACE_ROOT;
  try {
    process.env.AGENT_WORKSPACE_ROOT = root;
    for (const candidate of ["..", path.resolve(root), "C:\\Windows", "\\\\server\\share"]) {
      await assert.rejects(() => resolveWorkspace(candidate));
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT; else process.env.AGENT_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("persists chat metadata, messages, workspace, and SDK session mapping", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-store-test-"));
  try {
    const file = path.join(root, "chats.json");
    const first = new ChatStore(file);
    const chat = first.createChat({ cwd: root, workspacePath: "." });
    first.addMessage(chat.id, { role: "user", content: "hello" });
    first.updateChat(chat.id, { sdkSessionId: "sdk-session", status: "resumable" });
    const restored = new ChatStore(file);
    assert.equal(restored.getChat(chat.id)?.sdkSessionId, "sdk-session");
    assert.equal(restored.getMessages(chat.id)[0].content, "hello");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
