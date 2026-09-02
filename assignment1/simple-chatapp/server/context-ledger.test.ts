import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_CONTEXT_RULE_VERSION,
  COVERAGE_GATE,
  buildContextLedger,
  buildLadderBodies,
  computeCoverage,
} from "./context-ledger.js";
import type { CountTokensResult } from "./token-counter.js";
import { CONTEXT_RULE_VERSION } from "./trace-analysis.js";

/** Current-model first-round regression fixture (deepseek-v4-pro-0813). */
const FIXTURE = {
  total: 6902,
  toolSurface: 6053,
  claudeMd: 694,
  applicationSystem: 29,
  apiFraming: 96,
  user: 10,
  sdkFraming: 20,
} as const;

const FIXTURE_LADDER = {
  C0: FIXTURE.apiFraming,
  C1: FIXTURE.apiFraming + FIXTURE.applicationSystem,
  C2: FIXTURE.apiFraming + FIXTURE.applicationSystem + FIXTURE.claudeMd,
  C3:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface,
  C4:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface +
    FIXTURE.user,
  C5:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface +
    FIXTURE.user,
  C6:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface +
    FIXTURE.user,
  C7:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface +
    FIXTURE.user,
  C7b:
    FIXTURE.apiFraming +
    FIXTURE.applicationSystem +
    FIXTURE.claudeMd +
    FIXTURE.toolSurface +
    FIXTURE.user +
    FIXTURE.sdkFraming,
  C8: FIXTURE.total,
} as const;

function mockCountTokensFromLadder(
  bodies: ReturnType<typeof buildLadderBodies>,
) {
  const expected = new Map<string, number>();
  for (const step of [
    "C0",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
    "C7b",
    "C8",
  ] as const) {
    expected.set(JSON.stringify(bodies[step]), FIXTURE_LADDER[step]);
  }
  return async (
    requestBody: Record<string, unknown>,
  ): Promise<CountTokensResult> => {
    const key = JSON.stringify(requestBody);
    const inputTokens = expected.get(key);
    if (inputTokens === undefined) {
      return {
        inputTokens: null,
        measurement: "unavailable",
        raw: { unmatched: true, body: requestBody },
        attempts: 1,
        error: "unmatched ladder body",
      };
    }
    return {
      inputTokens,
      measurement: "reported",
      raw: { input_tokens: inputTokens },
      attempts: 1,
    };
  };
}

test("call ledger rule version is dedicated and does not alter CSV CONTEXT_RULE_VERSION", () => {
  assert.equal(CALL_CONTEXT_RULE_VERSION, "call-1.0.0");
  assert.equal(CONTEXT_RULE_VERSION, "1.1.0");
});

test("fixed regression fixture: first-round provenance matches measured shares", async () => {
  const applicationSystem =
    "You are a helpful coding assistant operating only inside the configured working directory.";
  const projectInstructions =
    "# Project\n".padEnd(2_000, "x") + "\nUse relative paths.";
  const capturedRequest = {
    model: "deepseek-v4-pro-0813",
    system: `${applicationSystem}\n\n---\nProject instructions from CLAUDE.md:\n${projectInstructions}\n\n[sdk-framing-marker]`,
    tools: [
      {
        name: "Read",
        description: "Read a file",
        input_schema: { type: "object" },
      },
      {
        name: "Write",
        description: "Write a file",
        input_schema: { type: "object" },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Reply with exactly OK. Do not use tools.",
      },
    ],
  };

  const bodies = buildLadderBodies({
    capturedRequest,
    applicationSystem,
    projectInstructions,
  });
  assert.notEqual(
    JSON.stringify(bodies.C7.system),
    JSON.stringify(bodies.C7b.system),
    "captured system must differ so SDK framing is isolated at C7b",
  );

  const ledger = await buildContextLedger({
    capturedRequest,
    applicationSystem,
    projectInstructions,
    reportedUsage: {
      uncachedInputTokens: FIXTURE.total,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      logicalInputTokens: FIXTURE.total,
      outputTokens: 2,
      measurement: "reported",
    },
    countTokensFn: mockCountTokensFromLadder(bodies),
  });

  const byId = Object.fromEntries(
    ledger.sources.map((source) => [source.id, source]),
  );

  assert.equal(ledger.ladder.C8, FIXTURE.total);
  assert.equal(byId.tool_definitions.tokens, FIXTURE.toolSurface);
  assert.equal(byId.project_instructions.tokens, FIXTURE.claudeMd);
  assert.equal(byId.application_system.tokens, FIXTURE.applicationSystem);
  assert.equal(byId.api_framing.tokens, FIXTURE.apiFraming);
  assert.equal(byId.user_messages.tokens, FIXTURE.user);
  assert.equal(byId.sdk_framing.tokens, FIXTURE.sdkFraming);

  assert.ok(Math.abs((byId.tool_definitions.share ?? 0) - 0.877) < 0.001);
  assert.ok(Math.abs((byId.project_instructions.share ?? 0) - 0.1006) < 0.001);
  assert.ok(Math.abs((byId.application_system.share ?? 0) - 0.0042) < 0.001);

  assert.equal(ledger.provenanceTotal, FIXTURE.total);
  assert.equal(ledger.provenanceTotal, ledger.ladder.C8);
  assert.equal(ledger.coverage.coverage, 1);
  assert.equal(ledger.coverage.passesGate, true);
  assert.equal(ledger.coverage.authoritative, true);
  assert.equal(ledger.ladderMeasurement, "reported");
});

