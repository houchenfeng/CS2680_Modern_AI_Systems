import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCallTiming,
  computeNormalizedPeakCost,
  DEEPSEEK_V4_PRO_PEAK,
  orchestrationGapMs,
  parallelToolCriticalPathMs,
  resolvePricingConfig,
} from "./pricing.js";
import type { CallUsage } from "./events.js";

test("normalized peak cost matches DeepSeek V4 Pro formula", () => {
  const usage: CallUsage = {
    uncachedInputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    logicalInputTokens: 2_000_000,
    outputTokens: 1_000_000,
    measurement: "reported",
  };
  const cost = computeNormalizedPeakCost(usage);
  assert.equal(cost, 0.044 + 1.32 + 3.96);
  assert.equal(
    DEEPSEEK_V4_PRO_PEAK.cacheWriteBillingAssumption,
    "bill_as_miss",
  );
});

test("cache-write is billed as miss when no independent rate", () => {
  const usage: CallUsage = {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 1_000_000,
    logicalInputTokens: 1_000_000,
    outputTokens: 0,
    measurement: "reported",
  };
  assert.equal(computeNormalizedPeakCost(usage), 1.32);
});

test("missing usage fields yield null cost", () => {
  assert.equal(computeNormalizedPeakCost(null), null);
  assert.equal(
    computeNormalizedPeakCost({
      uncachedInputTokens: 10,
      cacheReadTokens: null,
      cacheWriteTokens: 0,
      logicalInputTokens: null,
      outputTokens: 1,
      measurement: "reported",
    }),
    null,
  );
});

test("resolvePricingConfig matches model alias", () => {
  assert.equal(
    resolvePricingConfig("deepseek-v4-pro-0813").resolvedVersion,
    "deepseek-v4-pro-0813",
  );
});

test("call timing derives queue/TTFB/wall-clock", () => {
  const timing = computeCallTiming({
    queuedAt: "2026-09-02T00:00:00.000Z",
    sentAt: "2026-09-02T00:00:00.100Z",
    firstByteAt: "2026-09-02T00:00:00.250Z",
    firstVisibleOutputAt: "2026-09-02T00:00:00.300Z",
    firstUsefulOutputAt: "2026-09-02T00:00:00.400Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    durationApiMs: 800,
  });
  assert.equal(timing.queueMs, 100);
  assert.equal(timing.ttfbMs, 150);
  assert.equal(timing.timeToFirstVisibleMs, 200);
  assert.equal(timing.timeToFirstUsefulMs, 300);
  assert.equal(timing.wallClockMs, 1000);
  assert.equal(timing.durationApiMs, 800);
});

test("parallel tools use critical path not sum", () => {
  const duration = parallelToolCriticalPathMs([
    {
      startedAt: "2026-09-02T00:00:00.000Z",
      endedAt: "2026-09-02T00:00:00.400Z",
    },
    {
      startedAt: "2026-09-02T00:00:00.100Z",
      endedAt: "2026-09-02T00:00:00.500Z",
    },
  ]);
  assert.equal(duration, 500);
});

test("orchestration gap is unavailable without proven dependency", () => {
  assert.equal(
    orchestrationGapMs({
      previousCompletedAt: "2026-09-02T00:00:01.000Z",
      nextSentAt: "2026-09-02T00:00:01.200Z",
      dependencyKnown: false,
    }),
    "unavailable",
  );
  assert.equal(
    orchestrationGapMs({
      previousCompletedAt: "2026-09-02T00:00:01.000Z",
      nextSentAt: "2026-09-02T00:00:01.200Z",
      dependencyKnown: true,
    }),
    200,
  );
});
