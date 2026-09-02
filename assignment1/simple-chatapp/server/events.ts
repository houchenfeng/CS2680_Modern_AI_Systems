export type ErrorSource =
  "sdk" | "tool" | "websocket" | "http" | "storage" | "validation";

export interface NormalizedError {
  code?: string;
  name?: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  retryable?: boolean;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  measurement: "reported" | "estimated" | "unavailable";
}

export type EventType =
  | "request_snapshot"
  | "user_message"
  | "assistant_message"
  | "tool_start"
  | "tool_result"
  | "tool_error"
  | "permission_request"
  | "permission_result"
  | "run_result"
  | "system";

export interface AgentEvent {
  schemaVersion: 1;
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
  usage?: TokenUsage;
  costUsd?: number;
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
  [key: string]: unknown;
}
