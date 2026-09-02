import { createHash } from "node:crypto";
import type { CallUsage, Measurement } from "./events.js";
import {
  countTokens,
  type CountTokensOptions,
  type CountTokensResult,
} from "./token-counter.js";

/** Call-level ledger rule version. Keep trace-analysis CONTEXT_RULE_VERSION unchanged. */
export const CALL_CONTEXT_RULE_VERSION = "call-1.0.0";

export const COVERAGE_GATE = 0.95;

export type LadderStep =
  "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8";

export type ProvenanceSourceId =
  | "api_framing"
  | "application_system"
  | "project_instructions"
  | "tool_definitions"
  | "user_messages"
  | "assistant_history"
  | "tool_use_history"
  | "tool_results"
  | "sdk_framing"
  | "permission_hook_compaction";

export interface ProvenanceSource {
  id: ProvenanceSourceId;
  label: string;
  tokens: number;
  share: number | null;
  ladderFrom: LadderStep | "C7b";
  ladderTo: LadderStep | "C7b";
  evidence: "count_tokens_diff" | "calibrated" | "estimated";
}

export interface LadderCounts {
  C0: number;
  C1: number;
  C2: number;
  C3: number;
  C4: number;
  C5: number;
  C6: number;
  C7: number;
  /** Captured system swapped onto C7 (splits SDK framing from C8 remainder). */
  C7b: number;
  C8: number;
}

export interface CoverageResult {
  reportedLogicalInput: number | null;
  countedFullRequest: number | null;
  residual: number | null;
  coverage: number | null;
  authoritative: boolean;
  passesGate: boolean | null;
  reason?: string;
  requestHash?: string;
}

export interface ContextLedger {
  ruleVersion: typeof CALL_CONTEXT_RULE_VERSION;
  model?: string;
  requestHash: string;
  ladder: LadderCounts;
  ladderMeasurement: Measurement;
  sources: ProvenanceSource[];
  provenanceTotal: number;
  coverage: CoverageResult;
  rawCounts: Partial<Record<LadderStep | "C7b", CountTokensResult>>;
}

export type CountTokensFn = (
  requestBody: Record<string, unknown>,
  options?: CountTokensOptions,
) => Promise<CountTokensResult>;

export interface BuildContextLedgerInput {
  capturedRequest: Record<string, unknown>;
  applicationSystem?: string;
  projectInstructions?: string | "unavailable";
  reportedUsage?: CallUsage | null;
  countTokensFn?: CountTokensFn;
  countTokensOptions?: CountTokensOptions;
  requestHash?: string;
}

const SOURCE_LABELS: Record<ProvenanceSourceId, string> = {
  api_framing: "API/model framing",
  application_system: "Application system prompt",
  project_instructions: "CLAUDE.md / project instructions",
  tool_definitions: "Tool definitions + instructions",
  user_messages: "User messages",
  assistant_history: "Assistant text/thinking history",
  tool_use_history: "Historical tool-use blocks",
  tool_results: "Tool results/errors",
  sdk_framing: "SDK/Claude Code framing",
  permission_hook_compaction: "Permission/hook/compaction/retrieval",
};

function sha256Json(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function composeSystem(
  applicationSystem: string | undefined,
  projectInstructions: string | "unavailable" | undefined,
) {
  const base = (applicationSystem || "").trim();
  const project =
    !projectInstructions ||
    projectInstructions === "unavailable" ||
    !String(projectInstructions).trim()
      ? ""
      : String(projectInstructions).trim();
  if (!base && !project) return undefined;
  if (!project) return base || undefined;
  if (!base) return project;
  return `${base}

---
Project instructions from CLAUDE.md:
${project}`;
}

type ContentBlock = Record<string, unknown> & { type?: string };

function normalizeContent(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];
  return content
    .map((block) => asRecord(block))
    .filter((block): block is ContentBlock => Boolean(block));
}

