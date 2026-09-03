import type { NormalizedError } from "./events.js";

/** Structured failure fields that must be preservable on events/artifacts. */
export interface FailureEvidenceFields {
  // Tool
  toolInput?: unknown;
  toolOutput?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number | null;
  isError?: boolean;

  // Exception
  exception?: {
    name?: string;
    code?: string;
    message: string;
    cause?: string;
    stack?: string;
  };

  // HTTP
  http?: {
    method?: string;
    safeUrl?: string;
    status?: number;
    safeResponseBody?: unknown;
    providerRequestId?: string;
  };

  // Retry / timeout
  timeoutMs?: number | null;
  retry?: {
    number: number;
    backoffMs?: number;
    fallbackTarget?: string;
    fallbackResult?: string;
  };

  // Permission
  permission?: {
    phase:
      "ask" | "allow" | "deny" | "timeout" | "disconnect" | "late_callback";
    requestId?: string;
    toolName?: string;
    reason?: string;
  };

  // Hook
  hook?: {
    name?: string;
    event?: string;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: number | null;
  };

  // Compaction
  compaction?: {
    boundary?: boolean;
    preTokens?: number | null;
    summary?: string;
    postCompactRequestHash?: string;
  };

  // Recovery chain
  lastSuccessfulEventId?: string;
  recoveryAttempts?: Array<{
    at: string;
    action: string;
    result: string;
    evidenceSha256?: string;
  }>;
  terminalEventId?: string;

  // Raw unknown SDK
  unknownSdkArtifactSha256?: string;

  error?: NormalizedError;
}

export function stripUrlSecrets(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth/i.test(key))
        url.searchParams.set(key, "[REDACTED]");
    }
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    return url.toString();
  } catch {
    return rawUrl.replace(
      /(api[_-]?key|token|secret)=([^&]+)/gi,
      "$1=[REDACTED]",
    );
  }
}

export function exceptionFrom(error: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) {
    const withCause = error as Error & { code?: string; cause?: unknown };
    return {
      name: error.name,
      code: withCause.code,
      message: error.message,
      cause:
        withCause.cause instanceof Error
          ? withCause.cause.message
          : withCause.cause
            ? String(withCause.cause)
            : undefined,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
