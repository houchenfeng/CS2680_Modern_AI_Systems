import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { redact } from "./redaction.js";
import { callUsageFromProvider, type CallUsage } from "./events.js";

const SENSITIVE_HEADER =
  /^(authorization|x-api-key|cookie|set-cookie|proxy-authorization)$/i;

export interface ObservedRequestArtifact {
  callId: string;
  parentCallId?: string;
  sdkSessionId?: string;
  chatId?: string;
  runId?: string;
  method: string;
  path: string;
  model?: string;
  stream?: boolean;
  system?: unknown;
  tools?: unknown;
  messages?: unknown;
  requestHash: string;
  requestBytes: number;
  redactedBody: unknown;
  /** In-memory only for count-tokens; never persisted to trajectory. */
  countingBody?: Record<string, unknown> | null;
  queuedAt: string;
  sentAt: string;
  firstByteAt?: string;
  completedAt?: string;
  statusCode?: number;
  providerRequestId?: string;
  callUsage?: CallUsage;
  responseHash?: string;
  responseBytes?: number;
  terminalReason?: string;
  error?: string;
  activeParentChain?: Array<{
    role?: string;
    blockTypes?: string[];
    toolUseIds?: string[];
  }>;
}

export type ObservationListener = (
  artifact: ObservedRequestArtifact,
  phase: "request" | "response" | "error" | "bypass",
) => void | Promise<void>;

export interface ObservationProxyOptions {
  upstreamBaseUrl: string;
  host?: string;
  port?: number;
  onObservation?: ObservationListener;
  context?: {
    chatId?: string;
    runId?: string;
    sdkSessionId?: string;
  };
  /** When true, refuse to start SDK without a healthy proxy (fail closed). */
  failClosed?: boolean;
}

function normalizeUpstream(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/u, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function stripSensitiveHeaders(
  headers:
    IncomingMessage["headers"] | Record<string, string | string[] | undefined>,
) {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER.test(key)) continue;
    if (/secret|token|api[-_]?key/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function forwardHeaders(
  headers: IncomingMessage["headers"],
  host: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (key.toLowerCase() === "host") {
      out.host = host;
      continue;
    }
    if (key.toLowerCase() === "content-length") continue;
    out[key] = Array.isArray(value) ? value.join(",") : value;
  }
  return out;
}

function sha256(buffer: Buffer | string) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parentChainFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    const record = message as {
      role?: string;
      content?: unknown;
    };
    const content = record.content;
    const blocks = Array.isArray(content) ? content : [];
    return {
      role: record.role,
      blockTypes: blocks.map((block) =>
        block && typeof block === "object"
          ? String((block as { type?: string }).type || "unknown")
          : typeof content,
      ),
      toolUseIds: blocks
        .map((block) => {
          if (!block || typeof block !== "object") return undefined;
          const item = block as {
            type?: string;
            id?: string;
            tool_use_id?: string;
          };
          if (item.type === "tool_use") return item.id;
          if (item.type === "tool_result") return item.tool_use_id;
          return undefined;
        })
        .filter((id): id is string => Boolean(id)),
    };
  });
}

function parseJsonBody(raw: Buffer): unknown {
  if (!raw.length) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return { _unparsed: true, preview: raw.toString("utf8").slice(0, 2_000) };
  }
}

function extractUsageFromSse(text: string): CallUsage | undefined {
  const matches = [...text.matchAll(/data:\s*(\{.*\})/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(matches[index][1]);
      if (
        payload?.usage ||
        payload?.message?.usage ||
        payload?.type === "message_delta"
      ) {
        const usage =
          payload.usage || payload.message?.usage || payload.delta?.usage;
        if (usage) return callUsageFromProvider(usage, "sse");
      }
      if (payload?.type === "message_stop" && payload?.usage) {
        return callUsageFromProvider(payload.usage, "sse");
      }
    } catch {
      // continue scanning
    }
  }
  return undefined;
}

