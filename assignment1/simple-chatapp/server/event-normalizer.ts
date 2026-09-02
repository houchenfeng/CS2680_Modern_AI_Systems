import { createHash, randomUUID } from "node:crypto";
import type { AgentEvent, CallUsage, TokenUsage } from "./events.js";
import {
  callUsageFromProvider,
  legacyUsageFromCall,
  modelUsageSnapshotFrom,
  runUsageFromProvider,
} from "./events.js";
import { normalizeError, redact } from "./redaction.js";

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

/** @deprecated Prefer callUsageFromProvider; kept for older TokenUsage callers. */
function usageFrom(message: any): TokenUsage {
  return legacyUsageFromCall(callUsageFromProvider(message?.usage, "sdk"));
}

function usageFingerprint(usage: CallUsage): string {
  return [
    usage.uncachedInputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.outputTokens,
  ].join("|");
}

function selectCallUsage(
  message: any,
  messageId: string | undefined,
  seenUsageByMessageId: Map<string, CallUsage>,
): { callUsage?: CallUsage; usageConflict?: boolean } {
  const candidate = callUsageFromProvider(
    message?.message?.usage ?? message?.usage,
    "assistant_fragment",
  );
  if (candidate.measurement === "unavailable") return {};

  if (!messageId) {
    return { callUsage: candidate };
  }

  const previous = seenUsageByMessageId.get(messageId);
  if (!previous) {
    seenUsageByMessageId.set(messageId, candidate);
    return { callUsage: candidate };
  }

  if (usageFingerprint(previous) === usageFingerprint(candidate)) {
    // Same message ID repeated the same usage — do not sum again.
    return {};
  }

  const conflicted: CallUsage = {
    ...previous,
    usageConflict: true,
    usageCandidates: [
      ...(previous.usageCandidates || []),
      ...(candidate.usageCandidates || []),
    ],
  };
  seenUsageByMessageId.set(messageId, conflicted);
  return { callUsage: conflicted, usageConflict: true };
}

const seenUsageByMessageId = new Map<string, CallUsage>();
const callIdByMessageId = new Map<string, string>();

/** Test helper: clear per-process message usage dedupe state. */
export function resetNormalizerState() {
  seenUsageByMessageId.clear();
  callIdByMessageId.clear();
}

function callIdForMessage(messageId: string | undefined): string {
  if (!messageId) return `call-${randomUUID()}`;
  const existing = callIdByMessageId.get(messageId);
  if (existing) return existing;
  const created = `call-${createHash("sha256").update(messageId).digest("hex").slice(0, 16)}`;
  callIdByMessageId.set(messageId, created);
  return created;
}

function thinkingMetrics(text: string) {
  const thinkingChars = text.length;
  return {
    thinkingChars,
    // Character/4 is an estimate only; never claimed as authoritative CoT export.
    thinkingTokensEstimated: thinkingChars
      ? Math.ceil(thinkingChars / 4)
      : null,
  };
}

