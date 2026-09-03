import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import {
  COST_FIXTURE_ATTEMPTS,
  COST_FIXTURE_SUCCESSES,
  costPerCompletedTask,
  costFixtureRounded,
} from "./metrics.js";
import { runVerifier } from "./verifiers/index.js";
import {
  RESULTS_DIR,
  RUNTIME_DIR,
  runAttempt,
  toRedactedSummary,
  type AttemptRecord,
} from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");

async function cleanupAttempt(attemptId: string): Promise<void> {
  await rm(join(RUNTIME_DIR, attemptId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  await rm(join(RESULTS_DIR, `${attemptId}.summary.json`), {
    force: true,
  }).catch(() => undefined);
}

test("cost formula fixture rounds to $0.42/completion", () => {
  const exact = costPerCompletedTask(
    [...COST_FIXTURE_ATTEMPTS],
    COST_FIXTURE_SUCCESSES,
  );
  assert.ok(exact !== undefined);
  assert.equal(Number(exact!.toFixed(4)), 0.4157);
  assert.equal(costFixtureRounded(), 0.42);
});

test("toRedactedSummary exports coverage and coverageResidual", () => {
  const record = {
    taskId: "E01",
    taskVersion: "1.0.0",
    manifestHash: "abc",
    scorerVersion: "eval-scorer-1.0.0",
    attemptId: "final-E01-a01",
    mode: "oracle",
    cacheStratum: "cold",
    status: "complete",
    success: true,
    baselineCommit: "405c3d1",
    baselineHash: "h1",
    finalDiffHash: "h1",
    pricingVersion: "deepseek-v4-pro-peak-2026-09-02",
    utcDate: "2026-09-03T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    providerCostUsd: 0.18,
    normalizedPeakCostUsd: 0.18,
    wallClockMs: 100,
    timeToFirstUsefulMs: 50,
    turns: 2,
    toolCalls: 1,
    toolErrors: 0,
    coverageResidual: { coverage: 0.98, residual: 20, authoritative: true },
    failureClassification: null,
    failureConfidence: null,
    evidenceRefs: ["verifier:E01:pass"],
    interruptions: [],
    verifierResult: null,
    notes: [],
  } as unknown as AttemptRecord;
  const summary = toRedactedSummary(record);
  assert.equal(summary.coverage, 0.98);
  assert.deepEqual(summary.coverageResidual, {
    coverage: 0.98,
    residual: 20,
    authoritative: true,
  });
});

test("verifier E04 passes on current app cwd", async () => {
  const result = await runVerifier("E04", APP_ROOT);
  assert.equal(result.status, "pass", result.stderr);
  assert.equal(result.exitCode, 0);
});

test("broken mode fails E04", async () => {
  const attemptId = `test-e04-broken-${randomUUID().slice(0, 8)}`;
  try {
    const record = await runAttempt({
      taskId: "E04",
      attemptId,
      mode: "broken",
      cacheStratum: "cold",
      resume: false,
    });
    assert.equal(record.status, "complete");
    assert.equal(record.success, false);
    assert.equal(record.verifierResult?.status, "fail");
  } finally {
    await cleanupAttempt(attemptId);
  }
});

test("oracle mode passes E04", async () => {
  const attemptId = `test-e04-oracle-${randomUUID().slice(0, 8)}`;
  try {
    const record = await runAttempt({
      taskId: "E04",
      attemptId,
      mode: "oracle",
      cacheStratum: "cold",
      resume: false,
    });
    assert.equal(record.status, "complete");
    assert.equal(record.success, true);
    assert.equal(record.verifierResult?.status, "pass");
  } finally {
    await cleanupAttempt(attemptId);
  }
});