function extractProviderRequestId(
  headers: Headers | Record<string, string | string[] | undefined>,
  bodyText: string,
) {
  const headerValue =
    headers instanceof Headers
      ? headers.get("request-id") ||
        headers.get("x-request-id") ||
        headers.get("anthropic-organization-id")
      : (headers["request-id"] as string | undefined) ||
        (headers["x-request-id"] as string | undefined);
  if (headerValue) return headerValue;
  const match = bodyText.match(/"id"\s*:\s*"(msg_[^"]+)"/);
  return match?.[1];
}

export class ObservationProxy {
  private server: Server | null = null;
  private readonly upstreamRoot: string;
  private readonly onObservation?: ObservationListener;
  private context: ObservationProxyOptions["context"];
  private lastCallId?: string;
  readonly failClosed: boolean;
  private bypassed = false;

  constructor(private readonly options: ObservationProxyOptions) {
    this.upstreamRoot = normalizeUpstream(options.upstreamBaseUrl);
    this.onObservation = options.onObservation;
    this.context = options.context || {};
    this.failClosed = Boolean(options.failClosed);
  }

  setContext(context: ObservationProxyOptions["context"]) {
    this.context = { ...this.context, ...context };
  }

  get baseUrl() {
    if (!this.server) throw new Error("Observation proxy is not listening");
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Observation proxy has no TCP address");
    }
    const host = this.options.host || "127.0.0.1";
    return `http://${host}:${address.port}`;
  }

  get isBypassed() {
    return this.bypassed;
  }

  async start() {
    if (this.server) return this.baseUrl;
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    const host = this.options.host || "127.0.0.1";
    const port = this.options.port ?? 0;
    this.server.listen(port, host);
    await once(this.server, "listening");
    return this.baseUrl;
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async emit(
    artifact: ObservedRequestArtifact,
    phase: "request" | "response" | "error" | "bypass",
  ) {
    await this.onObservation?.(artifact, phase);
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async markBypass(
    reason: string,
    partial?: Partial<ObservedRequestArtifact>,
  ) {
    this.bypassed = true;
    const artifact: ObservedRequestArtifact = {
      callId: partial?.callId || `bypass-${randomUUID()}`,
      method: partial?.method || "UNKNOWN",
      path: partial?.path || "/",
      requestHash: partial?.requestHash || "",
      requestBytes: partial?.requestBytes || 0,
      redactedBody: partial?.redactedBody ?? null,
      queuedAt: partial?.queuedAt || new Date().toISOString(),
      sentAt: partial?.sentAt || new Date().toISOString(),
      terminalReason: "observability_bypass",
      error: reason,
      chatId: this.context?.chatId,
      runId: this.context?.runId,
      sdkSessionId: this.context?.sdkSessionId,
      ...partial,
    };
    await this.emit(artifact, "bypass");
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const queuedAt = new Date().toISOString();
    const method = req.method || "GET";
    const pathWithQuery = req.url || "/";
    const isCountTokens = pathWithQuery.startsWith("/v1/messages/count_tokens");
    const isMessageApi = pathWithQuery.startsWith("/v1/messages");

    let requestBody: Buffer = Buffer.alloc(0);
    let callId = `call-${randomUUID()}`;
    let artifact: ObservedRequestArtifact | undefined;

    try {
      requestBody = Buffer.from(await this.readBody(req));
      const parsed = parseJsonBody(requestBody);
      const record =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
      const parentCallId = this.lastCallId;
      if (isMessageApi && !isCountTokens) {
        this.lastCallId = callId;
      } else {
        callId = `count-${randomUUID()}`;
      }

      artifact = {
        callId,
        parentCallId: isCountTokens ? undefined : parentCallId,
        chatId: this.context?.chatId,
        runId: this.context?.runId,
        sdkSessionId: this.context?.sdkSessionId,
        method,
        path: pathWithQuery,
        model: typeof record.model === "string" ? record.model : undefined,
        stream: Boolean(record.stream),
        system: record.system,
        tools: record.tools,
        messages: record.messages,
        requestHash: sha256(requestBody),
        requestBytes: requestBody.byteLength,
        redactedBody: redact(parsed),
        countingBody:
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null,
        queuedAt,
        sentAt: new Date().toISOString(),
        activeParentChain: parentChainFromMessages(record.messages),
      };

      if (isMessageApi) {
        await this.emit(artifact, "request");
      }

      const upstreamUrl = new URL(pathWithQuery, `${this.upstreamRoot}/`);
      const sentAt = new Date().toISOString();
      artifact.sentAt = sentAt;

      const upstream = await fetch(upstreamUrl, {
        method,
        headers: forwardHeaders(req.headers, upstreamUrl.host),
        body:
          method === "GET" || method === "HEAD"
            ? undefined
            : new Uint8Array(requestBody),
      });

      const firstByteAt = new Date().toISOString();
      artifact.firstByteAt = firstByteAt;
      artifact.statusCode = upstream.status;
      const responseHeaders = Object.fromEntries(upstream.headers.entries());
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (SENSITIVE_HEADER.test(key)) continue;
        res.setHeader(key, value);
      }
      res.statusCode = upstream.status;

      const contentType = upstream.headers.get("content-type") || "";
      const isEventStream = contentType.includes("text/event-stream");

      if (!upstream.body) {
        const text = await upstream.text();
        artifact.completedAt = new Date().toISOString();
        artifact.responseBytes = Buffer.byteLength(text);
        artifact.responseHash = sha256(text);
        artifact.providerRequestId = extractProviderRequestId(
          upstream.headers,
          text,
        );
        if (!isEventStream) {
          try {
            const json = JSON.parse(text);
            artifact.callUsage = callUsageFromProvider(json.usage, "response");
          } catch {
            // non-json
          }
        }
        await this.emit(artifact, "response");
        res.end(text);
        return;
      }

      const reader = upstream.body.getReader();
      const chunks: Buffer[] = [];
      let firstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        if (firstChunk) {
          artifact.firstByteAt = new Date().toISOString();
          firstChunk = false;
        }
        chunks.push(buffer);
        // Stream through immediately — do not wait for full response.
        res.write(buffer);
      }
      res.end();

      const responseBuffer = Buffer.concat(chunks);
      const responseText = responseBuffer.toString("utf8");
      artifact.completedAt = new Date().toISOString();
      artifact.responseBytes = responseBuffer.byteLength;
      artifact.responseHash = sha256(responseBuffer);
      artifact.providerRequestId = extractProviderRequestId(
        upstream.headers,
        responseText,
      );
      if (isEventStream) {
        artifact.callUsage = extractUsageFromSse(responseText);
      } else {
        try {
          const json = JSON.parse(responseText);
          artifact.callUsage = callUsageFromProvider(json.usage, "response");
        } catch {
          // ignore
        }
      }
      artifact.terminalReason = "completed";
      if (isMessageApi) await this.emit(artifact, "response");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (artifact) {
        artifact.completedAt = new Date().toISOString();
        artifact.error = message;
        artifact.terminalReason =
          message.includes("abort") || message.includes("Abort")
            ? "client_abort"
            : message.includes("ENOTFOUND")
              ? "dns_error"
              : message.includes("timeout")
                ? "upstream_timeout"
                : "upstream_error";
        await this.emit(artifact, "error");
      }
      await this.markBypass(message, artifact);
      if (!res.headersSent) {
        res.statusCode = this.failClosed ? 502 : 502;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              type: "observability_proxy_error",
              message,
              observability_bypass: true,
            },
          }),
        );
      } else {
        res.end();
      }
    }
  }
}

export async function startObservationProxy(options: ObservationProxyOptions) {
  const proxy = new ObservationProxy(options);
  await proxy.start();
  return proxy;
}

export function proxyEnv(
  baseEnv: NodeJS.ProcessEnv,
  proxyBaseUrl: string,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  // Keep real credentials; only rewrite the base URL seen by the SDK subprocess.
  env.ANTHROPIC_BASE_URL = proxyBaseUrl;
  env.ANTHROPIC_AUTH_TOKEN =
    env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "";
  return env;
}

export const __test = {
  stripSensitiveHeaders,
  sha256,
  parentChainFromMessages,
  extractUsageFromSse,
  normalizeUpstream,
};
