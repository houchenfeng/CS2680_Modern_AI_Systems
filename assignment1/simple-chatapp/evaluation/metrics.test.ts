import assert from "node:assert/strict";
import test from "node:test";
import {
  bernoulliVariance,
  COST_FIXTURE_ATTEMPTS,
  COST_FIXTURE_SUCCESSES,
  costFixtureExact,
  costFixtureRounded,
  costPerCompletedTask,
  successRate,
  summarizeNumeric,
} from "./metrics.js";

test("successRate = successes / attempts", () => {
  assert.equal(successRate(7, 10), 0.7);
  assert.equal(successRate(0, 10), 0);
  assert.equal(successRate(10, 10), 1);
});

test("cost fixture: 7×0.18 + 3×0.55 = 2.91; exact and $0.42/completion", () => {
  const costs = [...COST_FIXTURE_ATTEMPTS];
  assert.equal(costs.length, 10);
  const sum = costs.reduce((a, b) => a + b, 0);
  assert.equal(sum, 2.91);
  const exact = costPerCompletedTask(costs, COST_FIXTURE_SUCCESSES);
  assert.ok(exact !== undefined);
  assert.equal(exact, 2.91 / 7);
  assert.ok(Math.abs(exact! - 0.4157142857142857) < 1e-12);
  assert.equal(costFixtureExact(), exact);
  assert.equal(costFixtureRounded(), 0.42);
});

test("costPerCompletedTask is undefined when successes=0 (never write 0)", () => {
  assert.equal(costPerCompletedTask([0.5, 0.5], 0), undefined);
  assert.equal(costPerCompletedTask([], 0), undefined);
});

test("summarizeNumeric reports mean, sampleStddev, median, min, max, iqr", () => {
  const summary = summarizeNumeric([1, 2, 3, 4, 5]);
  assert.equal(summary.mean, 3);
  assert.equal(summary.median, 3);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 5);
  assert.ok(summary.sampleStddev > 0);
  assert.ok(summary.iqr >= 0);
});

test("bernoulliVariance = p(1-p)", () => {
  assert.ok(Math.abs(bernoulliVariance(0.7) - 0.21) < 1e-12);
  assert.equal(bernoulliVariance(0), 0);
  assert.equal(bernoulliVariance(1), 0);
});
