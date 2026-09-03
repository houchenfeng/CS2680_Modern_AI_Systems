import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvidenceStore, hashContent } from "./evidence-store.js";
import {
  createReplayBundle,
  groundTruthGlob,
  groundTruthGrep,
  groundTruthRead,
  replayTool,
} from "./tool-replay.js";

async function tempWorkspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "replay-ws-"));
  await writeFile(path.join(dir, "hello.txt"), "hello world\nline2\n", "utf8");
  await mkdir(path.join(dir, "sub"), { recursive: true });
  await writeFile(path.join(dir, "sub", "note.md"), "# note\nfindme\n", "utf8");
  return dir;
}

test("Read replay matches ground truth and stores new evidence", async () => {
  const ws = await tempWorkspace();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "replay-ev-"));
  try {
    const store = new EvidenceStore(evidenceRoot);
    const gt = await groundTruthRead(ws, { file_path: "hello.txt" });
    const original = { content: gt.content, contentHash: gt.contentHash };
    const bundle = await createReplayBundle({
      toolName: "Read",
      toolInput: { file_path: "hello.txt" },
      cwd: ws,
      originalResult: original,
      chatId: "c1",
      runId: "r1",
      toolUseId: "tu-read-1",
    });
    const result = await replayTool(bundle, {
      evidenceStore: store,
      originalResult: original,
      attemptDir: ws,
      tempRoot: await mkdtemp(path.join(os.tmpdir(), "replay-tmp-")),
    });
    assert.equal(result.status, "match");
    assert.equal(result.classificationHint, "pass");
    assert.ok(result.evidenceSha256);
    assert.equal(result.groundTruth?.contentHash, gt.contentHash);
    const listed = await store.list("c1", "r1");
    assert.ok(listed.some((m) => m.kind === "tool_replay"));
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("Write mutates only isolated copy, not user worktree", async () => {
  const ws = await tempWorkspace();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "replay-ev-w-"));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "replay-iso-"));
  try {
    const store = new EvidenceStore(evidenceRoot);
    const before = await readFile(path.join(ws, "hello.txt"), "utf8");
    const original = { ok: true, contentHash: "wrong-hash-on-purpose" };
    const bundle = await createReplayBundle({
      toolName: "Write",
      toolInput: { file_path: "hello.txt", content: "mutated-by-replay" },
      cwd: ws,
      originalResult: original,
      chatId: "c2",
      runId: "r2",
    });
    const result = await replayTool(bundle, {
      evidenceStore: store,
      originalResult: original,
      attemptDir: ws,
      tempRoot,
    });
    const after = await readFile(path.join(ws, "hello.txt"), "utf8");
    assert.equal(after, before, "user worktree must be unchanged");
    assert.equal(result.status, "mismatch");
    assert.equal(result.classificationHint, "tool_failure");
    assert.ok(result.diffEvidenceSha256);
    assert.ok(result.groundTruth?.contentHash);
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Bash replay records exit and side effects on copy only", async () => {
  const ws = await tempWorkspace();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "replay-ev-b-"));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "replay-bash-"));
  try {
    const store = new EvidenceStore(evidenceRoot);
    const isWin = process.platform === "win32";
    const command = isWin
      ? "echo bash-out> side.txt"
      : "echo bash-out > side.txt";
    const original = { stdout: "bash-out\n", stderr: "", exitCode: 0 };
    const bundle = await createReplayBundle({
      toolName: "Bash",
      toolInput: { command },
      cwd: ws,
      originalResult: original,
      chatId: "c3",
      runId: "r3",
      allowedEnvNames: [],
    });
    const result = await replayTool(bundle, {
      evidenceStore: store,
      originalResult: original,
      attemptDir: ws,
      tempRoot,
    });
    assert.ok(["match", "mismatch"].includes(result.status));
    assert.equal(
      await readFile(path.join(ws, "hello.txt"), "utf8").then(() => true),
      true,
    );
    // side.txt must not appear in original workspace
    let sideInWs = false;
    try {
      await readFile(path.join(ws, "side.txt"));
      sideInWs = true;
    } catch {
      sideInWs = false;
    }
    assert.equal(sideInWs, false);
    assert.ok(result.groundTruth?.sideEffects);
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Glob and Grep independent fs verification", async () => {
  const ws = await tempWorkspace();
  try {
    const glob = await groundTruthGlob(ws, { pattern: "*.txt" });
    assert.ok(glob.matchCount >= 1);
    const grep = await groundTruthGrep(ws, { pattern: "findme", path: "." });
    assert.ok(grep.hitCount >= 1);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("replay_failed yields inconclusive classification", async () => {
  const ws = await tempWorkspace();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "replay-ev-fail-"));
  try {
    const store = new EvidenceStore(evidenceRoot);
    const bundle = await createReplayBundle({
      toolName: "Edit",
      toolInput: {
        file_path: "missing-file.txt",
        old_string: "a",
        new_string: "b",
      },
      cwd: ws,
      originalResult: { ok: false },
      chatId: "c4",
      runId: "r4",
    });
    const result = await replayTool(bundle, {
      evidenceStore: store,
      attemptDir: ws,
      tempRoot: await mkdtemp(path.join(os.tmpdir(), "replay-fail-tmp-")),
    });
    assert.equal(result.status, "replay_failed");
    assert.equal(result.classificationHint, "inconclusive");
    assert.ok(result.error);
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("mismatch does not overwrite original evidence hash identity", async () => {
  const ws = await tempWorkspace();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "replay-ev-m-"));
  try {
    const store = new EvidenceStore(evidenceRoot);
    const originalMeta = await store.store({
      chatId: "c5",
      runId: "r5",
      content: { content: "hello world\nline2\n" },
      kind: "tool_result",
    });
    const lyingOriginal = { content: "DIFFERENT", contentHash: "nope" };
    const bundle = await createReplayBundle({
      toolName: "Read",
      toolInput: { file_path: "hello.txt" },
      cwd: ws,
      originalResult: lyingOriginal,
      chatId: "c5",
      runId: "r5",
    });
    const result = await replayTool(bundle, {
      evidenceStore: store,
      originalResult: lyingOriginal,
      attemptDir: ws,
    });
    assert.equal(result.status, "mismatch");
    assert.equal(result.classificationHint, "tool_failure");
    assert.notEqual(result.evidenceSha256, originalMeta.sha256);
    assert.equal(
      hashContent({ content: "hello world\nline2\n" }),
      originalMeta.sha256,
    );
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
