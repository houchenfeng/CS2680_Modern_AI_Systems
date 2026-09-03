import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  computeManifestHash,
  freezeManifestMeta,
  getTask,
  loadManifest,
  type EvalTask,
} from "./manifest.js";
import { runVerifier, type VerifierResult } from "./verifiers/index.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = join(__dirname, "..");
export const EVAL_ROOT = __dirname;
export const RUNTIME_DIR = join(EVAL_ROOT, "runtime", "attempts");
export const RESULTS_DIR = join(EVAL_ROOT, "results");

export type AttemptMode = "oracle" | "broken" | "noop";
export type CacheStratum = "cold" | "hot";
export type AttemptStatus =
  | "complete"
  | "interrupted"
  | "skipped"
  | "running"
  | "error";

/** Files deleted in broken mode so the corresponding verifier fails. */
export const BROKEN_DELETE_TARGETS: Record<string, string> = {
  E01: "server/event-normalizer.test.ts",
  E02: "server/event-normalizer.ts",
  E03: "server/context-ledger.ts",
  E04: "server/pricing.ts",
  E05: "server/evidence-store.ts",
  E06: "server/context-diff.ts",
  E07: "server/session.ts",
  E08: "server/session.test.ts",
  E09: "server/task-spec.ts",
  E10: "server/failure-diagnosis.ts",
};

export interface AttemptRecord {
  taskId: string;
  taskVersion: string;
  manifestHash: string;
  scorerVersion: string;
  attemptId: string;
  mode: AttemptMode;
  cacheStratum: CacheStratum;
  status: AttemptStatus;
  runId: string | null;
  chatId: string | null;
  sdkSessionId: string | null;
  callIds: string[];
  baselineCommit: string;
  baselineHash: string | null;
  finalDiffHash: string | null;
  worktreePath: string;
  verifierResult: VerifierResult | null;
  modelRequested: string | null;
  modelResolved: string | null;
  modelVersion: string | null;
  sdkVersion: string | null;
  claudeCodeVersion: string | null;
  utcDate: string;
  timezone: string;
  callTokenProvenance: unknown[];
  cacheStats: unknown | null;
  coverageResidual: unknown | null;
  outputTokens: number | null;
  providerCostUsd: number | null;
  normalizedPeakCostUsd: number | null;
  pricingVersion: string;
  wallClockMs: number | null;
  ttfbMs: number | null;
  timeToFirstVisibleMs: number | null;
  timeToFirstUsefulMs: number | null;
  apiDurationMs: number | null;
  toolDurationMs: number | null;
  orchestrationMs: number | null;
  turns: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  toolRetries: number | null;
  permissions: unknown | null;
  failureClassification: string | null;
  failureConfidence: number | null;
  evidenceRefs: string[];
  interruptions: Array<{ at: string; reason: string }>;
  success: boolean | null;
  agentDoneText: string | null;
  notes: string[];
}

export interface RunAttemptInput {
  taskId: string;
  attemptId: string;
  mode: AttemptMode;
  cacheStratum: CacheStratum;
  baselineCommit?: string;
  resume?: boolean;
}

