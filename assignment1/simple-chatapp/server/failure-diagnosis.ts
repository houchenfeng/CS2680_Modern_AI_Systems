import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolReplayResult } from "./tool-replay.js";
import type { ContextDiffResult } from "./context-diff.js";
import type {
  SpecificationClarityDiagnosis,
  TaskSpecSnapshot,
} from "./task-spec.js";

export interface FailureDiagnosis {
  diagnosisId: string;
  taskId: string;
  attemptId: string;
  terminalFailureEventId: string;
  symptom: string;
  impact: string;
  toolCheck: {
    status: "pass" | "fail" | "not_applicable";
    evidenceRefs: string[];
    conclusion: string;
  };
  contextCheck: {
    status: "pass" | "fail" | "not_reached";
    designedRef: string;
    sentRef: string;
    diffRef: string;
    conclusion: string;
  };
  specificationCheck: {
    status: "pass" | "fail" | "not_reached";
    specHash: string;
    humanContractorAnswer: string;
    conclusion: string;
  };
  modelCheck: {
    status: "pass" | "fail" | "not_reached";
    callIds: string[];
    conclusion: string;
  };
  classification:
    "tool" | "harness" | "specification" | "model" | "inconclusive";
  confidence: "high" | "medium" | "low";
  evidenceRefs: string[];
  revision?: number;
  revisedFrom?: string;
  createdAt?: string;
}

export interface DiagnosisRevision {
  revisionId: string;
  diagnosisId: string;
  previousClassification: FailureDiagnosis["classification"];
  newClassification: FailureDiagnosis["classification"];
  at: string;
  addedEvidenceRefs: string[];
  note?: string;
  snapshot: FailureDiagnosis;
}

function diagnosesRoot() {
  return path.resolve(
    process.env.DIAGNOSES_ROOT || path.join(process.cwd(), "data", "diagnoses"),
  );
}

function diagnosesPath(taskId: string) {
  return path.join(diagnosesRoot(), `${taskId}.jsonl`);
}

