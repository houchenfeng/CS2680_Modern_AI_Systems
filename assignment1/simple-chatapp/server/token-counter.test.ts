import assert from "node:assert/strict";
import test from "node:test";
import { countTokens, estimateInputTokens } from "./token-counter.js";

test("countTokens returns reported measurement on successful upstream response", async () => {
  const result = await countTokens(
    {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "hi" }],
    },
    {
      apiKey: "sk-test",
      baseUrl: "http://count-tokens.test/v1",
      fetchFn: async () =>
        new Response(JSON.stringify({ input_tokens: 42 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );
  assert.equal(result.inputTokens, 42);
  assert.equal(result.measurement, "reported");
  assert.equal(result.attempts, 1);
  assert.equal((result.raw as { input_tokens: number }).input_tokens, 42);
  assert.equal(result.error, undefined);
});

test("countTokens retries then degrades to estimated without pretending reported", async () => {
  let calls = 0;
  const result = await countTokens(
    {
      model: "deepseek-v4-pro-0813",
      system: "You are concise.",
      messages: [{ role: "user", content: "Reply OK." }],
    },
    {
      apiKey: "sk-test",
      baseUrl: "http://count-tokens.test",
      maxRetries: 2,
      timeoutMs: 1_000,
      fetchFn: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ error: { message: "upstream down" } }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  );
  assert.equal(calls, 3);
  assert.equal(result.measurement, "estimated");
  assert.equal(typeof result.inputTokens, "number");
  assert.ok((result.inputTokens as number) > 0);
  assert.match(String(result.error), /upstream down|HTTP 503/);
  assert.equal(result.attempts, 3);
});

test("countTokens times out and falls back to estimate", async () => {
  const result = await countTokens(
    {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "slow" }],
    },
    {
      apiKey: "sk-test",
      maxRetries: 0,
      timeoutMs: 20,
      fetchFn: async (_url, init) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
            },
            { once: true },
          );
        });
        return new Response(JSON.stringify({ input_tokens: 1 }), {
          status: 200,
        });
      },
    },
  );
  assert.equal(result.measurement, "estimated");
  assert.ok(result.error);
  assert.equal(result.attempts, 1);
});

test("estimateInputTokens is deterministic byte/4 heuristic", () => {
  const body = {
    model: "deepseek-v4-pro-0813",
    messages: [{ role: "user", content: "abcd" }],
  };
  assert.equal(
    estimateInputTokens(body),
    Math.ceil(Buffer.byteLength(JSON.stringify(body), "utf8") / 4),
  );
});

test("countTokens preserves raw evidence payload", async () => {
  const raw = { input_tokens: 7, model: "deepseek-v4-pro-0813" };
  const result = await countTokens(
    {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "x" }],
    },
    {
      apiKey: "sk-test",
      fetchFn: async () =>
        new Response(JSON.stringify(raw), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );
  assert.deepEqual(result.raw, raw);
});
