/**
 * Evaluation metrics for Assignment 1.
 *
 * cost_per_completed_task = sum(all attempt costs including failures) / successes
 * Never report 0 for cost/completion when successes === 0 — return undefined.
 */

export function successRate(successes: number, attempts: number): number {
  if (attempts <= 0) {
    throw new Error("attempts must be > 0");
  }
  if (successes < 0 || successes > attempts) {
    throw new Error("successes must be in [0, attempts]");
  }
  return successes / attempts;
}

/**
 * Sum of all attempt costs (including failures) divided by successes.
 * Returns undefined when there are zero successes (do not write 0).
 */
export function costPerCompletedTask(
  costs: number[],
  successes: number,
): number | undefined {
  if (successes <= 0) return undefined;
  const total = costs.reduce((sum, c) => sum + c, 0);
  return total / successes;
}

/** Round a USD cost for human reporting (e.g. $0.42/completion). */
export function roundCostUsd(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface NumericSummary {
  mean: number;
  sampleStddev: number;
  median: number;
  min: number;
  max: number;
  iqr: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    throw new Error("cannot compute quantile of empty array");
  }
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const weight = pos - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

export function summarizeNumeric(values: number[]): NumericSummary {
  if (values.length === 0) {
    throw new Error("summarizeNumeric requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  let sampleStddev = 0;
  if (n >= 2) {
    const ss = sorted.reduce((s, v) => s + (v - mean) ** 2, 0);
    sampleStddev = Math.sqrt(ss / (n - 1));
  }
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    mean,
    sampleStddev,
    median: quantile(sorted, 0.5),
    min: sorted[0]!,
    max: sorted[n - 1]!,
    iqr: q3 - q1,
  };
}

/** Bernoulli variance p(1-p) for a success rate p in [0, 1]. */
export function bernoulliVariance(p: number): number {
  if (p < 0 || p > 1) {
    throw new Error("bernoulliVariance expects p in [0, 1]");
  }
  return p * (1 - p);
}

/** Canonical cost fixture from Assignment1_Evaluation_TODO.md §1.2 */
export const COST_FIXTURE_ATTEMPTS = [
  0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, // 7 successes
  0.55, 0.55, 0.55, // 3 failures
] as const;

export const COST_FIXTURE_SUCCESSES = 7;

export function costFixtureExact(): number {
  return costPerCompletedTask(
    [...COST_FIXTURE_ATTEMPTS],
    COST_FIXTURE_SUCCESSES,
  )!;
}

export function costFixtureRounded(): number {
  return roundCostUsd(costFixtureExact(), 2);
}
