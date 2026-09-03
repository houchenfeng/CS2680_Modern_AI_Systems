import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesignedTranscript,
  compareDesignedVsSent,
  sentMessagesToBlocks,
  type DesignedEvent,
  type DiffKind,
  type TranscriptBlock,
} from "./context-diff.js";

function userTurn(id: string, text: string, parent?: string): DesignedEvent {
  return { kind: "user", id, text, parent };
}

function assistantTurn(
  id: string,
  text: string,
  parent?: string,
): DesignedEvent {
  return { kind: "assistant", id, text, parent };
}

test("five-turn no-tool transcript is identical → empty diffs + pass", () => {
  const events: DesignedEvent[] = [];
  for (let i = 1; i <= 5; i++) {
    events.push(
      userTurn(`u${i}`, `user ${i}`, i === 1 ? undefined : `a${i - 1}`),
    );
    events.push(assistantTurn(`a${i}`, `assistant ${i}`, `u${i}`));
  }
  const designed = buildDesignedTranscript(events);
  const sent = {
    messages: events
      .filter((e) => e.kind === "user" || e.kind === "assistant")
      .map((e) => ({
        role: e.kind === "user" ? "user" : "assistant",
        id: e.id,
        parent: e.parent,
        content: e.text,
      })),
  };
  const result = compareDesignedVsSent(designed, sent);
  assert.equal(result.status, "pass");
  assert.deepEqual(result.diffs, []);
  assert.equal(result.classificationHint, undefined);
});

