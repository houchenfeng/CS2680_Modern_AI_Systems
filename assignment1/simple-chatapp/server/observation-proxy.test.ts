import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  ObservationProxy,
  __test,
  proxyEnv,
  type ObservedRequestArtifact,
} from "./observation-proxy.js";

async function withUpstream(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("direct API and proxied API return equivalent content and usage", async () => {
  const payload = {
    id: "msg_test_1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "OK" }],
    usage: {
      input_tokens: 12,
      output_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };

  await withUpstream(
    (req, res) => {
      assert.equal(req.url, "/v1/messages");
      res.setHeader("content-type", "application/json");
      res.setHeader("request-id", "req_upstream_1");
      res.end(JSON.stringify(payload));
    },
    async (upstream) => {
      const direct = await fetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "sk-test-should-not-persist",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro-0813",
          max_tokens: 16,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const directJson = await direct.json();

      const artifacts: ObservedRequestArtifact[] = [];
      const proxy = new ObservationProxy({
        upstreamBaseUrl: upstream,
        onObservation: (artifact) => {
          artifacts.push({ ...artifact });
        },
      });
      const base = await proxy.start();
      const proxied = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "sk-test-should-not-persist",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro-0813",
          max_tokens: 16,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const proxiedJson = await proxied.json();
      await proxy.stop();

      assert.deepEqual(proxiedJson, directJson);
      assert.equal(
        proxiedJson.usage.input_tokens,
        directJson.usage.input_tokens,
      );
      const responseArtifact = artifacts.find(
        (item) => item.statusCode === 200 && item.callUsage,
      );
      assert.ok(responseArtifact);
      assert.equal(responseArtifact?.callUsage?.uncachedInputTokens, 12);
      assert.equal(responseArtifact?.providerRequestId, "req_upstream_1");
    },
  );
});

test("streaming first byte is forwarded without waiting for full response", async () => {
  await withUpstream(
    async (req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "request-id": "req_stream",
      });
      res.write('data: {"type":"message_start"}\n\n');
      await new Promise((resolve) => setTimeout(resolve, 40));
      res.write(
        'data: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}\n\n',
      );
      res.end();
    },
    async (upstream) => {
      const proxy = new ObservationProxy({ upstreamBaseUrl: upstream });
      const base = await proxy.start();
      const started = Date.now();
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          messages: [{ role: "user", content: "x" }],
        }),
      });
      const reader = response.body!.getReader();
      const first = await reader.read();
      const ttfb = Date.now() - started;
      assert.equal(first.done, false);
      assert.ok(ttfb < 200, `TTFB too high: ${ttfb}ms`);
      while (!(await reader.read()).done) {
        // drain
      }
      await proxy.stop();
    },
  );
});

test("request artifact never contains API key", async () => {
  await withUpstream(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 0 } }));
    },
    async (upstream) => {
      const artifacts: ObservedRequestArtifact[] = [];
      const proxy = new ObservationProxy({
        upstreamBaseUrl: upstream,
        onObservation: (artifact) => {
          artifacts.push(artifact);
        },
      });
      const base = await proxy.start();
      await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sk-super-secret-key-value",
          "x-api-key": "sk-super-secret-key-value",
        },
        body: JSON.stringify({
          model: "m",
          messages: [{ role: "user", content: "hello" }],
          tools: [{ name: "Read", input_schema: { type: "object" } }],
        }),
      });
      await proxy.stop();
      const serialized = JSON.stringify(artifacts);
      assert.doesNotMatch(serialized, /sk-super-secret-key-value/);
      assert.doesNotMatch(serialized, /Bearer sk-super/);
      assert.ok(artifacts[0]?.requestHash);
      assert.equal(typeof artifacts[0]?.redactedBody, "object");
    },
  );
});

test("two model calls capture distinct request hashes and parent chain", async () => {
  await withUpstream(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.setHeader("request-id", `req_${Math.random()}`);
      res.end(
        JSON.stringify({
          usage: {
            input_tokens: 3,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      );
    },
    async (upstream) => {
      const artifacts: ObservedRequestArtifact[] = [];
      const proxy = new ObservationProxy({
        upstreamBaseUrl: upstream,
        context: { sdkSessionId: "sdk-session-1", runId: "run-1" },
        onObservation: (artifact, phase) => {
          if (phase === "request") artifacts.push(artifact);
        },
      });
      const base = await proxy.start();
      await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          messages: [{ role: "user", content: "read file" }],
        }),
      });
      await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          messages: [
            { role: "user", content: "read file" },
            {
              role: "assistant",
              content: [
                { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
              ],
            },
            {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
              ],
            },
          ],
        }),
      });
      await proxy.stop();
      assert.equal(artifacts.length, 2);
      assert.notEqual(artifacts[0].callId, artifacts[1].callId);
      assert.notEqual(artifacts[0].requestHash, artifacts[1].requestHash);
      assert.equal(artifacts[1].parentCallId, artifacts[0].callId);
      assert.ok(
        artifacts[1].activeParentChain?.some((item) =>
          item.toolUseIds?.includes("toolu_1"),
        ),
      );
      assert.equal(artifacts[0].sdkSessionId, "sdk-session-1");
    },
  );
});

test("proxyEnv only rewrites base URL for the SDK subprocess", () => {
  const env = proxyEnv(
    {
      ANTHROPIC_BASE_URL: "https://upstream.example",
      ANTHROPIC_API_KEY: "secret",
      PATH: "/usr/bin",
    },
    "http://127.0.0.1:9999",
  );
  assert.equal(env.ANTHROPIC_BASE_URL, "http://127.0.0.1:9999");
  assert.equal(env.ANTHROPIC_API_KEY, "secret");
  assert.equal(__test.normalizeUpstream("https://x/v1/"), "https://x");
});

test("SSE text_delta marks firstVisible and firstUseful; tool_use alone is useful", () => {
  const textArtifact: ObservedRequestArtifact = {
    callId: "call-text",
    method: "POST",
    path: "/v1/messages",
    requestHash: "h1",
    requestBytes: 1,
    redactedBody: {},
    queuedAt: "2026-09-03T00:00:00.000Z",
    sentAt: "2026-09-03T00:00:00.010Z",
  };
  __test.noteSseOutputMarkers(
    textArtifact,
    [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
    ].join(""),
    "2026-09-03T00:00:00.200Z",
  );
  assert.equal(textArtifact.firstVisibleOutputAt, "2026-09-03T00:00:00.200Z");
  assert.equal(textArtifact.firstUsefulOutputAt, "2026-09-03T00:00:00.200Z");

  const toolArtifact: ObservedRequestArtifact = {
    callId: "call-tool",
    method: "POST",
    path: "/v1/messages",
    requestHash: "h2",
    requestBytes: 1,
    redactedBody: {},
    queuedAt: "2026-09-03T00:00:00.000Z",
    sentAt: "2026-09-03T00:00:00.010Z",
  };
  __test.noteSseOutputMarkers(
    toolArtifact,
    'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
    "2026-09-03T00:00:00.300Z",
  );
  assert.equal(toolArtifact.firstVisibleOutputAt, undefined);
  assert.equal(toolArtifact.firstUsefulOutputAt, "2026-09-03T00:00:00.300Z");
});