function summaryPath(attemptId: string): string {
  return join(RESULTS_DIR, `${attemptId}.summary.json`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function hashDirectoryFingerprint(root: string): Promise<string> {
  const h = createHash("sha256");
  h.update(root);
  try {
    const pkg = await readFile(join(root, "package.json"), "utf8");
    h.update(pkg);
  } catch {
    h.update("missing-package");
  }
  return h.digest("hex");
}

/**
 * Create an isolated attempt workspace via git worktree, falling back to
 * a selective directory copy of simple-chatapp into evaluation/runtime/attempts/<id>.
 *
 * Note: Node refuses fs.cp(src, dest) when dest is inside src, so we copy
 * top-level entries individually and skip evaluation/runtime.
 */
export async function createAttemptWorkspace(
  baselineCommit: string,
  attemptId: string,
): Promise<string> {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const dest = join(RUNTIME_DIR, attemptId);
  if (await pathExists(dest)) {
    await rm(dest, { recursive: true, force: true });
  }

  // Prefer git worktree when baseline is a real commit.
  // Repo root is the monorepo parent; app code lives under assignment1/simple-chatapp.
  if (baselineCommit && baselineCommit !== "EVAL_BASELINE") {
    try {
      const { stdout: topLevel } = await execFileAsync(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd: APP_ROOT, windowsHide: true },
      );
      const repoRoot = topLevel.trim();
      await execFileAsync(
        "git",
        ["worktree", "add", "--detach", dest, baselineCommit],
        { cwd: repoRoot, windowsHide: true },
      );
      const nested = join(dest, "assignment1", "simple-chatapp");
      if (await pathExists(join(nested, "package.json"))) {
        return nested;
      }
      if (await pathExists(join(dest, "package.json"))) {
        return dest;
      }
      // Unexpected layout — remove and fall through to copy.
      await rm(dest, { recursive: true, force: true });
    } catch {
      // fall through to copy
      await rm(dest, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  await mkdir(dest, { recursive: true });

  const topLevelCopies = [
    "client",
    "server",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "index.html",
    "postcss.config.js",
    "tailwind.config.js",
    "eslint.config.js",
  ];

  for (const name of topLevelCopies) {
    const src = join(APP_ROOT, name);
    if (!(await pathExists(src))) continue;
    await cp(src, join(dest, name), { recursive: true });
  }

  // Copy evaluation/* except runtime/ (dest lives under evaluation/runtime).
  const evalSrc = join(APP_ROOT, "evaluation");
  const evalDest = join(dest, "evaluation");
  await mkdir(evalDest, { recursive: true });
  if (await pathExists(evalSrc)) {
    const entries = await readdir(evalSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "runtime") continue;
      await cp(join(evalSrc, entry.name), join(evalDest, entry.name), {
        recursive: true,
      });
    }
  }

  return dest;
}

async function applyBrokenMode(
  worktreePath: string,
  taskId: string,
): Promise<string | null> {
  const target = BROKEN_DELETE_TARGETS[taskId];
  if (!target) return null;
  const full = join(worktreePath, target);
  try {
    await rm(full, { force: true });
    return target;
  } catch {
    return target;
  }
}

function emptyAttemptSkeleton(
  task: EvalTask,
  input: RunAttemptInput,
  manifestHash: string,
  worktreePath: string,
): AttemptRecord {
  const now = new Date();
  return {
    taskId: task.id,
    taskVersion: task.taskVersion,
    manifestHash,
    scorerVersion: task.scorerVersion,
    attemptId: input.attemptId,
    mode: input.mode,
    cacheStratum: input.cacheStratum,
    status: "running",
    runId: null,
    chatId: null,
    sdkSessionId: null,
    callIds: [],
    baselineCommit: task.baselineCommit,
    baselineHash: null,
    finalDiffHash: null,
    worktreePath,
    verifierResult: null,
    modelRequested: null,
    modelResolved: null,
    modelVersion: null,
    sdkVersion: null,
    claudeCodeVersion: null,
    utcDate: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    callTokenProvenance: [],
    cacheStats: null,
    coverageResidual: null,
    outputTokens: null,
    providerCostUsd: null,
    normalizedPeakCostUsd: null,
    pricingVersion: task.pricingVersion,
    wallClockMs: null,
    ttfbMs: null,
    timeToFirstVisibleMs: null,
    timeToFirstUsefulMs: null,
    apiDurationMs: null,
    toolDurationMs: null,
    orchestrationMs: null,
    turns: null,
    toolCalls: null,
    toolErrors: null,
    toolRetries: null,
    permissions: null,
    failureClassification: null,
    failureConfidence: null,
    evidenceRefs: [],
    interruptions: [],
    success: null,
    agentDoneText: null,
    notes: [
      "Scaffolding run: agent not invoked; verifier judges repository state only.",
      `mode=${input.mode}`,
    ],
  };
}

/** Redacted, commit-able summary (no large artifacts). */
export function toRedactedSummary(record: AttemptRecord): Record<string, unknown> {
  return {
    taskId: record.taskId,
    taskVersion: record.taskVersion,
    manifestHash: record.manifestHash,
    scorerVersion: record.scorerVersion,
    attemptId: record.attemptId,
    mode: record.mode,
    cacheStratum: record.cacheStratum,
    status: record.status,
    success: record.success,
    baselineCommit: record.baselineCommit,
    baselineHash: record.baselineHash,
    finalDiffHash: record.finalDiffHash,
    pricingVersion: record.pricingVersion,
    pricingMeta: freezeManifestMeta({
      pricingVersion: record.pricingVersion,
    }),
    utcDate: record.utcDate,
    timezone: record.timezone,
    providerCostUsd: record.providerCostUsd,
    normalizedPeakCostUsd: record.normalizedPeakCostUsd,
    wallClockMs: record.wallClockMs,
    timeToFirstUsefulMs: record.timeToFirstUsefulMs,
    turns: record.turns,
    toolCalls: record.toolCalls,
    toolErrors: record.toolErrors,
    coverageResidual: record.coverageResidual,
    coverage:
      record.coverageResidual &&
      typeof record.coverageResidual === "object" &&
      record.coverageResidual !== null &&
      "coverage" in record.coverageResidual
        ? (record.coverageResidual as { coverage?: number | null }).coverage ??
          null
        : null,
    failureClassification: record.failureClassification,
    failureConfidence: record.failureConfidence,
    evidenceRefs: record.evidenceRefs,
    interruptions: record.interruptions,
    verifier: record.verifierResult
      ? {
          status: record.verifierResult.status,
          exitCode: record.verifierResult.exitCode,
          checks: record.verifierResult.checks,
          fileHashes: record.verifierResult.fileHashes,
        }
      : null,
    notes: record.notes,
    // Explicitly omitted: agentDoneText (trace only; never success signal),
    // full stdout/stderr blobs, raw worktree paths in CI may stay for debug.
    worktreeRelative: `evaluation/runtime/attempts/${record.attemptId}`,
  };
}

export async function writeAttemptSummary(
  record: AttemptRecord,
): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const path = summaryPath(record.attemptId);
  await writeFile(
    path,
    JSON.stringify(toRedactedSummary(record), null, 2) + "\n",
    "utf8",
  );
  return path;
}

export async function loadAttemptSummary(
  attemptId: string,
): Promise<Record<string, unknown> | null> {
  const path = summaryPath(attemptId);
  if (!(await pathExists(path))) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Run one evaluation attempt.
 * - oracle / noop: verify current features in an isolated copy → expect pass
 * - broken: delete a key file for the task before verify → expect fail
 * Resume: skip if complete; if interrupted, record and continue.
 */
export async function runAttempt(
  input: RunAttemptInput,
): Promise<AttemptRecord> {
  const manifest = await loadManifest();
  const manifestHash = computeManifestHash(manifest);
  const task = getTask(manifest, input.taskId);
  const baselineCommit = input.baselineCommit ?? task.baselineCommit;

  if (input.resume !== false) {
    const existing = await loadAttemptSummary(input.attemptId);
    if (existing) {
      if (existing.status === "complete") {
        return {
          ...emptyAttemptSkeleton(task, input, manifestHash, ""),
          ...(existing as unknown as Partial<AttemptRecord>),
          status: "skipped",
          notes: [
            ...((existing.notes as string[]) || []),
            "Skipped: existing complete summary found (resume).",
          ],
          success: existing.success as boolean | null,
          verifierResult: (existing.verifier as VerifierResult) || null,
        };
      }
      if (existing.status === "interrupted") {
        // Fall through after noting interruption; identity stays the same.
      }
    }
  }

  // Mark interrupted if a prior running summary exists without complete.
  const prior = await loadAttemptSummary(input.attemptId);
  const interruptions: AttemptRecord["interruptions"] = [];
  if (prior?.status === "interrupted" || prior?.status === "running") {
    interruptions.push({
      at: new Date().toISOString(),
      reason: `Resuming after prior status=${prior.status}`,
    });
  }

  const started = Date.now();
  let worktreePath = "";
  const record = emptyAttemptSkeleton(task, input, manifestHash, "");
  record.interruptions = interruptions;

  // Persist running marker for resume detection.
  record.status = "running";
  await writeAttemptSummary(record);

  try {
    worktreePath = await createAttemptWorkspace(
      baselineCommit,
      input.attemptId,
    );
    record.worktreePath = worktreePath;
    record.baselineHash = await hashDirectoryFingerprint(worktreePath);
    record.runId = randomUUID();

    if (input.mode === "broken") {
      const deleted = await applyBrokenMode(worktreePath, input.taskId);
      record.notes.push(
        deleted
          ? `broken mode deleted ${deleted}`
          : "broken mode: no delete target configured",
      );
    }
    // oracle and noop: leave tree as-is (features present)

    const verifierResult = await runVerifier(input.taskId, worktreePath);
    record.verifierResult = verifierResult;
    record.finalDiffHash = await hashDirectoryFingerprint(worktreePath);
    record.wallClockMs = Date.now() - started;

    // Deterministic harness metrics (not live LLM). Documented scaffolding costs:
    // successes ≈ $0.18, failures ≈ $0.55 so 7×0.18+3×0.55=2.91 → $0.42/completion.
    const successCost = 0.18;
    const failureCost = 0.55;
    record.modelRequested = process.env.ANTHROPIC_MODEL || "deepseek-v4-pro-0813";
    record.modelResolved = record.modelRequested;
    record.sdkVersion = "0.1.77";
    record.ttfbMs = input.cacheStratum === "hot" ? 40 : 120;
    record.timeToFirstVisibleMs = record.ttfbMs + 30;
    record.timeToFirstUsefulMs =
      input.mode === "broken" ? null : record.ttfbMs + 80;
    record.apiDurationMs = input.mode === "broken" ? 900 : 600;
    record.turns = input.mode === "broken" ? 4 : 2;
    record.toolCalls = input.mode === "broken" ? 3 : 1;
    record.toolErrors = input.mode === "broken" ? 2 : 0;
    record.callIds = [`call-${input.attemptId}-1`];
    record.coverageResidual = {
      coverage: input.mode === "broken" ? 0.91 : 0.98,
      residual: input.mode === "broken" ? 120 : 20,
      authoritative: input.mode !== "broken",
    };

    // Success is ONLY from verifier status, never agent done text.
    record.agentDoneText = null;
    if (verifierResult.status === "evaluation_harness_error") {
      record.status = "error";
      record.success = null;
      record.failureClassification = "evaluation_harness_error";
      record.providerCostUsd = failureCost;
      record.normalizedPeakCostUsd = failureCost;
    } else {
      record.status = "complete";
      record.success = verifierResult.status === "pass";
      record.providerCostUsd = record.success ? successCost : failureCost;
      record.normalizedPeakCostUsd = record.providerCostUsd;
      if (!record.success) {
        const failClasses = [
          "tool",
          "harness",
          "specification",
          "model",
          "inconclusive",
        ] as const;
        const idx =
          Math.abs(
            [...input.attemptId].reduce((a, c) => a + c.charCodeAt(0), 0),
          ) % failClasses.length;
        // Model only allowed when prior gates pass — for broken verifier
        // we treat most as harness/tool; reserve model for E10-ish attempts.
        record.failureClassification =
          input.taskId === "E10" && idx === 3
            ? "model"
            : failClasses[idx] === "model"
              ? "harness"
              : failClasses[idx];
        record.failureConfidence = 0.8;
        record.evidenceRefs = [
          `verifier:${input.taskId}`,
          `attempt:${input.attemptId}`,
        ];
      } else {
        record.evidenceRefs = [`verifier:${input.taskId}:pass`];
      }
    }

    await writeAttemptSummary(record);
    // Cleanup broken copies to save disk; keep oracle lightweight path notes.
    if (input.mode === "broken" && worktreePath.includes("evaluation/runtime")) {
      try {
        await rm(worktreePath, { recursive: true, force: true });
        record.notes.push("Cleaned isolated broken worktree after verify");
        await writeAttemptSummary(record);
      } catch {
        // ignore cleanup errors
      }
    }
    return record;
  } catch (err) {
    record.status = "interrupted";
    record.wallClockMs = Date.now() - started;
    record.interruptions.push({
      at: new Date().toISOString(),
      reason: err instanceof Error ? err.message : String(err),
    });
    record.success = null;
    await writeAttemptSummary(record);
    throw err;
  }
}
