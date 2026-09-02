import type { Measurement } from "./events.js";

export type { Measurement };

export interface CountTokensResult {
  inputTokens: number | null;
  measurement: Measurement;
  raw: unknown;
  attempts: number;
  error?: string;
}

export interface CountTokensOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  /** Used only when the count endpoint fails after retries. */
  estimateFn?: (requestBody: Record<string, unknown>) => number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/u, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function resolveEndpoint(baseUrl?: string) {
  const raw =
    baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  return `${normalizeBaseUrl(raw)}/messages/count_tokens`;
}

function resolveApiKey(apiKey?: string) {
  return (
    apiKey ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    ""
  );
}

/** Byte/4 heuristic — never treated as authoritative coverage input. */
export function estimateInputTokens(requestBody: Record<string, unknown>) {
  const serialized = JSON.stringify(requestBody ?? {});
  return Math.ceil(Buffer.byteLength(serialized, "utf8") / 4);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mergeSignals(
  timeoutMs: number,
  outer?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Call upstream `/v1/messages/count_tokens` with retry/timeout.
 * On total failure, degrade to an estimate (measurement="estimated") so callers
 * can still show rough sizes — estimates must not enter authoritative coverage.
 */
export async function countTokens(
  requestBody: Record<string, unknown>,
  options: CountTokensOptions = {},
): Promise<CountTokensResult> {
  const endpoint = resolveEndpoint(options.baseUrl);
  const apiKey = resolveApiKey(options.apiKey);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchFn = options.fetchFn ?? fetch;
  const estimateFn = options.estimateFn ?? estimateInputTokens;

  const body = {
    model: requestBody.model,
    messages: requestBody.messages,
    ...(requestBody.system !== undefined ? { system: requestBody.system } : {}),
    ...(requestBody.tools !== undefined ? { tools: requestBody.tools } : {}),
    ...(requestBody.tool_choice !== undefined
      ? { tool_choice: requestBody.tool_choice }
      : {}),
  };

  let attempts = 0;
  let lastError = "count_tokens failed";
  let lastRaw: unknown = null;

  while (attempts <= maxRetries) {
    attempts += 1;
    const { signal, clear } = mergeSignals(timeoutMs, options.signal);
    try {
      if (!apiKey && !options.fetchFn) {
        throw new Error("ANTHROPIC_API_KEY is not set");
      }
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
      const raw = await response.json().catch(() => ({}));
      lastRaw = raw;
      if (!response.ok) {
        const message =
          (raw as { error?: { message?: string } })?.error?.message ||
          `HTTP ${response.status}`;
        lastError = message;
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          break;
        }
      } else {
        const inputTokens = Number(
          (raw as { input_tokens?: unknown }).input_tokens,
        );
        if (!Number.isFinite(inputTokens)) {
          lastError = "count_tokens response missing input_tokens";
        } else {
          clear();
          return {
            inputTokens,
            measurement: "reported",
            raw,
            attempts,
          };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      lastRaw = { error: lastError };
    } finally {
      clear();
    }
    if (attempts <= maxRetries) {
      await sleep(Math.min(250 * 2 ** (attempts - 1), 2_000));
    }
  }

  const estimated = estimateFn(body);
  return {
    inputTokens: estimated,
    measurement: "estimated",
    raw: lastRaw,
    attempts,
    error: lastError,
  };
}