async function appendDiagnosisRecord(
  taskId: string,
  record: FailureDiagnosis | DiagnosisRevision,
) {
  const file = diagnosesPath(taskId);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Enforce Tool → Harness → Spec → Model order.
 * Tool fail → context/spec/model not_reached (model always not_reached on earlier fail).
 * Model only if all three pass.
 * No evidenceRefs → inconclusive.
 */
export function createDiagnosis(input: {
  taskId: string;
  attemptId: string;
  terminalFailureEventId: string;
  symptom: string;
  impact: string;
  toolCheck: FailureDiagnosis["toolCheck"];
  contextCheck?: Partial<FailureDiagnosis["contextCheck"]> & {
    status: "pass" | "fail" | "not_reached";
  };
  specificationCheck?: Partial<FailureDiagnosis["specificationCheck"]> & {
    status: "pass" | "fail" | "not_reached";
  };
  modelCheck?: Partial<FailureDiagnosis["modelCheck"]> & {
    status: "pass" | "fail" | "not_reached";
  };
  evidenceRefs?: string[];
  confidence?: FailureDiagnosis["confidence"];
  classification?: FailureDiagnosis["classification"];
}): FailureDiagnosis {
  const evidenceRefs = [...(input.evidenceRefs ?? [])];

  const toolCheck = { ...input.toolCheck };
  let contextCheck: FailureDiagnosis["contextCheck"] = {
    status: input.contextCheck?.status ?? "not_reached",
    designedRef: input.contextCheck?.designedRef ?? "",
    sentRef: input.contextCheck?.sentRef ?? "",
    diffRef: input.contextCheck?.diffRef ?? "",
    conclusion: input.contextCheck?.conclusion ?? "not_reached",
  };
  let specificationCheck: FailureDiagnosis["specificationCheck"] = {
    status: input.specificationCheck?.status ?? "not_reached",
    specHash: input.specificationCheck?.specHash ?? "",
    humanContractorAnswer:
      input.specificationCheck?.humanContractorAnswer ?? "",
    conclusion: input.specificationCheck?.conclusion ?? "not_reached",
  };
  let modelCheck: FailureDiagnosis["modelCheck"] = {
    status: "not_reached",
    callIds: input.modelCheck?.callIds ?? [],
    conclusion: "not_reached",
  };

  // Order enforcement
  if (toolCheck.status === "fail") {
    contextCheck = {
      ...contextCheck,
      status: "not_reached",
      conclusion: "not_reached (tool failure stops cascade)",
    };
    specificationCheck = {
      ...specificationCheck,
      status: "not_reached",
      conclusion: "not_reached (tool failure stops cascade)",
    };
    modelCheck = {
      status: "not_reached",
      callIds: [],
      conclusion: "not_reached (tool failure stops cascade)",
    };
  } else if (contextCheck.status === "fail") {
    specificationCheck = {
      ...specificationCheck,
      status: "not_reached",
      conclusion: "not_reached (harness failure stops cascade)",
    };
    modelCheck = {
      status: "not_reached",
      callIds: [],
      conclusion: "not_reached (harness failure stops cascade)",
    };
  } else if (specificationCheck.status === "fail") {
    modelCheck = {
      status: "not_reached",
      callIds: [],
      conclusion: "not_reached (specification failure stops cascade)",
    };
  } else if (
    toolCheck.status === "pass" &&
    contextCheck.status === "pass" &&
    specificationCheck.status === "pass"
  ) {
    modelCheck = {
      status: input.modelCheck?.status ?? "pass",
      callIds: input.modelCheck?.callIds ?? [],
      conclusion: input.modelCheck?.conclusion ?? "model reached",
    };
  } else {
    modelCheck = {
      status: "not_reached",
      callIds: [],
      conclusion: "not_reached (prior checks incomplete)",
    };
  }

  let classification: FailureDiagnosis["classification"] =
    input.classification ?? "inconclusive";

  if (evidenceRefs.length === 0) {
    classification = "inconclusive";
  } else if (!input.classification) {
    if (toolCheck.status === "fail") classification = "tool";
    else if (contextCheck.status === "fail") classification = "harness";
    else if (specificationCheck.status === "fail")
      classification = "specification";
    else if (modelCheck.status === "fail") classification = "model";
    else if (
      toolCheck.status === "pass" &&
      contextCheck.status === "pass" &&
      specificationCheck.status === "pass" &&
      modelCheck.status === "pass"
    ) {
      classification = "inconclusive";
    } else classification = "inconclusive";
  }

  // Model classification only allowed when prior three pass
  if (
    classification === "model" &&
    !(
      toolCheck.status === "pass" &&
      contextCheck.status === "pass" &&
      specificationCheck.status === "pass"
    )
  ) {
    classification = "inconclusive";
    modelCheck = {
      status: "not_reached",
      callIds: [],
      conclusion:
        "model classification rejected: prior checks did not all pass",
    };
  }

  const diagnosis: FailureDiagnosis = {
    diagnosisId: `diag-${randomUUID()}`,
    taskId: input.taskId,
    attemptId: input.attemptId,
    terminalFailureEventId: input.terminalFailureEventId,
    symptom: input.symptom,
    impact: input.impact,
    toolCheck,
    contextCheck,
    specificationCheck,
    modelCheck,
    classification,
    confidence: input.confidence ?? (evidenceRefs.length ? "medium" : "low"),
    evidenceRefs,
    revision: 0,
    createdAt: new Date().toISOString(),
  };

  return diagnosis;
}

export async function persistDiagnosis(
  diagnosis: FailureDiagnosis,
): Promise<FailureDiagnosis> {
  await appendDiagnosisRecord(diagnosis.taskId, diagnosis);
  return diagnosis;
}

/** Append-only revision: keeps old classification, timestamps, and new evidence. */
export async function reviseDiagnosis(
  previous: FailureDiagnosis,
  patch: {
    classification?: FailureDiagnosis["classification"];
    confidence?: FailureDiagnosis["confidence"];
    addedEvidenceRefs?: string[];
    toolCheck?: FailureDiagnosis["toolCheck"];
    contextCheck?: FailureDiagnosis["contextCheck"];
    specificationCheck?: FailureDiagnosis["specificationCheck"];
    modelCheck?: FailureDiagnosis["modelCheck"];
    note?: string;
  },
): Promise<FailureDiagnosis> {
  const evidenceRefs = [
    ...previous.evidenceRefs,
    ...(patch.addedEvidenceRefs ?? []),
  ];
  const draft = createDiagnosis({
    taskId: previous.taskId,
    attemptId: previous.attemptId,
    terminalFailureEventId: previous.terminalFailureEventId,
    symptom: previous.symptom,
    impact: previous.impact,
    toolCheck: patch.toolCheck ?? previous.toolCheck,
    contextCheck: patch.contextCheck ?? previous.contextCheck,
    specificationCheck: patch.specificationCheck ?? previous.specificationCheck,
    modelCheck: patch.modelCheck ?? previous.modelCheck,
    evidenceRefs,
    confidence: patch.confidence ?? previous.confidence,
    classification: patch.classification ?? previous.classification,
  });

  const revised: FailureDiagnosis = {
    ...draft,
    diagnosisId: previous.diagnosisId,
    revision: (previous.revision ?? 0) + 1,
    revisedFrom: previous.createdAt,
    createdAt: new Date().toISOString(),
  };

  const revisionRecord: DiagnosisRevision = {
    revisionId: `rev-${randomUUID()}`,
    diagnosisId: previous.diagnosisId,
    previousClassification: previous.classification,
    newClassification: revised.classification,
    at: revised.createdAt!,
    addedEvidenceRefs: patch.addedEvidenceRefs ?? [],
    note: patch.note,
    snapshot: revised,
  };

  await appendDiagnosisRecord(previous.taskId, revisionRecord);
  return revised;
}

export async function listDiagnoses(taskId: string): Promise<unknown[]> {
  try {
    const raw = await readFile(diagnosesPath(taskId), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** Build diagnosis from replay + context + spec artifacts. */
export function diagnoseFromArtifacts(input: {
  taskId: string;
  attemptId: string;
  terminalFailureEventId: string;
  symptom: string;
  impact: string;
  replay?: ToolReplayResult;
  contextDiff?: ContextDiffResult;
  spec?: TaskSpecSnapshot;
  clarity?: SpecificationClarityDiagnosis;
  modelFail?: { callIds: string[]; conclusion: string };
  evidenceRefs: string[];
}): FailureDiagnosis {
  const toolFail =
    input.replay?.classificationHint === "tool_failure" ||
    input.replay?.status === "mismatch";
  const toolInconclusive =
    input.replay?.classificationHint === "inconclusive" ||
    input.replay?.status === "replay_failed";
  const harnessFail = input.contextDiff?.status === "fail";
  const specFail =
    input.clarity?.classificationHint === "specification_failure";

  return createDiagnosis({
    taskId: input.taskId,
    attemptId: input.attemptId,
    terminalFailureEventId: input.terminalFailureEventId,
    symptom: input.symptom,
    impact: input.impact,
    evidenceRefs: input.evidenceRefs,
    toolCheck: {
      status: toolInconclusive ? "not_applicable" : toolFail ? "fail" : "pass",
      evidenceRefs: input.replay?.evidenceSha256
        ? [input.replay.evidenceSha256]
        : [],
      conclusion: toolFail
        ? "Replay/ground truth mismatch"
        : toolInconclusive
          ? "Replay failed; inconclusive"
          : "Replay matched ground truth",
    },
    contextCheck: {
      status: toolFail ? "not_reached" : harnessFail ? "fail" : "pass",
      designedRef: input.contextDiff?.designedRef ?? "",
      sentRef: input.contextDiff?.sentRef ?? "",
      diffRef: input.contextDiff?.diffs[0]?.kind ?? "",
      conclusion: harnessFail
        ? `Context integrity fail: ${input.contextDiff?.diffs.map((d) => d.kind).join(",")}`
        : "Designed vs sent consistent",
    },
    specificationCheck: {
      status:
        toolFail || harnessFail ? "not_reached" : specFail ? "fail" : "pass",
      specHash: input.spec?.specHash ?? "",
      humanContractorAnswer: input.clarity
        ? input.clarity.professionalExecutorJudgment.uniquelyDetermined
          ? "uniquely determined"
          : "not uniquely determined"
        : "",
      conclusion: specFail
        ? "Specification not uniquely actionable"
        : "Specification clear to professional executor",
    },
    modelCheck: input.modelFail
      ? {
          status: "fail",
          callIds: input.modelFail.callIds,
          conclusion: input.modelFail.conclusion,
        }
      : { status: "pass", callIds: [], conclusion: "no model fault asserted" },
    confidence: toolInconclusive ? "low" : "high",
  });
}

/**
 * Historical Read error / max-turns loop.
 * Prefer harness when fragment usage conflicts / observability issues
 * (agent kept re-reading without progress until max turns).
 */
export function classifyReadMaxTurnsLoop(input?: {
  taskId?: string;
  attemptId?: string;
  evidenceRefs?: string[];
}): FailureDiagnosis {
  const evidenceRefs = input?.evidenceRefs ?? [
    "ev-read-loop-tool-errors",
    "ev-read-loop-max-turns",
    "ev-read-loop-context-fragments",
    "ev-read-loop-usage-conflict",
  ];
  return createDiagnosis({
    taskId: input?.taskId ?? "task-read-max-turns",
    attemptId: input?.attemptId ?? "attempt-read-loop-1",
    terminalFailureEventId: "evt-error-max-turns",
    symptom:
      "Agent repeatedly invoked Read on the same paths, surfaced tool errors / empty fragments, and terminated with error_max_turns",
    impact:
      "Run exhausted turn budget without completing the user task; observability showed conflicting fragment usage vs terminal max-turns",
    evidenceRefs,
    confidence: "high",
    classification: "harness",
    toolCheck: {
      status: "pass",
      evidenceRefs: ["ev-read-loop-tool-errors"],
      conclusion:
        "Individual Read replays were consistent with filesystem ground truth; tool layer did not fabricate contents",
    },
    contextCheck: {
      status: "fail",
      designedRef: "designed-read-loop",
      sentRef: "sent-read-loop",
      diffRef: "ev-read-loop-context-fragments",
      conclusion:
        "Harness/observability failure: repeated Read results and usage fragments conflicted with progress accounting, producing a non-terminating loop until max turns",
    },
    specificationCheck: {
      status: "not_reached",
      specHash: "",
      humanContractorAnswer: "",
      conclusion: "not_reached (harness failure stops cascade)",
    },
    modelCheck: {
      status: "not_reached",
      callIds: [],
      conclusion: "not_reached (harness failure stops cascade)",
    },
  });
}

/** Fixture factory for the four required trajectories. */
export function buildTrajectoryFixtures(): {
  tool: FailureDiagnosis;
  harness: FailureDiagnosis;
  specification: FailureDiagnosis;
  model: FailureDiagnosis;
} {
  const tool = createDiagnosis({
    taskId: "fixture-tool",
    attemptId: "attempt-tool-1",
    terminalFailureEventId: "evt-tool-mismatch",
    symptom:
      "Write reported success but file hash differed on independent replay",
    impact: "Agent continued as if file were correct",
    evidenceRefs: ["ev-tool-original", "ev-tool-replay-diff"],
    confidence: "high",
    toolCheck: {
      status: "fail",
      evidenceRefs: ["ev-tool-replay-diff"],
      conclusion: "Replay/ground truth mismatch → tool_failure",
    },
  });

  const harness = createDiagnosis({
    taskId: "fixture-harness",
    attemptId: "attempt-harness-1",
    terminalFailureEventId: "evt-context-missing",
    symptom: "Sent transcript omitted designed constraint / retrieval block",
    impact: "Model never saw required constraint",
    evidenceRefs: ["ev-designed", "ev-sent", "ev-diff-missing"],
    confidence: "high",
    toolCheck: {
      status: "pass",
      evidenceRefs: ["ev-tool-replay-ok"],
      conclusion: "Tool replay matched",
    },
    contextCheck: {
      status: "fail",
      designedRef: "ev-designed",
      sentRef: "ev-sent",
      diffRef: "ev-diff-missing",
      conclusion: "missing designed constraint in sent context",
    },
  });

  const specification = createDiagnosis({
    taskId: "fixture-spec",
    attemptId: "attempt-spec-1",
    terminalFailureEventId: "evt-spec-ambiguous",
    symptom: "Prompt admits two reasonable interpretations",
    impact: "Verifier expected interpretation A; agent chose B",
    evidenceRefs: ["ev-spec-hash", "ev-clarity"],
    confidence: "high",
    toolCheck: {
      status: "pass",
      evidenceRefs: ["ev-tool-ok"],
      conclusion: "Tools matched ground truth",
    },
    contextCheck: {
      status: "pass",
      designedRef: "ev-designed-ok",
      sentRef: "ev-sent-ok",
      diffRef: "",
      conclusion: "Context integrity pass",
    },
    specificationCheck: {
      status: "fail",
      specHash: "abc123spec",
      humanContractorAnswer: "not uniquely determined",
      conclusion:
        "Professional executor cannot uniquely determine expected behavior",
    },
  });

  const model = createDiagnosis({
    taskId: "fixture-model",
    attemptId: "attempt-model-1",
    terminalFailureEventId: "evt-model-wrong-tool",
    symptom: "Model ignored explicit constraint and called disallowed tool",
    impact: "Verifier rejected the action",
    evidenceRefs: ["ev-tool-ok", "ev-ctx-ok", "ev-spec-ok", "ev-model-call"],
    confidence: "high",
    toolCheck: {
      status: "pass",
      evidenceRefs: ["ev-tool-ok"],
      conclusion: "Replay matched",
    },
    contextCheck: {
      status: "pass",
      designedRef: "ev-designed-ok",
      sentRef: "ev-sent-ok",
      diffRef: "",
      conclusion: "Context pass",
    },
    specificationCheck: {
      status: "pass",
      specHash: "spec-clear-1",
      humanContractorAnswer: "uniquely determined",
      conclusion: "Spec clear",
    },
    modelCheck: {
      status: "fail",
      callIds: ["call-disallowed-bash"],
      conclusion:
        "Model selected disallowed tool despite clear allowedTools constraint",
    },
  });

  return { tool, harness, specification, model };
}
