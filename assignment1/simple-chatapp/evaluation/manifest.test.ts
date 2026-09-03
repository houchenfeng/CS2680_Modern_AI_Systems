import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalize,
  computeManifestHash,
  freezeManifest,
  freezeManifestMeta,
  loadManifest,
} from "./manifest.js";
import {
  COST_FIXTURE_ATTEMPTS,
  COST_FIXTURE_SUCCESSES,
  costFixtureExact,
  costFixtureRounded,
  costPerCompletedTask,
} from "./metrics.js";

test("cost formula: sum 2.91 / 7 successes → exact and $0.42", () => {
  const exact = costPerCompletedTask(
    [...COST_FIXTURE_ATTEMPTS],
    COST_FIXTURE_SUCCESSES,
  );
  assert.equal(exact, 2.91 / 7);
  assert.equal(costFixtureExact(), exact);
  assert.equal(costFixtureRounded(), 0.42);
  assert.equal(costPerCompletedTask([1, 2], 0), undefined);
});

test("manifest hash is stable across loads", async () => {
  const a = await loadManifest();
  const b = await loadManifest();
  assert.equal(computeManifestHash(a), computeManifestHash(b));
  assert.equal(computeManifestHash(a).length, 64);
});

test("canonicalize sorts keys for stable hashing", () => {
  const h1 = computeManifestHash({
    manifestVersion: "1.0.0",
    pricingVersion: "x",
    scorerVersion: "y",
    baselineCommit: "z",
    tasks: [],
  } as never);
  const h2 = computeManifestHash({
    baselineCommit: "z",
    tasks: [],
    scorerVersion: "y",
    pricingVersion: "x",
    manifestVersion: "1.0.0",
  } as never);
  assert.equal(h1, h2);
  assert.deepEqual(canonicalize({ b: 1, a: 2 }), { a: 2, b: 1 });
});

test("freezeManifest includes pricing metadata bill_as_miss", async () => {
  const frozen = await freezeManifest();
  assert.equal(frozen.manifest.tasks.length, 10);
  assert.match(frozen.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(frozen.meta.cacheWriteBillingAssumption, "bill_as_miss");
  assert.equal(
    freezeManifestMeta().sourceUrl,
    "https://api-docs.deepseek.com/quick_start/pricing/",
  );
  assert.equal(frozen.meta.pricingVersion, frozen.manifest.pricingVersion);
});