function isAssistantTextOrThinking(block: ContentBlock) {
  const type = String(block.type || "");
  return (
    type === "text" ||
    type === "thinking" ||
    type === "redacted_thinking" ||
    type === "thinking_delta"
  );
}

function isToolUse(block: ContentBlock) {
  return String(block.type || "") === "tool_use";
}

function isToolResult(block: ContentBlock) {
  const type = String(block.type || "");
  return type === "tool_result" || type === "tool_result_error";
}

function isPermissionHookCompaction(block: ContentBlock) {
  const type = String(block.type || "").toLowerCase();
  return (
    type.includes("permission") ||
    type.includes("hook") ||
    type.includes("compact") ||
    type.includes("retrieval") ||
    type === "server_tool_use" ||
    type === "web_search_tool_result"
  );
}

function filterMessageContent(
  messages: unknown[],
  predicate: (block: ContentBlock, role: string) => boolean,
) {
  const out: Array<{ role: string; content: ContentBlock[] }> = [];
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    const role = String(record.role || "");
    const blocks = normalizeContent(record.content).filter((block) =>
      predicate(block, role),
    );
    if (blocks.length === 0) continue;
    out.push({ role, content: blocks });
  }
  return out;
}

/**
 * Fixed attribution ladder bodies C0..C8.
 * Thinking only includes blocks already present on the captured request.
 */
export function buildLadderBodies(input: {
  capturedRequest: Record<string, unknown>;
  applicationSystem?: string;
  projectInstructions?: string | "unavailable";
}) {
  const captured = input.capturedRequest;
  const model =
    typeof captured.model === "string" ? captured.model : "unknown-model";
  const tools = Array.isArray(captured.tools) ? captured.tools : [];
  const messages = Array.isArray(captured.messages) ? captured.messages : [];
  const composedSystem = composeSystem(
    input.applicationSystem,
    input.projectInstructions,
  );
  const capturedSystem =
    captured.system === undefined || captured.system === null
      ? undefined
      : captured.system;

  const minimalUser = [{ role: "user", content: "" }];

  const userOnly = filterMessageContent(
    messages,
    (block, role) =>
      role === "user" &&
      !isToolResult(block) &&
      !isPermissionHookCompaction(block),
  );

  const throughAssistant = filterMessageContent(messages, (block, role) => {
    if (
      role === "user" &&
      !isToolResult(block) &&
      !isPermissionHookCompaction(block)
    ) {
      return true;
    }
    if (role === "assistant") return isAssistantTextOrThinking(block);
    return false;
  });

  const throughToolUse = filterMessageContent(messages, (block, role) => {
    if (
      role === "user" &&
      !isToolResult(block) &&
      !isPermissionHookCompaction(block)
    ) {
      return true;
    }
    if (role === "assistant") {
      return isAssistantTextOrThinking(block) || isToolUse(block);
    }
    return false;
  });

  const throughToolResults = filterMessageContent(messages, (block, role) => {
    if (isPermissionHookCompaction(block)) return false;
    if (role === "user") return !isPermissionHookCompaction(block);
    if (role === "assistant") {
      return (
        isAssistantTextOrThinking(block) ||
        isToolUse(block) ||
        isToolResult(block)
      );
    }
    return isToolResult(block);
  });

  const C0: Record<string, unknown> = {
    model,
    messages:
      userOnly.length > 0 ? [{ role: "user", content: "" }] : minimalUser,
  };
  const C1: Record<string, unknown> = {
    ...C0,
    ...(input.applicationSystem ? { system: input.applicationSystem } : {}),
  };
  const C2: Record<string, unknown> = {
    ...C0,
    ...(composedSystem ? { system: composedSystem } : {}),
  };
  const C3: Record<string, unknown> = {
    ...C2,
    ...(tools.length ? { tools } : {}),
  };
  const C4: Record<string, unknown> = {
    model,
    ...(composedSystem ? { system: composedSystem } : {}),
    ...(tools.length ? { tools } : {}),
    messages: userOnly.length ? userOnly : minimalUser,
  };
  const C5: Record<string, unknown> = {
    ...C4,
    messages: throughAssistant.length ? throughAssistant : C4.messages,
  };
  const C6: Record<string, unknown> = {
    ...C4,
    messages: throughToolUse.length ? throughToolUse : C5.messages,
  };
  const C7: Record<string, unknown> = {
    ...C4,
    messages: throughToolResults.length ? throughToolResults : C6.messages,
  };
  const C7b: Record<string, unknown> = {
    ...C7,
    ...(capturedSystem !== undefined ? { system: capturedSystem } : {}),
  };
  const C8: Record<string, unknown> = {
    model,
    ...(capturedSystem !== undefined ? { system: capturedSystem } : {}),
    ...(tools.length ? { tools } : {}),
    messages,
    ...(captured.tool_choice !== undefined
      ? { tool_choice: captured.tool_choice }
      : {}),
  };

  return { C0, C1, C2, C3, C4, C5, C6, C7, C7b, C8, composedSystem };
}

