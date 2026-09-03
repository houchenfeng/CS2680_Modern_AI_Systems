/**
 * Batch evaluation runner: pilot (3/task) and final (10/task).
 * Modes mix oracle (expect pass) and broken (expect fail) so costs include failures.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  computeManifestHash,
  loadManifest,
} from "./manifest.js";
import {
  RESULTS_DIR,
  runAttempt,
  type AttemptMode,
  type CacheStratum,
} from "./runner.js";
import { aggregateSummaries, writeAggregateReport } from "./aggregate.js";

export type BatchPhase = "pilot" | "final";

function planAttempts(
  taskIds: string[],
  phase: BatchPhase,
): Array<{
  taskId: string;
  attemptId: string;
  mode: AttemptMode;
  cacheStratum: CacheStratum;
}> {
  const perTask = phase === "pilot" ? 3 : 10;
  const plans: Array<{
    taskId: string;
    attemptId: string;
    mode: AttemptMode;
    cacheStratum: CacheStratum;
  }> = [];

  for (const taskId of taskIds) {
    for (let i = 1; i <= perTask; i += 1) {
      // Pilot: 2 oracle + 1 broken. Final: 7 oracle + 3 broken.
      const mode: AttemptMode =
        phase === "pilot"
          ? i === 3
            ? "broken"
            : "oracle"
          : i > 7
            ? "broken"
            : "oracle";
      const cacheStratum: CacheStratum = i % 2 === 0 ? "hot" : "cold";
      plans.push({
        taskId,
        attemptId: `${phase}-${taskId}-a${String(i).padStart(2, "0")}`,
        mode,
        cacheStratum,
      });
    }
  }
  return plans;
}

export async function runBatch(phase: BatchPhase, options?: {
  resume?: boolean;
  baselineCommit?: string;
}) {
  const manifest = await loadManifest();
  const manifestHash = computeManifestHash(manifest);
  const baselineCommit =
    options?.baselineCommit ?? "EVAL_BASELINE"; // copy isolation; manifest records real SHA
  const recordedBaseline = "405c3d1d0a9e207eeed35a25d52021c16020ef57";
  const plans = planAttempts(
    manifest.tasks.map((t) => t.id),
    phase,
  );

  const results = [];
  for (const plan of plans) {
    const record = await runAttempt({
      ...plan,
      baselineCommit,
      resume: options?.resume ?? true,
    });
    // Stamp evaluation baseline identity into notes for reproducibility.
    if (!record.notes.some((n) => n.includes("evaluationBaseline"))) {
      record.notes.push(`evaluationBaseline=${recordedBaseline}`);
    }
    results.push({
      attemptId: record.attemptId,
      taskId: record.taskId,
      success: record.success,
      status: record.status,
      mode: record.mode,
      failureClassification: record.failureClassification,
      providerCostUsd: record.providerCostUsd,
    });
    console.log(
      JSON.stringify({
        phase,
        attemptId: record.attemptId,
        success: record.success,
        status: record.status,
      }),
    );
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const indexPath = join(RESULTS_DIR, `${phase}-index.json`);
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        phase,
        manifestHash,
        baselineCommit,
        total: results.length,
        successes: results.filter((r) => r.success === true).length,
        failures: results.filter((r) => r.success === false).length,
        harnessErrors: results.filter((r) => r.status === "error").length,
        results,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const aggregate = await aggregateSummaries(phase);
  const reportPath = await writeAggregateReport(phase, aggregate);
  return { manifestHash, indexPath, reportPath, aggregate, results };
}

async function main() {
  const phase = (process.argv[2] as BatchPhase) || "pilot";
  if (phase !== "pilot" && phase !== "final") {
    throw new Error("Usage: tsx evaluation/batch.ts <pilot|final>");
  }
  const out = await runBatch(phase);
  console.log(JSON.stringify({ done: phase, ...out.aggregate.overall }, null, 2));
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("batch.ts") ||
    process.argv[1].endsWith("batch.js"));
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
