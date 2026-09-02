import type { AgentEvent, TokenUsage } from "./events.js";

export const CONTEXT_RULE_VERSION = "1.1.0";
export type ContextCategory =
  | "system_harness"
  | "tool_definition"
  | "project_instruction"
  | "user_message"
  | "assistant_message"
  | "file_content"
  | "search_listing"
  | "command_output"
  | "tool_error"
  | "edit_result"
  | "permission_context"
  | "compaction_summary"
  | "other";
export type Utility =
  "necessary" | "supporting" | "redundant" | "stale" | "harmful";

export interface ContextRow {
  sequence: number;
  timestamp: string;
  eventType: string;
  contextCategory: ContextCategory;
  utility: Utility;
  source: string;
  bytes: number;
  estimatedTokens: number;
  toolName: string;
  truncated: boolean;
  ruleVersion: string;
}

function observableValue(event: AgentEvent) {
  return (
    event.output ??
    event.input ??
    event.content ??
    event.systemPrompt ??
    event.message ??
    event.error?.message ??
    ""
  );
}

function rowFrom(
  event: AgentEvent,
  contextCategory: ContextCategory,
  utility: Utility,
  source: string,
  value: unknown,
): ContextRow {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  const bytes = Buffer.byteLength(serialized, "utf8");
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    eventType: event.eventType,
    contextCategory,
    utility,
    source,
    bytes,
    estimatedTokens: Math.ceil(bytes / 4),
    toolName: event.toolName || "",
    truncated: Boolean(event.truncated),
    ruleVersion: CONTEXT_RULE_VERSION,
  };
}

export function classifyEvent(event: AgentEvent): ContextRow {
  return expandContextRows(event)[0];
}

export function expandContextRows(event: AgentEvent): ContextRow[] {
  if (event.eventType === "request_snapshot") {
    return [
      rowFrom(
        event,
        "system_harness",
        "necessary",
        "systemPrompt",
        event.systemPrompt || "unavailable",
      ),
      rowFrom(
        event,
        "project_instruction",
        "necessary",
        String(event.projectInstructionSource || "CLAUDE.md"),
        event.projectInstructions || "unavailable",
      ),
      rowFrom(
        event,
        "tool_definition",
        "necessary",
        "tools",
        event.tools || [],
      ),
    ];
  }

  let contextCategory: ContextCategory = "other";
  let utility: Utility = "supporting";
  if (event.eventType === "user_message") {
    contextCategory = "user_message";
    utility = "necessary";
  } else if (event.eventType === "assistant_message")
    contextCategory = "assistant_message";
  else if (event.eventType === "system") {
    contextCategory = "system_harness";
    utility = "necessary";
  } else if (
    event.eventType === "permission_request" ||
    event.eventType === "permission_result"
  ) {
    contextCategory = "permission_context";
    utility = "necessary";
  } else if (event.eventType === "tool_error") {
    contextCategory = "tool_error";
    utility = "harmful";
  } else if (event.eventType === "tool_start")
    contextCategory = "tool_definition";
  else if (event.eventType === "tool_result") {
    if (event.toolName === "Read") {
      contextCategory = "file_content";
      utility = "necessary";
    } else if (event.toolName === "Glob" || event.toolName === "Grep")
      contextCategory = "search_listing";
    else if (event.toolName === "Bash") contextCategory = "command_output";
    else if (event.toolName === "Write" || event.toolName === "Edit") {
      contextCategory = "edit_result";
      utility = "necessary";
    }
  }
  return [
    rowFrom(
      event,
      contextCategory,
      utility,
      event.toolName || event.eventType,
      observableValue(event),
    ),
  ];
}

export interface TokenLedgerEntry extends Partial<
  Omit<TokenUsage, "measurement">
> {
  runId: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  measurement: TokenUsage["measurement"];
}

export function tokenLedger(events: AgentEvent[]): TokenLedgerEntry[] {
  const seen = new Set<string>();
  const models = new Map<string, string>();
  for (const event of events)
    if (event.model) models.set(event.runId, event.model);
  return events.flatMap((event) => {
    if (event.eventType !== "run_result" || seen.has(event.eventId)) return [];
    seen.add(event.eventId);
    const usage = event.usage || { measurement: "unavailable" as const };
    return [
      {
        runId: event.runId,
        model: event.model || models.get(event.runId),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        measurement: usage.measurement,
      },
    ];
  });
}

export function filterAndSortEvents(
  events: AgentEvent[],
  options: { eventType?: string; toolName?: string; errorsOnly?: boolean } = {},
) {
  return events
    .filter(
      (event) =>
        (!options.eventType || event.eventType === options.eventType) &&
        (!options.toolName || event.toolName === options.toolName) &&
        (!options.errorsOnly ||
          event.eventType === "tool_error" ||
          Boolean(event.error)),
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function contextCsv(events: AgentEvent[]) {
  const headers = [
    "sequence",
    "timestamp",
    "eventType",
    "contextCategory",
    "utility",
    "source",
    "bytes",
    "estimatedTokens",
    "toolName",
    "truncated",
    "ruleVersion",
  ];
  return [
    headers.join(","),
    ...events
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .flatMap((event) => expandContextRows(event))
      .map((row) =>
        headers.map((key) => csvCell(row[key as keyof ContextRow])).join(","),
      ),
  ].join("\r\n");
}

export function contextSummary(events: AgentEvent[]) {
  const summary: Record<
    string,
    { events: number; bytes: number; estimatedTokens: number }
  > = {};
  for (const event of events) {
    for (const row of expandContextRows(event)) {
      const current = (summary[row.contextCategory] ||= {
        events: 0,
        bytes: 0,
        estimatedTokens: 0,
      });
      current.events += 1;
      current.bytes += row.bytes;
      current.estimatedTokens += row.estimatedTokens;
    }
  }
  return summary;
}
