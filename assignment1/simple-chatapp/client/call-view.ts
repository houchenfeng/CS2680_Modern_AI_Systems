import type { AgentEvent } from "./types";

export interface CallViewModel {
  callId: string;
  parentCallId?: string;
  providerRequestId?: string;
  requestHash?: string;
  model?: string;
  runId: string;
  sequence: number;
  timestamp: string;
  callUsage?: Record<string, unknown>;
  cacheOverlay?: Record<string, unknown>;
  contextLedger?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  providerReportedCostUsd?: number | null;
  normalizedPeakCostUsd?: number | null;
  coverage?: number | null;
  residual?: number | null;
  coverageReason?: string;
  sources?: Array<Record<string, unknown>>;
  fragments: AgentEvent[];
  observation?: AgentEvent;
}

export interface ContextDiff {
  added: string[];
  retained: string[];
  removed: string[];
  summarized: string[];
}

function fingerprintMessages(event: AgentEvent): string[] {
  const messages = (event as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => {
    const record = message as { role?: string; content?: unknown };
    const content = Array.isArray(record.content)
      ? record.content
          .map((block) => {
            const item = block as {
              type?: string;
              id?: string;
              tool_use_id?: string;
            };
            return `${item.type || "?"}:${item.id || item.tool_use_id || ""}`;
          })
          .join(",")
      : typeof record.content === "string"
        ? `text:${record.content.slice(0, 40)}`
        : "content";
    return `${index}:${record.role || "?"}:${content}`;
  });
}

export function diffAdjacentCalls(
  previous?: CallViewModel,
  current?: CallViewModel,
): ContextDiff {
  const prev = new Set(
    previous?.observation ? fingerprintMessages(previous.observation) : [],
  );
  const curr = new Set(
    current?.observation ? fingerprintMessages(current.observation) : [],
  );
  const added: string[] = [];
  const retained: string[] = [];
  const removed: string[] = [];
  const summarized: string[] = [];
  for (const item of curr) {
    if (prev.has(item)) retained.push(item);
    else added.push(item);
  }
  for (const item of prev) {
    if (!curr.has(item)) {
      if (/compact|summary|compaction/i.test(item)) summarized.push(item);
      else removed.push(item);
    }
  }
  return { added, retained, removed, summarized };
}

export function buildCallViewModels(events: AgentEvent[]): CallViewModel[] {
  const byCall = new Map<string, CallViewModel>();
  const order: string[] = [];

  for (const event of events) {
    if (event.eventType === "observed_request") {
      const phase = (event as { observationPhase?: string }).observationPhase;
      const callId = event.callId || event.eventId;
      let model = byCall.get(callId);
      if (!model) {
        model = {
          callId,
          parentCallId: event.parentCallId,
          runId: event.runId,
          sequence: event.sequence,
          timestamp: event.timestamp,
          fragments: [],
        };
        byCall.set(callId, model);
        order.push(callId);
      }
      if (phase === "request" || !model.observation) {
        model.observation = event;
        model.requestHash = event.requestHash;
        model.model = event.model;
        model.parentCallId = event.parentCallId;
      }
      if (phase === "response" || event.callUsage) {
        model.callUsage = event.callUsage;
        model.providerRequestId = event.providerRequestId;
        model.cacheOverlay = (
          event as { cacheOverlay?: Record<string, unknown> }
        ).cacheOverlay;
        model.contextLedger = (
          event as { contextLedger?: Record<string, unknown> }
        ).contextLedger;
        model.timing = (event as { timing?: Record<string, unknown> }).timing;
        model.providerReportedCostUsd = event.providerReportedCostUsd;
        model.normalizedPeakCostUsd = event.normalizedPeakCostUsd;
        const ledger = model.contextLedger as
          | {
              coverage?: {
                coverage?: number | null;
                residual?: number | null;
                reason?: string;
              };
              sources?: Array<Record<string, unknown>>;
            }
          | undefined;
        model.coverage = ledger?.coverage?.coverage ?? null;
        model.residual = ledger?.coverage?.residual ?? null;
        model.coverageReason = ledger?.coverage?.reason;
        model.sources = ledger?.sources;
      }
      continue;
    }

    if (event.callId) {
      let model = byCall.get(event.callId);
      if (!model) {
        model = {
          callId: event.callId,
          parentCallId: event.parentCallId,
          runId: event.runId,
          sequence: event.sequence,
          timestamp: event.timestamp,
          messageId: event.messageId,
          fragments: [],
        } as CallViewModel;
        byCall.set(event.callId, model);
        order.push(event.callId);
      }
      model.fragments.push(event);
      if (event.callUsage && !model.callUsage)
        model.callUsage = event.callUsage;
      if (event.messageId)
        (model as { messageId?: string }).messageId = event.messageId;
    }
  }

  return order.map((id) => byCall.get(id)!).filter(Boolean);
}
