import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EvidenceStore, hashContent } from "./evidence-store.js";
import { redact } from "./redaction.js";

export interface ToolReplayBundle {
  bundleId: string;
  toolName: string;
  toolVersion?: string;
  input: unknown; // redacted
  cwd: string;
  allowedEnvNames: string[];
  fixtureHash?: string;
  repositoryHash?: string;
  originalResultHash: string;
  originalAt: string;
  chatId: string;
  runId: string;
  toolUseId?: string;
  eventId?: string;
}

export interface ToolReplayResult {
  replayId: string;
  bundleId: string;
  status: "match" | "mismatch" | "replay_failed";
  classificationHint: "tool_failure" | "pass" | "inconclusive";
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
  durationMs: number;
  resultHash: string;
  evidenceSha256?: string;
  diffEvidenceSha256?: string;
  groundTruth?: Record<string, unknown>;
  error?: string;
}

export interface ReplayOptions {
  evidenceStore?: EvidenceStore;
  /** Original tool result for comparison (will be hashed). */
  originalResult?: unknown;
  /** Absolute path to attempt workspace; Write/Edit/Bash copy this. */
  attemptDir?: string;
  /** Isolated temp root override (tests). */
  tempRoot?: string;
}

const READONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);
const MUTATING_TOOLS = new Set(["Write", "Edit", "Bash"]);

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function assertUnderCwd(cwd: string, candidate: string) {
  const root = await realpath(path.resolve(cwd));
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(candidate));
  } catch {
    // Parent may exist for new files — check resolved parent + basename.
    const parent = await realpath(path.resolve(path.dirname(candidate)));
    resolved = path.join(parent, path.basename(candidate));
  }
  if (!inside(root, resolved) && !inside(root, path.resolve(candidate))) {
    throw new Error(`Path escapes replay cwd: ${candidate}`);
  }
  return { root, resolved: path.resolve(candidate) };
}

function envAllowlist(allowedEnvNames: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowedEnvNames) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  env.PATH = process.env.PATH;
  env.SystemRoot = process.env.SystemRoot;
  env.TEMP = process.env.TEMP;
  env.TMP = process.env.TMP;
  env.HOME = process.env.HOME;
  env.USERPROFILE = process.env.USERPROFILE;
  return env;
}

async function copyAttemptTree(source: string, dest: string) {
  await mkdir(dest, { recursive: true });
  await cp(source, dest, { recursive: true, dereference: false });
}

async function hashFile(filePath: string) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function createReplayBundle(input: {
  toolName: string;
  toolVersion?: string;
  toolInput: unknown;
  cwd: string;
  allowedEnvNames?: string[];
  fixtureHash?: string;
  repositoryHash?: string;
  originalResult: unknown;
  chatId: string;
  runId: string;
  toolUseId?: string;
  eventId?: string;
}): Promise<ToolReplayBundle> {
  return {
    bundleId: `bundle-${randomUUID()}`,
    toolName: input.toolName,
    toolVersion: input.toolVersion,
    input: redact(input.toolInput),
    cwd: path.resolve(input.cwd),
    allowedEnvNames: input.allowedEnvNames ?? [],
    fixtureHash: input.fixtureHash,
    repositoryHash: input.repositoryHash,
    originalResultHash: hashContent(input.originalResult),
    originalAt: new Date().toISOString(),
    chatId: input.chatId,
    runId: input.runId,
    toolUseId: input.toolUseId,
    eventId: input.eventId,
  };
}

/** Read ground truth: existence, realpath, content hash, permissions, range. */
export async function groundTruthRead(
  cwd: string,
  toolInput: Record<string, unknown>,
) {
  const filePath = String(toolInput.file_path ?? toolInput.path ?? "");
  const offset = numberOrUndef(toolInput.offset);
  const limit = numberOrUndef(toolInput.limit);
  const { root, resolved } = await assertUnderCwd(
    cwd,
    path.resolve(cwd, filePath),
  );
  let exists = false;
  let real: string | null = null;
  let contentHash: string | null = null;
  let permissions: string | null = null;
  let bytes = 0;
  let rangeContent: string | null = null;
  try {
    const st = await stat(resolved);
    exists = st.isFile();
    real = await realpath(resolved);
    if (!inside(root, real)) throw new Error("realpath escapes cwd");
    permissions = modeString(st.mode);
    const full = await readFile(resolved, "utf8");
    bytes = Buffer.byteLength(full, "utf8");
    contentHash = createHash("sha256").update(full, "utf8").digest("hex");
    rangeContent = sliceLines(full, offset, limit);
  } catch (error) {
    return {
      kind: "Read",
      exists: false,
      filePath,
      error: error instanceof Error ? error.message : String(error),
      offset,
      limit,
    };
  }
  return {
    kind: "Read",
    exists,
    filePath,
    realpath: real,
    contentHash,
    permissions,
    bytes,
    offset: offset ?? null,
    limit: limit ?? null,
    rangeHash: rangeContent
      ? createHash("sha256").update(rangeContent, "utf8").digest("hex")
      : null,
    content: rangeContent,
  };
}

