import type { AgentEvent, TokenUsage } from "./events.js";
import { normalizeError } from "./redaction.js";

type EventBuilder = (
  payload: Partial<AgentEvent> & Pick<AgentEvent, "eventType">,
) => AgentEvent;
const MAX_OBSERVED_OUTPUT_LENGTH = 64_000;

function observedOutput(value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized || serialized.length <= MAX_OBSERVED_OUTPUT_LENGTH)
    return { output: value };
  return {
    output: serialized.slice(0, MAX_OBSERVED_OUTPUT_LENGTH),
    truncated: true,
    originalLength: serialized.length,
  };
}

function flattenToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part)
        return String((part as { text?: unknown }).text ?? "");
      return null;
    })
    .filter((part): part is string => part !== null);
  return texts.length ? texts.join("\n") : content;
}

function parseExitCodeFromText(text: string): number | undefined {
  const match =
    text.match(/Exit code[: ]+(\d+)/i) ||
    text.match(/<exit_code>\s*(\d+)\s*<\/exit_code>/i);
  return match ? Number(match[1]) : undefined;
}

function commandFields(block: any) {
  const content = flattenToolContent(block?.content);

  // Structured object payloads (tests / some SDK variants).
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    return {
      exitCode:
        typeof record.exitCode === "number"
          ? record.exitCode
          : typeof record.exit_code === "number"
            ? record.exit_code
            : undefined,
      stdout: record.stdout,
      stderr: record.stderr,
    };
  }

  // Claude Agent SDK Bash results are usually a plain stdout string.
  // Errors may embed "Exit code N" in the text (e.g. interrupted runs).
  if (typeof content === "string") {
    const prefixed = content.match(/^Exit code[: ]+(\d+)\n([\s\S]*)$/i);
    if (prefixed) {
      return {
        exitCode: Number(prefixed[1]),
        stdout: undefined,
        stderr: prefixed[2] || undefined,
      };
    }
    const embedded = parseExitCodeFromText(content);
    return {
      exitCode: embedded ?? (block.is_error ? undefined : 0),
      stdout: content,
      stderr: undefined,
    };
  }

  return {
    exitCode: block?.exitCode ?? block?.exit_code,
    stdout: block?.stdout,
    stderr: block?.stderr,
  };
}

function usageFrom(message: any): TokenUsage {
  const usage = message?.usage;
  if (!usage) return { measurement: "unavailable" };
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheReadTokens = usage.cache_read_input_tokens;
  const cacheWriteTokens = usage.cache_creation_input_tokens;
  const numeric = [
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  ].filter(Number.isFinite);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: numeric.length
      ? numeric.reduce((sum, value) => sum + value, 0)
      : undefined,
    measurement: numeric.length ? "reported" : "unavailable",
  };
}

export function normalizeSdkMessage(
  message: any,
  build: EventBuilder,
): AgentEvent[] {
  const sdkSessionId = message?.session_id;
  if (message?.type === "assistant") {
    const content = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    return content.flatMap((block: any) => {
      if (block.type === "text")
        return [
          build({
            eventType: "assistant_message",
            content: block.text,
            sdkSessionId,
          }),
        ];
      if (block.type === "tool_use") {
        return [
          build({
            eventType: "tool_start",
            toolUseId: block.id,
            toolName: block.name,
            input: block.input,
            sdkSessionId,
          }),
        ];
      }
      return [];
    });
  }
  if (message?.type === "user") {
    const content = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    return content.flatMap((block: any) => {
      if (block.type !== "tool_result") return [];
      const isError = Boolean(block.is_error);
      const command = commandFields(block);
      return [
        build({
          eventType: isError ? "tool_error" : "tool_result",
          toolUseId: block.tool_use_id,
          ...observedOutput(block.content),
          ...command,
          isError,
          error: isError ? normalizeError(block.content, "tool") : undefined,
          sdkSessionId,
        }),
      ];
    });
  }
  if (message?.type === "result") {
    const success = message.subtype === "success" && !message.is_error;
    return [
      build({
        eventType: "run_result",
        status: success ? "success" : "error",
        durationMs: message.duration_ms,
        usage: usageFrom(message),
        costUsd: message.total_cost_usd,
        sdkSessionId,
        error: success
          ? undefined
          : normalizeError(
              message.errors?.join("\n") || message.subtype,
              "sdk",
            ),
      }),
    ];
  }
  if (message?.type === "system" && message.subtype === "init") {
    return [
      build({
        eventType: "system",
        level: "info",
        message: `Agent initialized with model ${message.model}`,
        model: message.model,
        sdkSessionId,
      }),
    ];
  }
  return [];
}