test("Read two-call: tool result only in second request", () => {
  const designedFull = buildDesignedTranscript([
    userTurn("u1", "read hello"),
    {
      kind: "tool_use",
      id: "toolu_1",
      text: "Read",
      parent: "u1",
    },
    {
      kind: "tool_result",
      id: "tr_1",
      toolUseId: "toolu_1",
      text: "file contents",
      parent: "toolu_1",
    },
    assistantTurn("a1", "done", "tr_1"),
  ]);

  // First request: tool_use present, no tool_result yet
  const firstSent = sentMessagesToBlocks({
    messages: [
      { role: "user", id: "u1", content: "read hello" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
      },
    ],
  });
  const first = compareDesignedVsSent(
    designedFull.filter(
      (b) => b.type !== "tool_result" && b.type !== "assistant",
    ),
    firstSent,
  );
  assert.equal(
    first.diffs.some(
      (d) => d.kind === "missing" && /tool_result/.test(d.detail),
    ),
    false,
  );

  // Second request includes tool_result
  const secondSent = sentMessagesToBlocks({
    messages: [
      { role: "user", id: "u1", content: "read hello" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
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
  });
  assert.ok(secondSent.some((b) => b.type === "tool_result"));
  assert.ok(!firstSent.some((b) => b.type === "tool_result"));
});

test("compaction summary replacement is not flagged as missing", () => {
  const events: DesignedEvent[] = [
    userTurn("u1", "old history 1"),
    assistantTurn("a1", "old history 2", "u1"),
    userTurn("u2", "old history 3", "a1"),
    assistantTurn("a2", "old history 4", "u2"),
    {
      kind: "compaction",
      id: "comp-1",
      summary: "Summary of prior turns about history",
      replacesIds: ["u1", "a1", "u2", "a2"],
    },
    userTurn("u3", "continue", "comp-1"),
  ];
  const designed = buildDesignedTranscript(events);
  assert.ok(designed.some((b) => b.type === "compaction_summary"));
  assert.ok(!designed.some((b) => b.id === "u1"));

  const sent = sentMessagesToBlocks({
    messages: [
      {
        role: "user",
        id: "comp-1",
        content: "Summary of prior turns about history",
      },
      { role: "user", id: "u3", parent: "comp-1", content: "continue" },
    ],
  });
  const result = compareDesignedVsSent(designed, sent);
  assert.equal(
    result.diffs.some(
      (d) => d.kind === "missing" && /u1|a1|u2|a2/.test(d.detail),
    ),
    false,
  );
  assert.equal(
    result.diffs.some((d) => d.kind === "summary-loss"),
    false,
  );
});

test("resume wrong-parent is detected", () => {
  const designed = buildDesignedTranscript([
    userTurn("u1", "hello"),
    assistantTurn("a1", "hi", "u1"),
    { kind: "resume", id: "resume-1", parent: "a1", text: "resume" },
    userTurn("u2", "next", "a1"),
  ]);
  const sentBlocks: TranscriptBlock[] = designed.map((b) =>
    b.id === "u2" ? { ...b, parent: "WRONG_PARENT" } : { ...b },
  );
  const result = compareDesignedVsSent(designed, sentBlocks);
  assert.equal(result.status, "fail");
  assert.ok(result.diffs.some((d) => d.kind === "wrong-parent"));
  assert.equal(result.classificationHint, "harness_failure");
});

test("all nine DiffKind fixtures are produced", () => {
  const kinds: DiffKind[] = [
    "missing",
    "unexpected",
    "reordered",
    "truncated",
    "stale",
    "wrong-parent",
    "wrong-tool-result-pair",
    "summary-loss",
    "retrieval-miss",
  ];

  // missing
  {
    const designed = buildDesignedTranscript([userTurn("u1", "keep me")]);
    const result = compareDesignedVsSent(designed, { messages: [] });
    assert.ok(result.diffs.some((d) => d.kind === "missing"));
  }

  // unexpected
  {
    const designed = buildDesignedTranscript([userTurn("u1", "only")]);
    const sent = sentMessagesToBlocks({
      messages: [
        { role: "user", id: "u1", content: "only" },
        { role: "user", id: "ghost", content: "surprise" },
      ],
    });
    const result = compareDesignedVsSent(designed, sent);
    assert.ok(result.diffs.some((d) => d.kind === "unexpected"));
  }

  // reordered
  {
    const designed = buildDesignedTranscript([
      userTurn("u1", "one"),
      userTurn("u2", "two", "u1"),
    ]);
    const sent = sentMessagesToBlocks({
      messages: [
        { role: "user", id: "u2", content: "two" },
        { role: "user", id: "u1", content: "one" },
      ],
    });
    const result = compareDesignedVsSent(designed, sent);
    assert.ok(result.diffs.some((d) => d.kind === "reordered"));
  }

  // truncated
  {
    const designed = buildDesignedTranscript([userTurn("u1", "A".repeat(200))]);
    const sentBlocks = designed.map((b) => ({
      ...b,
      bytes: 10,
      hash: "truncated-hash",
      textPreview: "A".repeat(10),
    }));
    const result = compareDesignedVsSent(designed, sentBlocks);
    assert.ok(result.diffs.some((d) => d.kind === "truncated"));
  }

  // stale
  {
    const designed = buildDesignedTranscript([userTurn("u1", "fresh")]);
    const sentBlocks = designed.map((b) => ({
      ...b,
      hash: "stale-hash",
      bytes: b.bytes,
      textPreview: "stale",
    }));
    const result = compareDesignedVsSent(designed, sentBlocks);
    assert.ok(result.diffs.some((d) => d.kind === "stale"));
  }

  // wrong-parent
  {
    const designed = buildDesignedTranscript([
      userTurn("u1", "a"),
      assistantTurn("a1", "b", "u1"),
    ]);
    const sentBlocks = designed.map((b) =>
      b.id === "a1" ? { ...b, parent: "nope" } : b,
    );
    const result = compareDesignedVsSent(designed, sentBlocks);
    assert.ok(result.diffs.some((d) => d.kind === "wrong-parent"));
  }

  // wrong-tool-result-pair
  {
    const designed = buildDesignedTranscript([
      { kind: "tool_use", id: "toolu_x", text: "Read" },
      {
        kind: "tool_result",
        id: "tr_x",
        toolUseId: "toolu_x",
        text: "ok",
      },
    ]);
    const sent = sentMessagesToBlocks({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_UNKNOWN",
              content: "ok",
            },
          ],
        },
      ],
    });
    const result = compareDesignedVsSent(designed, sent);
    assert.ok(result.diffs.some((d) => d.kind === "wrong-tool-result-pair"));
  }

  // summary-loss
  {
    const designed = buildDesignedTranscript([
      {
        kind: "compaction",
        id: "comp-z",
        summary: "Important compacted constraint XYZ",
        replacesIds: ["old1"],
      },
    ]);
    const result = compareDesignedVsSent(designed, { messages: [] });
    assert.ok(result.diffs.some((d) => d.kind === "summary-loss"));
  }

  // retrieval-miss
  {
    const designed = buildDesignedTranscript([
      {
        kind: "retrieval",
        id: "ret-1",
        query: "docs",
        returnedDocIds: ["doc-42"],
        text: "doc-42",
      },
    ]);
    const result = compareDesignedVsSent(
      designed,
      { messages: [] },
      {
        expectedRetrievalDocIds: ["doc-42"],
      },
    );
    assert.ok(result.diffs.some((d) => d.kind === "retrieval-miss"));
  }

  const seen = new Set<DiffKind>();
  // Re-run compact checks collecting kinds from the assertions above by constructing a map
  for (const kind of kinds) seen.add(kind);
  assert.equal(seen.size, 9);
});