test("coverage is null when provider usage is missing — never fake 100%", async () => {
  const capturedRequest = {
    model: "deepseek-v4-pro-0813",
    messages: [{ role: "user", content: "hi" }],
  };
  const ledger = await buildContextLedger({
    capturedRequest,
    applicationSystem: "sys",
    reportedUsage: null,
    countTokensFn: async () => ({
      inputTokens: 100,
      measurement: "reported",
      raw: { input_tokens: 100 },
      attempts: 1,
    }),
  });
  assert.equal(ledger.coverage.coverage, null);
  assert.equal(ledger.coverage.passesGate, null);
  assert.equal(ledger.coverage.authoritative, false);
  assert.equal(ledger.coverage.reason, "provider_usage_missing");
});

test("estimated countTokens results do not enter authoritative coverage", async () => {
  const coverage = computeCoverage({
    reportedUsage: {
      uncachedInputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      logicalInputTokens: 100,
      outputTokens: 1,
      measurement: "reported",
    },
    countedFullRequest: 100,
    countMeasurement: "estimated",
    requestHash: "abc",
  });
  assert.equal(coverage.coverage, null);
  assert.equal(coverage.authoritative, false);
  assert.equal(coverage.reason, "count_tokens_estimated_not_authoritative");
  assert.equal(coverage.requestHash, "abc");
});

test("coverage below gate keeps residual and reason with request hash", () => {
  const coverage = computeCoverage({
    reportedUsage: {
      uncachedInputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      logicalInputTokens: 1000,
      outputTokens: 1,
      measurement: "reported",
    },
    countedFullRequest: 800,
    countMeasurement: "reported",
    requestHash: "req-hash-1",
  });
  assert.equal(coverage.residual, 200);
  assert.ok((coverage.coverage as number) < COVERAGE_GATE);
  assert.equal(coverage.passesGate, false);
  assert.equal(coverage.requestHash, "req-hash-1");
  assert.match(String(coverage.reason), /coverage_below_gate/);
});

test("thinking attribution only keeps blocks present on the captured request", () => {
  const bodies = buildLadderBodies({
    capturedRequest: {
      model: "deepseek-v4-pro-0813",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "visible-only" },
            { type: "text", text: "hello" },
            { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "file contents",
            },
          ],
        },
      ],
    },
    applicationSystem: "app",
  });

  const assistantBlocks = (
    bodies.C5.messages as Array<{
      role: string;
      content: Array<{ type?: string }>;
    }>
  )
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content.map((block) => block.type));
  assert.deepEqual(assistantBlocks.sort(), ["text", "thinking"].sort());
  assert.ok(!assistantBlocks.includes("tool_use"));
  assert.ok(
    !(bodies.C5.messages as Array<{ content: Array<{ type?: string }> }>)
      .flatMap((message) => message.content.map((block) => block.type))
      .includes("tool_use"),
  );

  const c6Types = (
    bodies.C6.messages as Array<{ content: Array<{ type?: string }> }>
  ).flatMap((message) => message.content.map((block) => block.type));
  assert.ok(c6Types.includes("tool_use"));

  const c7Types = (
    bodies.C7.messages as Array<{ content: Array<{ type?: string }> }>
  ).flatMap((message) => message.content.map((block) => block.type));
  assert.ok(c7Types.includes("tool_result"));
});
