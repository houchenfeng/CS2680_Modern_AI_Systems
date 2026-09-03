import { createHash, randomUUID } from "node:crypto";

export interface TaskSpecBudget {
  maxTurns?: number;
  maxTokens?: number;
  maxDollars?: number;
  maxWallMs?: number;
}

export interface TaskSpecSnapshot {
  taskId: string;
  version: number;
  prompt: string;
  acceptanceCriteria: string[];
  outOfScope: string[];
  allowedTools: string[];
  budget: TaskSpecBudget;
  doneCondition: string;
  verifierVersion: string;
  scorerVersion: string;
  createdAt: string;
  specHash: string;
}

export interface SpecificationClarityDiagnosis {
  explicitRequirements: string[];
  hiddenIntent: string[];
  ambiguities: string[];
  reasonableInterpretations: string[];
  professionalExecutorJudgment: {
    uniquelyDetermined: boolean;
    expectedBehavior?: string;
    notes: string;
  };
  classificationHint?: "specification_failure" | "pass";
}

interface MutableDraft {
  taskId: string;
  version: number;
  prompt: string;
  acceptanceCriteria: string[];
  outOfScope: string[];
  allowedTools: string[];
  budget: TaskSpecBudget;
  doneCondition: string;
  verifierVersion: string;
  scorerVersion: string;
}

const registry = new Map<string, TaskSpecSnapshot[]>();

function computeSpecHash(
  fields: Omit<TaskSpecSnapshot, "specHash" | "createdAt"> & {
    createdAt?: string;
  },
) {
  const payload = {
    taskId: fields.taskId,
    version: fields.version,
    prompt: fields.prompt,
    acceptanceCriteria: fields.acceptanceCriteria,
    outOfScope: fields.outOfScope,
    allowedTools: fields.allowedTools,
    budget: fields.budget,
    doneCondition: fields.doneCondition,
    verifierVersion: fields.verifierVersion,
    scorerVersion: fields.scorerVersion,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child as object);
    }
  }
  return value;
}

export function freezeSpec(input: {
  taskId?: string;
  prompt: string;
  acceptanceCriteria: string[];
  outOfScope?: string[];
  allowedTools?: string[];
  budget?: TaskSpecBudget;
  doneCondition: string;
  verifierVersion?: string;
  scorerVersion?: string;
  version?: number;
}): TaskSpecSnapshot {
  const taskId = input.taskId ?? `task-${randomUUID()}`;
  const version = input.version ?? 1;
  const existing = registry.get(taskId) ?? [];
  const sameVersion = existing.find((s) => s.version === version);
  if (sameVersion) {
    throw new Error(
      `TaskSpec version ${version} for ${taskId} is immutable; use reviseSpec() to publish a new version`,
    );
  }

  const createdAt = new Date().toISOString();
  const base = {
    taskId,
    version,
    prompt: input.prompt,
    acceptanceCriteria: [...input.acceptanceCriteria],
    outOfScope: [...(input.outOfScope ?? [])],
    allowedTools: [...(input.allowedTools ?? [])],
    budget: { ...(input.budget ?? {}) },
    doneCondition: input.doneCondition,
    verifierVersion: input.verifierVersion ?? "verifier-1",
    scorerVersion: input.scorerVersion ?? "scorer-1",
    createdAt,
  };
  const snapshot: TaskSpecSnapshot = deepFreeze({
    ...base,
    specHash: computeSpecHash(base),
  });

  existing.push(snapshot);
  registry.set(taskId, existing);
  return snapshot;
}

export function reviseSpec(
  previous: TaskSpecSnapshot,
  patch: Partial<
    Pick<
      MutableDraft,
      | "prompt"
      | "acceptanceCriteria"
      | "outOfScope"
      | "allowedTools"
      | "budget"
      | "doneCondition"
      | "verifierVersion"
      | "scorerVersion"
    >
  >,
): TaskSpecSnapshot {
  const versions = registry.get(previous.taskId) ?? [previous];
  const nextVersion = Math.max(...versions.map((v) => v.version)) + 1;
  return freezeSpec({
    taskId: previous.taskId,
    version: nextVersion,
    prompt: patch.prompt ?? previous.prompt,
    acceptanceCriteria: patch.acceptanceCriteria ?? [
      ...previous.acceptanceCriteria,
    ],
    outOfScope: patch.outOfScope ?? [...previous.outOfScope],
    allowedTools: patch.allowedTools ?? [...previous.allowedTools],
    budget: patch.budget ?? { ...previous.budget },
    doneCondition: patch.doneCondition ?? previous.doneCondition,
    verifierVersion: patch.verifierVersion ?? previous.verifierVersion,
    scorerVersion: patch.scorerVersion ?? previous.scorerVersion,
  });
}