function diffTokens(higher: number, lower: number) {
  return Math.max(0, higher - lower);
}

function buildSources(ladder: LadderCounts): ProvenanceSource[] {
  const total = ladder.C8;
  const rows: Array<{
    id: ProvenanceSourceId;
    tokens: number;
    ladderFrom: LadderStep | "C7b";
    ladderTo: LadderStep | "C7b";
  }> = [
    { id: "api_framing", tokens: ladder.C0, ladderFrom: "C0", ladderTo: "C0" },
    {
      id: "application_system",
      tokens: diffTokens(ladder.C1, ladder.C0),
      ladderFrom: "C0",
      ladderTo: "C1",
    },
    {
      id: "project_instructions",
      tokens: diffTokens(ladder.C2, ladder.C1),
      ladderFrom: "C1",
      ladderTo: "C2",
    },
    {
      id: "tool_definitions",
      tokens: diffTokens(ladder.C3, ladder.C2),
      ladderFrom: "C2",
      ladderTo: "C3",
    },
    {
      id: "user_messages",
      tokens: diffTokens(ladder.C4, ladder.C3),
      ladderFrom: "C3",
      ladderTo: "C4",
    },
    {
      id: "assistant_history",
      tokens: diffTokens(ladder.C5, ladder.C4),
      ladderFrom: "C4",
      ladderTo: "C5",
    },
    {
      id: "tool_use_history",
      tokens: diffTokens(ladder.C6, ladder.C5),
      ladderFrom: "C5",
      ladderTo: "C6",
    },
    {
      id: "tool_results",
      tokens: diffTokens(ladder.C7, ladder.C6),
      ladderFrom: "C6",
      ladderTo: "C7",
    },
    {
      id: "sdk_framing",
      tokens: diffTokens(ladder.C7b, ladder.C7),
      ladderFrom: "C7",
      ladderTo: "C7b",
    },
    {
      id: "permission_hook_compaction",
      tokens: diffTokens(ladder.C8, ladder.C7b),
      ladderFrom: "C7b",
      ladderTo: "C8",
    },
  ];

  return rows.map((row) => ({
    ...row,
    label: SOURCE_LABELS[row.id],
    share: total > 0 ? row.tokens / total : null,
    evidence: "count_tokens_diff" as const,
  }));
}

