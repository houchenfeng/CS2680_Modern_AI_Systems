export type ErrorSource =
  "sdk" | "tool" | "websocket" | "http" | "storage" | "validation" | "proxy";

export interface NormalizedError {
  code?: string;
  name?: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  retryable?: boolean;
}

/** @deprecated Prefer CallUsage / RunUsage / ModelUsageSnapshot. Kept for schema v1. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  measurement: "reported" | "estimated" | "unavailable";
}

export type Measurement = "reported" | "estimated" | "unavailable";

/**
 * Per-model-call usage. Missing provider fields stay null (never coerced to 0).
 * logicalInputTokens = uncachedInput + cacheRead + cacheWrite when all three are numbers.
 */
export interface CallUsage {
  uncachedInputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  logicalInputTokens: number | null;
  outputTokens: number | null;
  measurement: Measurement;
  usageConflict?: boolean;
  usageCandidates?: Array<{
    source: string;
    uncachedInputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    outputTokens: number | null;
  }>;
}

/** Aggregated usage for one user-run (run_result). */
export interface RunUsage {
  uncachedInputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  logicalInputTokens: number | null;
  outputTokens: number | null;
  measurement: Measurement;
}

/** Snapshot of SDK result.modelUsage for a resolved model key. */
export interface ModelUsageSnapshot {
  model?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  logicalInputTokens: number | null;
  costUsd: number | null;
  contextWindow?: number | null;
  measurement: Measurement;
}

export function logicalInputTokens(
  uncached: number | null | undefined,
  cacheRead: number | null | undefined,
  cacheWrite: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(uncached as number) ||
    !Number.isFinite(cacheRead as number) ||
    !Number.isFinite(cacheWrite as number)
  ) {
    return null;
  }
  return (uncached as number) + (cacheRead as number) + (cacheWrite as number);
}

export function callUsageFromProvider(
  usage: unknown,
  source = "provider",
): CallUsage {
  if (!usage || typeof usage !== "object") {
    return {
      uncachedInputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      logicalInputTokens: null,
      outputTokens: null,
      measurement: "unavailable",
    };
  }
  const record = usage as Record<string, unknown>;
  const uncached = numberOrNull(
    record.input_tokens ?? record.uncachedInputTokens ?? record.inputTokens,
  );
  const cacheRead = numberOrNull(
    record.cache_read_input_tokens ??
      record.cacheReadTokens ??
      record.cache_read_tokens,
  );
  const cacheWrite = numberOrNull(
    record.cache_creation_input_tokens ??
      record.cacheWriteTokens ??
      record.cache_creation_tokens,
  );
  const output = numberOrNull(record.output_tokens ?? record.outputTokens);
  const hasAny = [uncached, cacheRead, cacheWrite, output].some(
    (value) => value !== null,
  );
  return {
    uncachedInputTokens: uncached,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    logicalInputTokens: logicalInputTokens(uncached, cacheRead, cacheWrite),
    outputTokens: output,
    measurement: hasAny ? "reported" : "unavailable",
    usageCandidates: [
      {
        source,
        uncachedInputTokens: uncached,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: output,
      },
    ],
  };
}

export function runUsageFromProvider(usage: unknown): RunUsage {
  const call = callUsageFromProvider(usage, "run_result");
  return {
    uncachedInputTokens: call.uncachedInputTokens,
    cacheReadTokens: call.cacheReadTokens,
    cacheWriteTokens: call.cacheWriteTokens,
    logicalInputTokens: call.logicalInputTokens,
    outputTokens: call.outputTokens,
    measurement: call.measurement,
  };
}

export function modelUsageSnapshotFrom(
  model: string | undefined,
  usage: unknown,
): ModelUsageSnapshot {
  const record =
    usage && typeof usage === "object"
      ? (usage as Record<string, unknown>)
      : {};
  const uncached = numberOrNull(record.inputTokens ?? record.input_tokens);
  const output = numberOrNull(record.outputTokens ?? record.output_tokens);
  const cacheRead = numberOrNull(
    record.cacheReadInputTokens ??
      record.cache_read_input_tokens ??
      record.cacheReadTokens,
  );
  const cacheWrite = numberOrNull(
    record.cacheCreationInputTokens ??
      record.cache_creation_input_tokens ??
      record.cacheWriteTokens,
  );
  const costUsd = numberOrNull(record.costUSD ?? record.costUsd);
  const contextWindow = numberOrNull(
    record.contextWindow ?? record.context_window,
  );
  const hasAny = [uncached, output, cacheRead, cacheWrite, costUsd].some(
    (value) => value !== null,
  );
  return {
    model,
    inputTokens: uncached,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    logicalInputTokens: logicalInputTokens(uncached, cacheRead, cacheWrite),
    costUsd,
    contextWindow,
    measurement: hasAny ? "reported" : "unavailable",
  };
}

