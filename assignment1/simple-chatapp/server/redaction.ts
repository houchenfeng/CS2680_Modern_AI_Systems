const SENSITIVE_KEY =
  /^(authorization|x-api-key|anthropic_auth_token|anthropic_api_key|api[_-]?key|token)$/i;
const SECRET_VALUE =
  /(?:sk-[A-Za-z0-9._-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})/gi;
/** Soft cap for accidental megabyte dumps; UI still folds at 64KiB via evidence-store. */
const MAX_STRING_LENGTH = 16 * 1024 * 1024;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    const sanitized = value.replace(SECRET_VALUE, "[REDACTED]");
    if (sanitized.length <= MAX_STRING_LENGTH) return sanitized;
    return {
      text: sanitized.slice(0, MAX_STRING_LENGTH),
      truncated: true,
      originalLength: sanitized.length,
    };
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(nested),
      ]),
    );
  }
  return value;
}

export function normalizeError(
  error: unknown,
  source: import("./events.js").ErrorSource,
) {
  const candidate = error instanceof Error ? error : new Error(String(error));
  return redact({
    name: candidate.name,
    message: candidate.message,
    stack: candidate.stack,
    source,
  }) as import("./events.js").NormalizedError;
}