export function getSpecVersions(taskId: string): TaskSpecSnapshot[] {
  return [...(registry.get(taskId) ?? [])];
}

export function clearSpecRegistry() {
  registry.clear();
}

/**
 * Diagnose whether a professional human executor with only the written
 * specification (without seeing the agent answer) would uniquely determine
 * the intended behavior.
 */
export function diagnoseSpecificationClarity(
  spec: TaskSpecSnapshot,
  options?: {
    /** Optional analyst notes — must NOT include the agent final answer. */
    analystNotes?: string;
  },
): SpecificationClarityDiagnosis {
  const explicitRequirements = [
    ...spec.acceptanceCriteria,
    `Done when: ${spec.doneCondition}`,
  ];
  if (spec.allowedTools.length) {
    explicitRequirements.push(`Allowed tools: ${spec.allowedTools.join(", ")}`);
  }
  if (spec.outOfScope.length) {
    explicitRequirements.push(
      ...spec.outOfScope.map((item) => `Out of scope: ${item}`),
    );
  }

  const ambiguities: string[] = [];
  const hiddenIntent: string[] = [];
  const reasonableInterpretations: string[] = [];

  const vague =
    /\b(improve|fix|handle|appropriate|correctly|properly|etc\.?|as needed|make it better)\b/i;
  const underspecifiedDone =
    !spec.doneCondition.trim() ||
    /^(done|finished|ok|complete)\.?$/i.test(spec.doneCondition.trim());

  if (vague.test(spec.prompt)) {
    ambiguities.push(
      "Prompt contains vague success language without measurable criteria",
    );
  }
  if (spec.acceptanceCriteria.length < 1) {
    ambiguities.push("No acceptance criteria listed");
  }
  if (underspecifiedDone) {
    ambiguities.push("Done condition is underspecified");
  }
  if (
    /optional|either|or\b|whichever|you (may|can|could)/i.test(spec.prompt) &&
    spec.acceptanceCriteria.length < 2
  ) {
    ambiguities.push(
      "Prompt permits multiple implementation choices without ranking",
    );
  }

  // Hidden intent heuristics (stated nowhere as hard requirements)
  if (
    /tests?/i.test(spec.prompt) &&
    !spec.acceptanceCriteria.some((c) => /test/i.test(c))
  ) {
    hiddenIntent.push(
      "Testing may be expected but is not an acceptance criterion",
    );
  }
  if (
    /refactor|clean/i.test(spec.prompt) &&
    !spec.acceptanceCriteria.some((c) => /behavior|compat|preserve/i.test(c))
  ) {
    hiddenIntent.push(
      "Behavioral preservation during refactor is implied but unstated",
    );
  }
  if (options?.analystNotes) {
    // Notes may call out hidden intent; still must not contain agent answer.
    if (/agent\s+(said|answered|output|final)/i.test(options.analystNotes)) {
      throw new Error(
        "professionalExecutorJudgment must not see the agent answer; remove agent output from analystNotes",
      );
    }
  }

  // Always produce at least two reasonable interpretations when ambiguous,
  // and still list two contrasting readings for clear specs (literal vs stretch).
  const primary = `Literal: satisfy [${spec.acceptanceCriteria.join("; ") || spec.prompt.slice(0, 80)}] and stop at "${spec.doneCondition}"`;
  const alternate =
    ambiguities.length > 0
      ? `Alternate: interpret vague prompt language broadly (${spec.prompt.slice(0, 100)}…) beyond listed criteria`
      : `Conservative: only perform explicitly listed criteria and leave unspecified polish undone`;
  reasonableInterpretations.push(primary, alternate);

  if (ambiguities.length > 0 || hiddenIntent.length > 0) {
    // Extra interpretation when underspecified
    if (reasonableInterpretations.length < 2) {
      reasonableInterpretations.push(
        "Minimal viable change vs full rewrite of related modules",
      );
    }
  }

  const uniquelyDetermined =
    ambiguities.length === 0 &&
    hiddenIntent.length === 0 &&
    spec.acceptanceCriteria.length > 0 &&
    Boolean(spec.doneCondition.trim());

  const diagnosis: SpecificationClarityDiagnosis = {
    explicitRequirements,
    hiddenIntent,
    ambiguities,
    reasonableInterpretations,
    professionalExecutorJudgment: {
      uniquelyDetermined,
      expectedBehavior: uniquelyDetermined
        ? `Execute only what acceptance criteria require; done when ${spec.doneCondition}`
        : undefined,
      notes:
        options?.analystNotes ??
        (uniquelyDetermined
          ? "A professional executor would uniquely determine the intended behavior from the written spec alone."
          : "A professional executor could reasonably take more than one path from the written text alone."),
    },
    classificationHint: uniquelyDetermined ? "pass" : "specification_failure",
  };

  return diagnosis;
}