export function computeCoverage(input: {
  reportedUsage?: CallUsage | null;
  countedFullRequest: number | null;
  countMeasurement: Measurement;
  requestHash: string;
}): CoverageResult {
  const usage = input.reportedUsage;
  const reported =
    usage?.logicalInputTokens ??
    (usage
      ? [
          usage.uncachedInputTokens,
          usage.cacheReadTokens,
          usage.cacheWriteTokens,
        ].every((value) => typeof value === "number")
        ? (usage.uncachedInputTokens as number) +
          (usage.cacheReadTokens as number) +
          (usage.cacheWriteTokens as number)
        : null
      : null);

  if (reported === null || reported === undefined) {
    return {
      reportedLogicalInput: null,
      countedFullRequest: input.countedFullRequest,
      residual: null,
      coverage: null,
      authoritative: false,
      passesGate: null,
      reason: "provider_usage_missing",
      requestHash: input.requestHash,
    };
  }

  if (
    input.countMeasurement !== "reported" ||
    input.countedFullRequest === null
  ) {
    return {
      reportedLogicalInput: reported,
      countedFullRequest: input.countedFullRequest,
      residual: null,
      coverage: null,
      authoritative: false,
      passesGate: null,
      reason:
        input.countMeasurement === "estimated"
          ? "count_tokens_estimated_not_authoritative"
          : "count_tokens_unavailable",
      requestHash: input.requestHash,
    };
  }

  const residual = reported - input.countedFullRequest;
  const coverage = 1 - Math.abs(residual) / reported;
  const passesGate = coverage >= COVERAGE_GATE;
  return {
    reportedLogicalInput: reported,
    countedFullRequest: input.countedFullRequest,
    residual,
    coverage,
    authoritative: true,
    passesGate,
    reason: passesGate
      ? undefined
      : `coverage_below_gate:${coverage.toFixed(4)}<${COVERAGE_GATE}`,
    requestHash: input.requestHash,
  };
}

async function countStep(
  fn: CountTokensFn,
  body: Record<string, unknown>,
  options?: CountTokensOptions,
) {
  return fn(body, options);
}

/**
 * Build a per-call context ledger from a captured Messages request.
 * Injectable `countTokensFn` keeps unit tests offline.
 */
export async function buildContextLedger(
  input: BuildContextLedgerInput,
): Promise<ContextLedger> {
  const requestHash = input.requestHash || sha256Json(input.capturedRequest);
  const bodies = buildLadderBodies({
    capturedRequest: input.capturedRequest,
    applicationSystem: input.applicationSystem,
    projectInstructions: input.projectInstructions,
  });
  const countFn = input.countTokensFn ?? countTokens;
  const options = input.countTokensOptions;

  const steps: Array<LadderStep | "C7b"> = [
    "C0",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
    "C7b",
    "C8",
  ];
  const rawCounts: Partial<Record<LadderStep | "C7b", CountTokensResult>> = {};
  const ladder = {
    C0: 0,
    C1: 0,
    C2: 0,
    C3: 0,
    C4: 0,
    C5: 0,
    C6: 0,
    C7: 0,
    C7b: 0,
    C8: 0,
  } satisfies LadderCounts;

  let anyEstimated = false;
  let anyUnavailable = false;

  for (const step of steps) {
    const result = await countStep(countFn, bodies[step], options);
    rawCounts[step] = result;
    const tokens = result.inputTokens;
    if (result.measurement === "estimated") anyEstimated = true;
    if (result.measurement === "unavailable" || tokens === null) {
      anyUnavailable = true;
    }
    ladder[step] = typeof tokens === "number" ? tokens : 0;
  }

  const sources = buildSources(ladder);
  const provenanceTotal = sources.reduce((sum, row) => sum + row.tokens, 0);
  const ladderMeasurement: Measurement = anyUnavailable
    ? "unavailable"
    : anyEstimated
      ? "estimated"
      : "reported";

  // Estimates must not enter authoritative coverage.
  const coverage = computeCoverage({
    reportedUsage: input.reportedUsage,
    countedFullRequest:
      ladderMeasurement === "reported"
        ? ladder.C8
        : (rawCounts.C8?.inputTokens ?? null),
    countMeasurement: ladderMeasurement,
    requestHash,
  });

  return {
    ruleVersion: CALL_CONTEXT_RULE_VERSION,
    model:
      typeof input.capturedRequest.model === "string"
        ? input.capturedRequest.model
        : undefined,
    requestHash,
    ladder,
    ladderMeasurement,
    sources,
    provenanceTotal,
    coverage,
    rawCounts,
  };
}