export function normalizeSdkMessage(
  message: any,
  build: EventBuilder,
): AgentEvent[] {
  const sdkSessionId = message?.session_id;
  if (message?.type === "assistant") {
    const messageId =
      typeof message.message?.id === "string" ? message.message.id : undefined;
    const callId = callIdForMessage(messageId);
    const content = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    const { callUsage, usageConflict } = selectCallUsage(
      message,
      messageId,
      seenUsageByMessageId,
    );
    let attachedUsage = false;

    const events = content.flatMap((block: any, blockIndex: number) => {
      const shared = {
        sdkSessionId,
        messageId,
        callId,
        blockIndex,
        ...(usageConflict ? { usageConflict: true } : {}),
      };
      const withUsageOnce = () => {
        if (attachedUsage || !callUsage) return {};
        attachedUsage = true;
        return {
          callUsage,
          usage: legacyUsageFromCall(callUsage),
          usageConflict: callUsage.usageConflict || usageConflict,
        };
      };

      if (block.type === "text") {
        return [
          build({
            eventType: "assistant_message",
            content: block.text,
            ...shared,
            ...withUsageOnce(),
          }),
        ];
      }
      if (block.type === "thinking") {
        const text = String(block.thinking ?? "");
        return [
          build({
            eventType: "assistant_thinking",
            content: text,
            ...thinkingMetrics(text),
            ...shared,
            ...withUsageOnce(),
          }),
        ];
      }
      if (block.type === "redacted_thinking") {
        return [
          build({
            eventType: "assistant_thinking",
            content: "[redacted_thinking]",
            thinkingChars: 0,
            thinkingTokensEstimated: null,
            blockType: "redacted_thinking",
            ...shared,
            ...withUsageOnce(),
          }),
        ];
      }
      if (block.type === "tool_use") {
        return [
          build({
            eventType: "tool_start",
            toolUseId: block.id,
            toolName: block.name,
            input: block.input,
            ...shared,
            ...withUsageOnce(),
          }),
        ];
      }

      return [
        build({
          eventType: "unknown_sdk_block",
          blockType: String(block?.type || "unknown"),
          rawBlock: redact(block),
          ...shared,
          ...withUsageOnce(),
        }),
      ];
    });

    if (!events.length && callUsage) {
      return [
        build({
          eventType: "model_call",
          messageId,
          callId,
          callUsage,
          usage: legacyUsageFromCall(callUsage),
          usageConflict,
          sdkSessionId,
        }),
      ];
    }
    return events;
  }

  if (message?.type === "user") {
    const content = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    return content.flatMap((block: any, blockIndex: number) => {
      if (block.type !== "tool_result") {
        if (block.type) {
          return [
            build({
              eventType: "unknown_sdk_block",
              blockType: String(block.type),
              rawBlock: redact(block),
              blockIndex,
              sdkSessionId,
            }),
          ];
        }
        return [];
      }
      const isError = Boolean(block.is_error);
      const command = commandFields(block);
      return [
        build({
          eventType: isError ? "tool_error" : "tool_result",
          toolUseId: block.tool_use_id,
          blockIndex,
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
    const runUsage = runUsageFromProvider(message.usage);
    const modelKey =
      message.modelUsage && typeof message.modelUsage === "object"
        ? Object.keys(message.modelUsage)[0]
        : undefined;
    const modelUsageSnapshot = modelKey
      ? modelUsageSnapshotFrom(modelKey, message.modelUsage[modelKey])
      : undefined;
    return [
      build({
        eventType: "run_result",
        status: success ? "success" : "error",
        durationMs: message.duration_ms,
        durationApiMs: message.duration_api_ms,
        usage: usageFrom(message),
        runUsage,
        modelUsageSnapshot,
        costUsd: message.total_cost_usd,
        providerReportedCostUsd:
          typeof message.total_cost_usd === "number"
            ? message.total_cost_usd
            : null,
        sdkSessionId,
        numTurns: message.num_turns,
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
        tools: message.tools,
        claudeCodeVersion: message.claude_code_version || message.version,
        sdkSessionId,
      }),
    ];
  }

  if (
    message?.type === "system" &&
    (message.subtype === "compact_boundary" ||
      message.subtype === "compact" ||
      message.compact_boundary)
  ) {
    return [
      build({
        eventType: "compact_boundary",
        level: "info",
        message: message.message || "Context compaction boundary",
        rawBlock: redact({
          subtype: message.subtype,
          compact_boundary: message.compact_boundary,
          uuid: message.uuid,
        }),
        sdkSessionId,
      }),
    ];
  }

  if (message?.type === "system" && message.subtype === "status") {
    return [
      build({
        eventType: "system",
        level: "info",
        message: message.message || message.status || "status",
        rawBlock: redact({
          subtype: message.subtype,
          status: message.status,
        }),
        sdkSessionId,
      }),
    ];
  }

  if (message?.type === "system" && message.hook_event_name) {
    return [
      build({
        eventType: "system",
        level: "info",
        message: `Hook response: ${message.hook_event_name}`,
        rawBlock: redact({
          hook_event_name: message.hook_event_name,
          hook_id: message.hook_id,
          content: message.content,
        }),
        sdkSessionId,
      }),
    ];
  }

  if (message?.type) {
    return [
      build({
        eventType: "unknown_sdk_block",
        blockType: String(message.type),
        rawBlock: redact(message),
        sdkSessionId,
      }),
    ];
  }

  return [];
}
