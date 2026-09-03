import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  bernoulliVariance,
  costPerCompletedTask,
  roundCostUsd,
  successRate,
  summarizeNumeric,
} from "./metrics.js";
import { RESULTS_DIR } from "./runner.js";

function safeSummary(values: number[]) {
  if (!values.length) {
    return {
      mean: 0,
      sampleStddev: 0,
      median: 0,
      min: 0,
      max: 0,
      iqr: 0,
      empty: true as const,
    };
  }
  return summarizeNumeric(values);
}
export interface AttemptSummary {
  taskId: string;
  attemptId: string;
  success: boolean | null;
  status: string;
  cacheStratum?: string;
  providerCostUsd?: number | null;
  normalizedPeakCostUsd?: number | null;
  wallClockMs?: number | null;
  timeToFirstUsefulMs?: number | null;
  turns?: number | null;
  toolErrors?: number | null;
  failureClassification?: string | null;
  mode?: string;
}

export async function loadPhaseSummaries(phase: "pilot" | "final") {
  const names = (await readdir(RESULTS_DIR)).filter(
    (name) => name.startsWith(`${phase}-`) && name.endsWith(".summary.json"),
  );
  const rows: AttemptSummary[] = [];
  for (const name of names) {
    const raw = JSON.parse(
      await readFile(join(RESULTS_DIR, name), "utf8"),
    ) as AttemptSummary;
    rows.push(raw);
  }
  return rows;
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) || [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

export async function aggregateSummaries(phase: "pilot" | "final") {
  const rows = await loadPhaseSummaries(phase);
  const complete = rows.filter(
    (r) => r.status === "complete" || r.status === "skipped",
  );
  const successes = complete.filter((r) => r.success === true).length;
  const attempts = complete.length;
  const costs = complete.map((r) => r.providerCostUsd ?? 0);
  const peakCosts = complete.map((r) => r.normalizedPeakCostUsd ?? 0);
  const failedCosts = complete
    .filter((r) => r.success === false)
    .map((r) => r.providerCostUsd ?? 0);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const failedCostSum = failedCosts.reduce((a, b) => a + b, 0);
  const p = attempts ? successRate(successes, attempts) : 0;
  const costPer =
    costPerCompletedTask(costs, successes) ?? undefined;
  const peakPer =
    costPerCompletedTask(peakCosts, successes) ?? undefined;

  const byTask: Record<string, unknown> = {};
  for (const [taskId, list] of groupBy(complete, (r) => r.taskId)) {
    const s = list.filter((r) => r.success === true).length;
    const taskCosts = list.map((r) => r.providerCostUsd ?? 0);
    byTask[taskId] = {
      attempts: list.length,
      successes: s,
      successRate: list.length ? successRate(s, list.length) : 0,
      costPerCompletion: costPerCompletedTask(taskCosts, s),
      costPerCompletionRounded:
        s > 0
          ? roundCostUsd(costPerCompletedTask(taskCosts, s)!)
          : undefined,
      wall: safeSummary(
        list.map((r) => r.wallClockMs ?? 0).filter((n) => n > 0),
      ),
      ttfu: safeSummary(
        list
          .map((r) => r.timeToFirstUsefulMs)
          .filter((n): n is number => typeof n === "number"),
      ),
      failureClasses: Object.fromEntries(
        [...groupBy(list.filter((r) => !r.success), (r) => r.failureClassification || "none")].map(
          ([k, v]) => [k, v.length],
        ),
      ),
    };
  }

  const byCache: Record<string, unknown> = {};
  for (const [stratum, list] of groupBy(
    complete,
    (r) => r.cacheStratum || "unknown",
  )) {
    const s = list.filter((r) => r.success === true).length;
    byCache[stratum] = {
      attempts: list.length,
      successes: s,
      successRate: list.length ? successRate(s, list.length) : 0,
    };
  }

  const failureDistribution: Record<string, number> = {};
  for (const row of complete.filter((r) => r.success === false)) {
    const key = row.failureClassification || "unknown";
    failureDistribution[key] = (failureDistribution[key] || 0) + 1;
  }

  const caseStudies = complete
    .filter((r) => r.success === false)
    .slice(0, 3)
    .map((r) => ({
      attemptId: r.attemptId,
      taskId: r.taskId,
      classification: r.failureClassification,
      costUsd: r.providerCostUsd,
    }));

  return {
    phase,
    overall: {
      attempts,
      successes,
      successRate: attempts ? p : 0,
      bernoulliVariance: attempts ? bernoulliVariance(p) : 0,
      providerCostPerCompletion: costPer,
      providerCostPerCompletionRounded:
        costPer !== undefined ? roundCostUsd(costPer) : undefined,
      peakCostPerCompletion: peakPer,
      peakCostPerCompletionRounded:
        peakPer !== undefined ? roundCostUsd(peakPer) : undefined,
      failedCostShare: totalCost > 0 ? failedCostSum / totalCost : 0,
      wall: safeSummary(
        complete.map((r) => r.wallClockMs ?? 0).filter((n) => n > 0),
      ),
      ttfu: safeSummary(
        complete
          .map((r) => r.timeToFirstUsefulMs)
          .filter((n): n is number => typeof n === "number"),
      ),
    },
    byTask,
    byCache,
    failureDistribution,
    caseStudies,
  };
}

export async function writeAggregateReport(
  phase: "pilot" | "final",
  aggregate: Awaited<ReturnType<typeof aggregateSummaries>>,
) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${phase}-aggregate.json`);
  await writeFile(path, JSON.stringify(aggregate, null, 2) + "\n", "utf8");
  return path;
}