/** Convert legacy TokenUsage (v1) into CallUsage without inventing zeros. */
export function callUsageFromLegacy(usage?: TokenUsage | null): CallUsage {
  if (!usage) {
    return {
      uncachedInputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      logicalInputTokens: null,
      outputTokens: null,
      measurement: "unavailable",
    };
  }
  const uncached = numberOrNull(usage.inputTokens);
  const cacheRead = numberOrNull(usage.cacheReadTokens);
  const cacheWrite = numberOrNull(usage.cacheWriteTokens);
  const output = numberOrNull(usage.outputTokens);
  return {
    uncachedInputTokens: uncached,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    logicalInputTokens: logicalInputTokens(uncached, cacheRead, cacheWrite),
    outputTokens: output,
    measurement: usage.measurement || "unavailable",
  };
}

export function legacyUsageFromCall(usage: CallUsage | RunUsage): TokenUsage {
  const values = [
    usage.uncachedInputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  ].filter((value): value is number => value !== null);
  return {
    inputTokens: usage.uncachedInputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    cacheReadTokens: usage.cacheReadTokens ?? undefined,
    cacheWriteTokens: usage.cacheWriteTokens ?? undefined,
    totalTokens: values.length
      ? values.reduce((sum, value) => sum + value, 0)
      : undefined,
    measurement: usage.measurement,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type EventType =
  | "request_snapshot"
  | "user_message"
  | "assistant_message"
  | "assistant_thinking"
  | "tool_start"
  | "tool_result"
  | "tool_error"
  | "permission_request"
  | "permission_result"
  | "run_result"
  | "system"
  | "unknown_sdk_block"
  | "compact_boundary"
  | "model_call"
  | "observed_request"
  | "observability_bypass";

export interface AgentEvent {
  schemaVersion: 1 | 2;
  eventId: string;
  runId: string;
  chatId: string;
  sdkSessionId?: string;
  sequence: number;
  timestamp: string;
  eventType: EventType;
  content?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  error?: NormalizedError;
  durationMs?: number;
  status?: "success" | "error" | "stopped";
  /** @deprecated schema v1 field; prefer callUsage / runUsage. */
  usage?: TokenUsage;
  callUsage?: CallUsage;
  runUsage?: RunUsage;
  modelUsageSnapshot?: ModelUsageSnapshot;
  costUsd?: number;
  providerReportedCostUsd?: number | null;
  normalizedPeakCostUsd?: number | null;
  model?: string;
  level?: "info" | "warning" | "error";
  message?: string;
  truncated?: boolean;
  originalLength?: number;
  exitCode?: number;
  stdout?: unknown;
  stderr?: unknown;
  startedAt?: string;
  endedAt?: string;
  callId?: string;
  providerRequestId?: string;
  parentCallId?: string;
  messageId?: string;
  blockIndex?: number;
  requestHash?: string;
  usageConflict?: boolean;
  thinkingChars?: number;
  thinkingTokensEstimated?: number | null;
  blockType?: string;
  rawBlock?: unknown;
  [key: string]: unknown;
}

/**
 * Upgrade a persisted JSONL event to schema v2 in memory.
 * Never rewrites the on-disk historical file.
 */
export function migrateEvent(raw: unknown): AgentEvent {
  const event = { ...(raw as AgentEvent) };
  if (event.schemaVersion === 2) {
    if (event.callUsage && event.callUsage.logicalInputTokens === undefined) {
      event.callUsage.logicalInputTokens = logicalInputTokens(
        event.callUsage.uncachedInputTokens,
        event.callUsage.cacheReadTokens,
        event.callUsage.cacheWriteTokens,
      );
    }
    return event;
  }

  event.schemaVersion = 2;
  if (event.usage && !event.callUsage && event.eventType !== "run_result") {
    event.callUsage = callUsageFromLegacy(event.usage);
  }
  if (event.usage && !event.runUsage && event.eventType === "run_result") {
    const call = callUsageFromLegacy(event.usage);
    event.runUsage = {
      uncachedInputTokens: call.uncachedInputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      logicalInputTokens: call.logicalInputTokens,
      outputTokens: call.outputTokens,
      measurement: call.measurement,
    };
  }
  if (
    event.costUsd !== undefined &&
    event.providerReportedCostUsd === undefined
  ) {
    event.providerReportedCostUsd = event.costUsd;
  }
  return event;
}
