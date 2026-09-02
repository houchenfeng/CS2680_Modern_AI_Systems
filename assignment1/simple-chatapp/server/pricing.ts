import type { CallUsage } from "./events.js";

export interface PricingRates {
  cacheHitInputPerMillion: number;
  cacheMissInputPerMillion: number;
  outputPerMillion: number;
}

export interface PricingConfig {
  modelAlias: string;
  resolvedVersion: string;
  effectiveAt: string;
  retrievedAt: string;
  tier: "peak" | "off_peak";
  currency: "USD";
  rates: PricingRates;
  sourceUrl: string;
  /**
   * Cache-write has no independent rate in DeepSeek V4 Pro peak pricing.
   * Assumption: bill cache-write as cache-miss (uncached).
   */
  cacheWriteBillingAssumption: "bill_as_miss";
}

/** DeepSeek V4 Pro peak rates as of 2026-09-02. */
export const DEEPSEEK_V4_PRO_PEAK: PricingConfig = {
  modelAlias: "deepseek-v4-pro",
  resolvedVersion: "deepseek-v4-pro-0813",
  effectiveAt: "2026-09-02T00:00:00.000Z",
  retrievedAt: "2026-09-02T00:00:00.000Z",
  tier: "peak",
  currency: "USD",
  rates: {
    cacheHitInputPerMillion: 0.044,
    cacheMissInputPerMillion: 1.32,
    outputPerMillion: 3.96,
  },
  sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
  cacheWriteBillingAssumption: "bill_as_miss",
};

export const PRICING_CONFIGS: PricingConfig[] = [DEEPSEEK_V4_PRO_PEAK];

export function resolvePricingConfig(model?: string): PricingConfig {
  if (!model) return DEEPSEEK_V4_PRO_PEAK;
  const normalized = model.toLowerCase();
  return (
    PRICING_CONFIGS.find(
      (config) =>
        normalized.includes(config.modelAlias) ||
        normalized.includes(config.resolvedVersion),
    ) || DEEPSEEK_V4_PRO_PEAK
  );
}

/**
 * normalizedPeakCostUsd =
 *   cacheRead × 0.044 / 1e6
 * + (uncached + cacheWrite) × 1.32 / 1e6
 * + output × 3.96 / 1e6
 *
 * Returns null when any required usage field is missing.
 */
export function computeNormalizedPeakCost(
  usage?: CallUsage | null,
  config: PricingConfig = DEEPSEEK_V4_PRO_PEAK,
): number | null {
  if (!usage) return null;
  const {
    uncachedInputTokens: uncached,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
  } = usage;
  if (
    uncached === null ||
    cacheRead === null ||
    cacheWrite === null ||
    output === null
  ) {
    return null;
  }
  const { rates } = config;
  return (
    (cacheRead * rates.cacheHitInputPerMillion) / 1e6 +
    ((uncached + cacheWrite) * rates.cacheMissInputPerMillion) / 1e6 +
    (output * rates.outputPerMillion) / 1e6
  );
}

export interface CallTiming {
  queuedAt?: string;
  sentAt?: string;
  firstByteAt?: string;
  firstVisibleOutputAt?: string;
  firstUsefulOutputAt?: string;
  completedAt?: string;
  wallClockMs?: number | null;
  queueMs?: number | null;
  ttfbMs?: number | null;
  timeToFirstVisibleMs?: number | null;
  timeToFirstUsefulMs?: number | null;
  durationApiMs?: number | null;
}

function deltaMs(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

export function computeCallTiming(input: {
  queuedAt?: string;
  sentAt?: string;
  firstByteAt?: string;
  firstVisibleOutputAt?: string;
  firstUsefulOutputAt?: string;
  completedAt?: string;
  durationApiMs?: number | null;
}): CallTiming {
  return {
    ...input,
    wallClockMs: deltaMs(input.queuedAt, input.completedAt),
    queueMs: deltaMs(input.queuedAt, input.sentAt),
    ttfbMs: deltaMs(input.sentAt, input.firstByteAt),
    timeToFirstVisibleMs: deltaMs(input.sentAt, input.firstVisibleOutputAt),
    timeToFirstUsefulMs: deltaMs(input.sentAt, input.firstUsefulOutputAt),
    durationApiMs:
      input.durationApiMs === undefined ? null : input.durationApiMs,
  };
}

/**
 * Critical-path duration for parallel tools: max(end) - min(start).
 * Returns null when any tool lacks both timestamps.
 */
export function parallelToolCriticalPathMs(
  tools: Array<{ startedAt?: string; endedAt?: string }>,
): number | null {
  if (!tools.length) return null;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const tool of tools) {
    if (!tool.startedAt || !tool.endedAt) return null;
    minStart = Math.min(minStart, Date.parse(tool.startedAt));
    maxEnd = Math.max(maxEnd, Date.parse(tool.endedAt));
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;
  return maxEnd - minStart;
}

/**
 * Orchestration gap between dependent calls. Unavailable when dependency
 * cannot be proven from parentCallId / tool chain.
 */
export function orchestrationGapMs(input: {
  previousCompletedAt?: string;
  nextSentAt?: string;
  dependencyKnown: boolean;
}): number | null | "unavailable" {
  if (!input.dependencyKnown) return "unavailable";
  return deltaMs(input.previousCompletedAt, input.nextSentAt);
}
