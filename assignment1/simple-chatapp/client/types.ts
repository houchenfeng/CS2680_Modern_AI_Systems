export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: string;
  cwd?: string;
  workspacePath?: string;
  sdkSessionId?: string;
}

export interface AgentEvent {
  schemaVersion: 1 | 2;
  eventId: string;
  runId: string;
  chatId: string;
  sdkSessionId?: string;
  sequence: number;
  timestamp: string;
  eventType:
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
  content?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  error?: { message: string; source: string; retryable?: boolean };
  durationMs?: number;
  status?: string;
  usage?: Record<string, unknown>;
  callUsage?: Record<string, unknown>;
  runUsage?: Record<string, unknown>;
  modelUsageSnapshot?: Record<string, unknown>;
  costUsd?: number;
  providerReportedCostUsd?: number | null;
  normalizedPeakCostUsd?: number | null;
  model?: string;
  level?: string;
  message?: string;
  truncated?: boolean;
  originalLength?: number;
  exitCode?: number;
  stdout?: unknown;
  stderr?: unknown;
  startedAt?: string;
  endedAt?: string;
  requestId?: string;
  decision?: "allow" | "deny";
  reason?: string;
  systemPrompt?: string;
  projectInstructions?: string;
  projectInstructionSource?: string;
  projectInstructionStatus?: string;
  projectInstructionError?: string;
  tools?: string[];
  cwd?: string;
  settingSources?: string[];
  observabilityNote?: string;
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
}
