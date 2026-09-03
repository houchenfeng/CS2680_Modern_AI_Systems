import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const EVAL_PRICING_VERSION = "deepseek-v4-pro-peak-2026-09-02";
export const EVAL_SCORER_VERSION = "eval-scorer-1.0.0";
export const EVAL_SOURCE_URL =
  "https://api-docs.deepseek.com/quick_start/pricing/";

export interface EvalTask {
  id: string;
  title: string;
  taskVersion: string;
  prompt: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowedTools: string[];
  timeoutMs: number;
  maxTurns: number;
  firstUsefulPredicate: string;
  acceptanceCriteria: string[];
  verifierId: string;
  scorerVersion: string;
  baselineCommit: string;
  pricingVersion: string;
}

export interface EvalManifest {
  manifestVersion: string;
  pricingVersion: string;
  scorerVersion: string;
  baselineCommit: string;
  tasks: EvalTask[];
}

export interface FrozenManifestMeta {
  pricingVersion: string;
  retrievedAt: string;
  effectiveAt: string;
  sourceUrl: string;
  cacheWriteBillingAssumption: "bill_as_miss";
}

export interface FrozenManifest {
  manifest: EvalManifest;
  manifestHash: string;
  meta: FrozenManifestMeta;
}

/** DeepSeek V4 Pro peak pricing freeze metadata (matches server/pricing.ts). */
export function freezeManifestMeta(
  overrides: Partial<FrozenManifestMeta> = {},
): FrozenManifestMeta {
  return {
    pricingVersion: EVAL_PRICING_VERSION,
    retrievedAt: "2026-09-02T00:00:00.000Z",
    effectiveAt: "2026-09-02T00:00:00.000Z",
    sourceUrl: EVAL_SOURCE_URL,
    cacheWriteBillingAssumption: "bill_as_miss",
    ...overrides,
  };
}

/** Recursively sort object keys for stable hashing. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function computeManifestHash(manifest: EvalManifest): string {
  const canonical = JSON.stringify(canonicalize(manifest));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function loadManifest(
  manifestPath = join(__dirname, "tasks-v1.json"),
): Promise<EvalManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as EvalManifest;
  if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
    throw new Error("Invalid manifest: missing tasks array");
  }
  if (parsed.tasks.length !== 10) {
    throw new Error(
      `Expected 10 tasks in manifest, found ${parsed.tasks.length}`,
    );
  }
  return parsed;
}

export async function freezeManifest(
  manifestPath?: string,
): Promise<FrozenManifest> {
  const manifest = await loadManifest(manifestPath);
  return {
    manifest,
    manifestHash: computeManifestHash(manifest),
    meta: freezeManifestMeta({
      pricingVersion: manifest.pricingVersion || EVAL_PRICING_VERSION,
    }),
  };
}

export function getTask(manifest: EvalManifest, taskId: string): EvalTask {
  const task = manifest.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Unknown task id: ${taskId}`);
  }
  return task;
}