/** Glob ground truth via independent fs walk. */
export async function groundTruthGlob(
  cwd: string,
  toolInput: Record<string, unknown>,
) {
  const pattern = String(toolInput.pattern ?? toolInput.glob ?? "*");
  const searchPath = String(toolInput.path ?? ".");
  const root = await realpath(path.resolve(cwd, searchPath));
  const matches = await walkMatch(root, pattern);
  return {
    kind: "Glob",
    pattern,
    path: searchPath,
    matches,
    matchCount: matches.length,
    toolVersion: "fs-walk-1",
  };
}

/** Grep ground truth via independent file scan. */
export async function groundTruthGrep(
  cwd: string,
  toolInput: Record<string, unknown>,
) {
  const pattern = String(toolInput.pattern ?? "");
  const searchPath = String(toolInput.path ?? ".");
  const glob = toolInput.glob ? String(toolInput.glob) : undefined;
  const root = await realpath(path.resolve(cwd, searchPath));
  const files = await walkMatch(root, glob ?? "*");
  const regex = new RegExp(pattern, "gm");
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    try {
      const text = await readFile(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          hits.push({
            file: path.relative(root, file).replace(/\\/g, "/"),
            line: idx + 1,
            text: line.slice(0, 500),
          });
        }
        regex.lastIndex = 0;
      });
    } catch {
      // skip unreadable
    }
  }
  return {
    kind: "Grep",
    pattern,
    path: searchPath,
    hits,
    hitCount: hits.length,
    toolVersion: "fs-scan-1",
  };
}

/** Bash ground truth: cwd, shell, exit, side-effect diff against pre-copy snapshot. */
export async function groundTruthBash(
  workDir: string,
  toolInput: Record<string, unknown>,
  allowedEnvNames: string[],
  beforeSnapshot?: Map<string, string>,
) {
  const command = String(toolInput.command ?? "");
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const started = Date.now();
  const { stdout, stderr, exitCode } = await runCommand(
    command,
    workDir,
    allowedEnvNames,
  );
  const after = await snapshotHashes(workDir);
  const sideEffects: Array<{
    path: string;
    change: string;
    before?: string;
    after?: string;
  }> = [];
  const before = beforeSnapshot ?? new Map();
  for (const [rel, hash] of after) {
    if (!before.has(rel))
      sideEffects.push({ path: rel, change: "added", after: hash });
    else if (before.get(rel) !== hash)
      sideEffects.push({
        path: rel,
        change: "modified",
        before: before.get(rel),
        after: hash,
      });
  }
  for (const [rel, hash] of before) {
    if (!after.has(rel))
      sideEffects.push({ path: rel, change: "removed", before: hash });
  }
  return {
    kind: "Bash",
    cwd: workDir,
    shell,
    command,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - started,
    sideEffects,
  };
}

/** Write/Edit ground truth: final file bytes/hash. */
export async function groundTruthWriteEdit(
  workDir: string,
  toolName: "Write" | "Edit",
  toolInput: Record<string, unknown>,
) {
  const filePath = String(toolInput.file_path ?? toolInput.path ?? "");
  const absolute = path.resolve(workDir, filePath);
  await assertUnderCwd(workDir, absolute);

  if (toolName === "Write") {
    const content = String(toolInput.content ?? "");
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  } else {
    const oldString = String(toolInput.old_string ?? toolInput.oldString ?? "");
    const newString = String(toolInput.new_string ?? toolInput.newString ?? "");
    const existing = await readFile(absolute, "utf8");
    if (!existing.includes(oldString)) {
      throw new Error("Edit old_string not found in target file");
    }
    const replaceAll = Boolean(toolInput.replace_all ?? toolInput.replaceAll);
    const updated = replaceAll
      ? existing.split(oldString).join(newString)
      : existing.replace(oldString, newString);
    await writeFile(absolute, updated, "utf8");
  }

  const buf = await readFile(absolute);
  return {
    kind: toolName,
    filePath,
    bytes: buf.byteLength,
    contentHash: createHash("sha256").update(buf).digest("hex"),
    contentPreview: buf.toString("utf8").slice(0, 2000),
  };
}

