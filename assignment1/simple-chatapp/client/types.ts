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
  schemaVersion: 1;
  eventId: string;
  runId: string;
  chatId: string;
  sdkSessionId?: string;
  sequence: number;
  timestamp: string;
  eventType:
    | "user_message"
    | "assistant_message"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "permission_request"
    | "permission_result"
    | "run_result"
    | "system";
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
  costUsd?: number;
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
}
