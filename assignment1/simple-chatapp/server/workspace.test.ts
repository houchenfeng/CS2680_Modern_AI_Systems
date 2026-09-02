import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace, validatePersistedWorkspace } from "./workspace.js";
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
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, absolute, drive, and UNC workspace paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
  const previous = process.env.AGENT_WORKSPACE_ROOT;
  try {
    process.env.AGENT_WORKSPACE_ROOT = root;
    for (const candidate of [
      "..",
      path.resolve(root),
      "C:\\Windows",
      "\\\\server\\share",
    ]) {
      await assert.rejects(() => resolveWorkspace(candidate));
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a symlink that escapes the configured workspace root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "workspace-outside-"));
  const previous = process.env.AGENT_WORKSPACE_ROOT;
  try {
    process.env.AGENT_WORKSPACE_ROOT = root;
    await symlink(outside, path.join(root, "escape"), "junction");
    await assert.rejects(() => resolveWorkspace("escape"), /symlink escapes/);
  } finally {
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("revalidates a persisted workspace and rejects missing or changed paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
  const previous = process.env.AGENT_WORKSPACE_ROOT;
  try {
    const project = path.join(root, "project");
    await mkdir(project);
    process.env.AGENT_WORKSPACE_ROOT = root;
    assert.equal(
      (await validatePersistedWorkspace(project, "project")).relativePath,
      "project",
    );
    await rm(project, { recursive: true });
    await assert.rejects(
      () => validatePersistedWorkspace(project, "project"),
      /no longer exists|does not exist/,
    );
    await mkdir(path.join(root, "replacement"));
    await assert.rejects(
      () => validatePersistedWorkspace(path.join(root, "replacement"), "."),
      /outside the current allowed root/,
    );
  } finally {
    if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previous;
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
    first.updateChat(chat.id, {
      sdkSessionId: "sdk-session",
      status: "resumable",
    });
    const restored = new ChatStore(file);
    assert.equal(restored.getChat(chat.id)?.sdkSessionId, "sdk-session");
    assert.equal(restored.getMessages(chat.id)[0].content, "hello");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