export async function replayTool(
  bundle: ToolReplayBundle,
  options: ReplayOptions = {},
): Promise<ToolReplayResult> {
  const store = options.evidenceStore ?? new EvidenceStore();
  const replayId = `replay-${randomUUID()}`;
  const started = Date.now();
  let workDir = path.resolve(bundle.cwd);
  let isolatedCopy: string | null = null;
  const toolInput = (bundle.input ?? {}) as Record<string, unknown>;

  try {
    if (MUTATING_TOOLS.has(bundle.toolName)) {
      const source = options.attemptDir
        ? path.resolve(options.attemptDir)
        : workDir;
      isolatedCopy = path.join(
        options.tempRoot ?? os.tmpdir(),
        `tool-replay-${randomUUID()}`,
      );
      await copyAttemptTree(source, isolatedCopy);
      workDir = isolatedCopy;
    } else if (READONLY_TOOLS.has(bundle.toolName)) {
      // Readonly: realpath-check under cwd; optionally use temp copy if provided
      if (options.attemptDir) {
        isolatedCopy = path.join(
          options.tempRoot ?? os.tmpdir(),
          `tool-replay-ro-${randomUUID()}`,
        );
        await copyAttemptTree(path.resolve(options.attemptDir), isolatedCopy);
        workDir = isolatedCopy;
      } else {
        workDir = await realpath(workDir);
      }
    }

    let groundTruth: Record<string, unknown>;
    let stdout: unknown;
    let stderr: unknown = null;
    let exitCode: number | null = 0;

    switch (bundle.toolName) {
      case "Read": {
        groundTruth = await groundTruthRead(workDir, toolInput);
        stdout = groundTruth.content ?? groundTruth;
        break;
      }
      case "Glob": {
        groundTruth = await groundTruthGlob(workDir, toolInput);
        stdout = groundTruth.matches;
        break;
      }
      case "Grep": {
        groundTruth = await groundTruthGrep(workDir, toolInput);
        stdout = groundTruth.hits;
        break;
      }
      case "Bash": {
        const before = await snapshotHashes(workDir);
        groundTruth = await groundTruthBash(
          workDir,
          toolInput,
          bundle.allowedEnvNames,
          before,
        );
        stdout = groundTruth.stdout;
        stderr = groundTruth.stderr;
        exitCode = (groundTruth.exitCode as number | null) ?? null;
        break;
      }
      case "Write":
      case "Edit": {
        groundTruth = await groundTruthWriteEdit(
          workDir,
          bundle.toolName,
          toolInput,
        );
        stdout = { ok: true, contentHash: groundTruth.contentHash };
        break;
      }
      default: {
        groundTruth = {
          kind: bundle.toolName,
          note: "Web/Search-style tools record status only in this harness",
          executed: false,
          emptyVsNotExecuted: "not_executed",
        };
        stdout = groundTruth;
        exitCode = null;
      }
    }

    const replayPayload = {
      replayId,
      bundleId: bundle.bundleId,
      toolName: bundle.toolName,
      stdout,
      stderr,
      exitCode,
      groundTruth,
    };
    const resultHash = hashContent(replayPayload);
    const durationMs = Date.now() - started;

    let status: ToolReplayResult["status"] = "match";
    let classificationHint: ToolReplayResult["classificationHint"] = "pass";
    let diffEvidenceSha256: string | undefined;

    if (options.originalResult !== undefined) {
      const originalHash = hashContent(options.originalResult);
      const agree = hashesAgree(options.originalResult, groundTruth, stdout);

      if (!agree) {
        status = "mismatch";
        classificationHint = "tool_failure";
        const diffMeta = await store.store({
          chatId: bundle.chatId,
          runId: bundle.runId,
          kind: "tool_replay_diff",
          alreadyRedacted: true,
          content: {
            bundleId: bundle.bundleId,
            replayId,
            original: redact(options.originalResult),
            replay: redact(replayPayload),
            originalHash,
            resultHash,
          },
          sourceEventId: bundle.eventId,
          labels: ["tool_replay", "mismatch"],
        });
        diffEvidenceSha256 = diffMeta.sha256;
      }
    }

    const evidence = await store.store({
      chatId: bundle.chatId,
      runId: bundle.runId,
      kind: "tool_replay",
      alreadyRedacted: true,
      content: redact({
        ...replayPayload,
        status,
        classificationHint,
        durationMs,
        resultHash,
      }),
      sourceEventId: bundle.eventId,
      labels: ["tool_replay", status],
    });

    return {
      replayId,
      bundleId: bundle.bundleId,
      status,
      classificationHint,
      stdout,
      stderr,
      exitCode,
      durationMs,
      resultHash,
      evidenceSha256: evidence.sha256,
      diffEvidenceSha256,
      groundTruth,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    const failedPayload = {
      replayId,
      bundleId: bundle.bundleId,
      error: message,
      status: "replay_failed" as const,
    };
    const resultHash = hashContent(failedPayload);
    let evidenceSha256: string | undefined;
    try {
      const evidence = await store.store({
        chatId: bundle.chatId,
        runId: bundle.runId,
        kind: "tool_replay",
        alreadyRedacted: true,
        content: redact(failedPayload),
        labels: ["tool_replay", "replay_failed"],
      });
      evidenceSha256 = evidence.sha256;
    } catch {
      // evidence optional on nested failure
    }
    return {
      replayId,
      bundleId: bundle.bundleId,
      status: "replay_failed",
      classificationHint: "inconclusive",
      durationMs,
      resultHash,
      evidenceSha256,
      error: message,
    };
  }
}

function hashesAgree(
  original: unknown,
  groundTruth: Record<string, unknown>,
  stdout: unknown,
): boolean {
  const orig = original as Record<string, unknown>;
  if (orig && typeof orig === "object") {
    if (
      typeof orig.contentHash === "string" &&
      typeof groundTruth.contentHash === "string"
    ) {
      return orig.contentHash === groundTruth.contentHash;
    }
    if (typeof orig.content === "string" && typeof stdout === "string") {
      return orig.content === stdout;
    }
    if (Array.isArray(orig.matches) && Array.isArray(groundTruth.matches)) {
      return hashContent(orig.matches) === hashContent(groundTruth.matches);
    }
    if (
      typeof orig.stdout === "string" &&
      typeof groundTruth.stdout === "string"
    ) {
      return (
        String(orig.stdout).replace(/\r\n/g, "\n").trim() ===
          String(groundTruth.stdout).replace(/\r\n/g, "\n").trim() &&
        (orig.exitCode ?? 0) === (groundTruth.exitCode ?? 0)
      );
    }
    if (orig.ok === true && groundTruth.contentHash) {
      return !orig.contentHash || orig.contentHash === groundTruth.contentHash;
    }
  }
  return hashContent(original) === hashContent({ stdout, groundTruth });
}

function numberOrUndef(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  )
    return Number(value);
  return undefined;
}

function modeString(mode: number) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function sliceLines(text: string, offset?: number, limit?: number) {
  if (offset === undefined && limit === undefined) return text;
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, (offset ?? 1) - 1);
  const end = limit === undefined ? lines.length : start + limit;
  return lines.slice(start, end).join("\n");
}

function globToRegExp(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, "[^/\\\\]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

async function walkMatch(root: string, pattern: string): Promise<string[]> {
  const regex = globToRegExp(pattern.replace(/\\/g, "/"));
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (
          regex.test(rel) ||
          regex.test(entry.name) ||
          regex.test(path.basename(rel))
        ) {
          out.push(full);
        }
      }
    }
  }
  await walk(root);
  return out.sort();
}

async function snapshotHashes(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.isFile()) {
        map.set(rel, await hashFile(full));
      }
    }
  }
  await walk(root);
  return map;
}

function runCommand(
  command: string,
  cwd: string,
  allowedEnvNames: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(
      isWin ? "cmd.exe" : "/bin/sh",
      isWin ? ["/c", command] : ["-c", command],
      {
        cwd,
        env: envAllowlist(allowedEnvNames),
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr || err.message, exitCode: 1 });
    });
  });
}
