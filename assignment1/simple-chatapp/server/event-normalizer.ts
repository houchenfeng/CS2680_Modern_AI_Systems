import type { AgentEvent, TokenUsage } from "./events.js";
import { normalizeError } from "./redaction.js";

type EventBuilder = (payload: Partial<AgentEvent> & Pick<AgentEvent, "eventType">) => AgentEvent;

function usageFrom(message: any): TokenUsage {
  const usage = message?.usage;
  if (!usage) return { measurement: "unavailable" };
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheReadTokens = usage.cache_read_input_tokens;
  const cacheWriteTokens = usage.cache_creation_input_tokens;
  const numeric = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].filter(Number.isFinite);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: numeric.length ? numeric.reduce((sum, value) => sum + value, 0) : undefined,
    measurement: numeric.length ? "reported" : "unavailable",
  };
}

export function normalizeSdkMessage(message: any, build: EventBuilder): AgentEvent[] {
  const sdkSessionId = message?.session_id;
  if (message?.type === "assistant") {
    const content = Array.isArray(message.message?.content) ? message.message.content : [];
    return content.flatMap((block: any) => {
      if (block.type === "text") return [build({ eventType: "assistant_message", content: block.text, sdkSessionId })];
      if (block.type === "tool_use") {
        return [build({
          eventType: "tool_start",
          toolUseId: block.id,
          toolName: block.name,
          input: block.input,
          sdkSessionId,
        })];
      }
      return [];
    });
  }
  if (message?.type === "user") {
    const content = Array.isArray(message.message?.content) ? message.message.content : [];
    return content.flatMap((block: any) => {
      if (block.type !== "tool_result") return [];
      const isError = Boolean(block.is_error);
      return [build({
        eventType: isError ? "tool_error" : "tool_result",
        toolUseId: block.tool_use_id,
        output: block.content,
        isError,
        error: isError ? normalizeError(block.content, "tool") : undefined,
        sdkSessionId,
      })];
    });
  }
  if (message?.type === "result") {
    const success = message.subtype === "success" && !message.is_error;
    return [build({
      eventType: "run_result",
      status: success ? "success" : "error",
      durationMs: message.duration_ms,
      usage: usageFrom(message),
      costUsd: message.total_cost_usd,
      sdkSessionId,
      error: success ? undefined : normalizeError(message.errors?.join("\n") || message.subtype, "sdk"),
    })];
  }
  if (message?.type === "system" && message.subtype === "init") {
    return [build({
      eventType: "system",
      level: "info",
      message: `Agent initialized with model ${message.model}`,
      model: message.model,
      sdkSessionId,
    })];
  }
  return [];
}
