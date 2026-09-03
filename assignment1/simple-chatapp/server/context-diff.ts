import { createHash } from "node:crypto";

export type DiffKind =
  | "missing"
  | "unexpected"
  | "reordered"
  | "truncated"
  | "stale"
  | "wrong-parent"
  | "wrong-tool-result-pair"
  | "summary-loss"
  | "retrieval-miss";

export interface TranscriptBlock {
  role: string;
  type: string;
  id?: string;
  parent?: string;
  order: number;
  hash: string;
  bytes: number;
  tokens?: number | null;
  retention: "keep" | "summarize" | "remove";
  toolUseId?: string;
  textPreview?: string;
}

export interface ContextDiffResult {
  status: "pass" | "fail";
  diffs: Array<{
    kind: DiffKind;
    designedRef?: string;
    sentRef?: string;
    detail: string;
  }>;
  designedRef?: string;
  sentRef?: string;
  classificationHint?: "harness_failure";
}

export interface DesignedEvent {
  kind:
    | "user"
    | "assistant"
    | "tool_use"
    | "tool_result"
    | "permission"
    | "hook"
    | "compaction"
    | "retrieval"
    | "resume";
  id?: string;
  parent?: string;
  toolUseId?: string;
  text?: string;
  summary?: string;
  replacesIds?: string[];
  retention?: "keep" | "summarize" | "remove";
  query?: string;
  candidateIds?: string[];
  returnedDocIds?: string[];
  tokens?: number | null;
}

export interface SentTranscriptInput {
  messages?: unknown[];
  system?: unknown;
  tools?: unknown;
  requestHash?: string;
}

function blockHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? null))
    .digest("hex");
}

function preview(text: string | undefined, n = 120) {
  if (!text) return undefined;
  return text.length <= n ? text : text.slice(0, n);
}

/**
 * Build the designed transcript from session events
 * (user/assistant/tool/permission/hook/compaction/retrieval/resume).
 */
export function buildDesignedTranscript(
  events: DesignedEvent[],
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let order = 0;
  const removed = new Set<string>();

  for (const event of events) {
    if (event.kind === "compaction" && event.replacesIds?.length) {
      for (const id of event.replacesIds) removed.add(id);
      const summaryText = event.summary ?? event.text ?? "";
      const payload = {
        kind: "compaction",
        summary: summaryText,
        replacesIds: event.replacesIds,
      };
      const serialized = JSON.stringify(payload);
      blocks.push({
        role: "system",
        type: "compaction_summary",
        id: event.id ?? `compaction-${order}`,
        parent: event.parent,
        order: order++,
        hash: blockHash(payload),
        bytes: Buffer.byteLength(serialized, "utf8"),
        tokens: event.tokens ?? null,
        retention: "keep",
        textPreview: preview(summaryText),
      });
      continue;
    }

    const type =
      event.kind === "tool_use"
        ? "tool_use"
        : event.kind === "tool_result"
          ? "tool_result"
          : event.kind === "permission"
            ? "permission"
            : event.kind === "hook"
              ? "hook"
              : event.kind === "retrieval"
                ? "retrieval"
                : event.kind === "resume"
                  ? "resume"
                  : event.kind === "assistant"
                    ? "text"
                    : "text";

    const role =
      event.kind === "assistant" || event.kind === "tool_use"
        ? "assistant"
        : event.kind === "tool_result"
          ? "user"
          : event.kind === "user"
            ? "user"
            : "system";

    const text = event.text ?? event.summary;
    const payload = {
      role,
      type,
      id: event.id,
      parent: event.parent,
      toolUseId: event.toolUseId,
      text,
    };
    const serialized = JSON.stringify(payload);
    blocks.push({
      role,
      type,
      id: event.id,
      parent: event.parent,
      order: order++,
      hash: blockHash(payload),
      bytes: Buffer.byteLength(serialized, "utf8"),
      tokens: event.tokens ?? null,
      retention: event.retention ?? "keep",
      toolUseId:
        event.toolUseId ?? (event.kind === "tool_use" ? event.id : undefined),
      textPreview: preview(text),
    });
  }

  return blocks.filter(
    (b) => b.retention !== "remove" && !(b.id && removed.has(b.id)),
  );
}

/** Flatten sent messages into comparable transcript blocks. */
export function sentMessagesToBlocks(
  sent: SentTranscriptInput,
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let order = 0;

  if (sent.system !== undefined && sent.system !== null && sent.system !== "") {
    const serialized = JSON.stringify(sent.system);
    blocks.push({
      role: "system",
      type: "system",
      id: "system",
      order: order++,
      hash: blockHash(sent.system),
      bytes: Buffer.byteLength(serialized, "utf8"),
      retention: "keep",
      textPreview: preview(
        typeof sent.system === "string" ? sent.system : serialized,
      ),
    });
  }

  for (const message of sent.messages ?? []) {
    const msg = message as Record<string, unknown>;
    const role = String(msg.role ?? "user");
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const block = part as Record<string, unknown>;
        const type = String(block.type ?? "text");
        const text =
          typeof block.text === "string"
            ? block.text
            : typeof block.content === "string"
              ? block.content
              : JSON.stringify(block);
        const id =
          typeof block.id === "string"
            ? block.id
            : typeof block.tool_use_id === "string"
              ? `result-${block.tool_use_id}`
              : undefined;
        const toolUseId =
          type === "tool_use"
            ? typeof block.id === "string"
              ? block.id
              : undefined
            : typeof block.tool_use_id === "string"
              ? block.tool_use_id
              : undefined;
        const parent =
          typeof block.parent === "string"
            ? block.parent
            : typeof msg.parent === "string"
              ? String(msg.parent)
              : undefined;
        const payload = { role, type, id, toolUseId, parent, text };
        const serialized = JSON.stringify(payload);
        blocks.push({
          role,
          type,
          id,
          parent,
          order: order++,
          hash: blockHash(payload),
          bytes: Buffer.byteLength(serialized, "utf8"),
          retention: "keep",
          toolUseId,
          textPreview: preview(text),
        });
      }
    } else {
      const text =
        typeof content === "string" ? content : JSON.stringify(content);
      const id = typeof msg.id === "string" ? msg.id : `msg-${order}`;
      const parent = typeof msg.parent === "string" ? msg.parent : undefined;
      const payload = { role, type: "text", id, parent, text };
      const serialized = JSON.stringify(payload);
      blocks.push({
        role,
        type: "text",
        id,
        parent,
        order: order++,
        hash: blockHash(payload),
        bytes: Buffer.byteLength(serialized, "utf8"),
        retention: "keep",
        textPreview: preview(text),
      });
    }
  }

  return blocks;
}

function identityKey(block: TranscriptBlock) {
  // Prefer stable ids so designed text blocks align with sent message blocks.
  if (block.id) return `id:${block.id}`;
  if (block.toolUseId) return `${block.type}:${block.toolUseId}`;
  return `${block.type}:${block.hash}`;
}

function contentEqual(a: TranscriptBlock, b: TranscriptBlock) {
  if (a.hash === b.hash) return true;
  if (
    a.textPreview !== undefined &&
    b.textPreview !== undefined &&
    a.textPreview === b.textPreview &&
    a.role === b.role
  ) {
    return true;
  }
  return false;
}

/**
 * Compare designed transcript vs sent messages/system/tools.
 * Empty diffs + pass when identical.
 */
export function compareDesignedVsSent(
  designed: TranscriptBlock[],
  sent: TranscriptBlock[] | SentTranscriptInput,
  options?: {
    designedRef?: string;
    sentRef?: string;
    /** Expected retrieval doc ids that must appear in sent. */
    expectedRetrievalDocIds?: string[];
  },
): ContextDiffResult {
  const sentBlocks = Array.isArray(sent) ? sent : sentMessagesToBlocks(sent);
  const diffs: ContextDiffResult["diffs"] = [];
  const designedRef = options?.designedRef;
  const sentRef = options?.sentRef;

  const designedKeep = designed.filter((b) => b.retention === "keep");
  const designedMap = new Map(designedKeep.map((b) => [identityKey(b), b]));
  const sentMap = new Map(sentBlocks.map((b) => [identityKey(b), b]));

  // missing
  for (const [key, block] of designedMap) {
    if (block.type === "compaction_summary") {
      const summaryInSent = sentBlocks.some(
        (s) =>
          s.id === block.id ||
          (s.textPreview &&
            block.textPreview &&
            s.textPreview.includes(block.textPreview.slice(0, 40))),
      );
      if (!summaryInSent) {
        diffs.push({
          kind: "summary-loss",
          designedRef: block.id,
          detail: `Compaction summary ${block.id} missing from sent transcript`,
        });
      }
      continue;
    }
    if (!sentMap.has(key)) {
      diffs.push({
        kind: "missing",
        designedRef: block.id ?? key,
        detail: `Designed block ${key} missing from sent transcript`,
      });
    }
  }

  // unexpected
  for (const [key, block] of sentMap) {
    if (!designedMap.has(key) && block.type !== "system") {
      const designedHasLoose = designedKeep.some((d) => contentEqual(d, block));
      if (!designedHasLoose) {
        diffs.push({
          kind: "unexpected",
          sentRef: block.id ?? key,
          detail: `Sent block ${key} not present in designed transcript`,
        });
      }
    }
  }

  // reordered — compare relative order of shared keys
  const sharedDesigned = designedKeep
    .map((b) => identityKey(b))
    .filter((k) => sentMap.has(k));
  const sharedSent = sentBlocks
    .map((b) => identityKey(b))
    .filter((k) => designedMap.has(k));
  if (
    sharedDesigned.length > 1 &&
    sharedSent.length === sharedDesigned.length &&
    sharedDesigned.some((k, i) => k !== sharedSent[i])
  ) {
    diffs.push({
      kind: "reordered",
      detail: `Shared blocks reordered: designed [${sharedDesigned.join(",")}] vs sent [${sharedSent.join(",")}]`,
    });
  }

  // truncated / stale / wrong-parent — same id but different content
  for (const [key, dBlock] of designedMap) {
    const sBlock = sentMap.get(key);
    if (!sBlock) continue;
    if (
      dBlock.parent !== undefined &&
      sBlock.parent !== undefined &&
      dBlock.parent !== sBlock.parent
    ) {
      diffs.push({
        kind: "wrong-parent",
        designedRef: dBlock.id,
        sentRef: sBlock.id,
        detail: `Block ${key} parent designed=${dBlock.parent} sent=${sBlock.parent}`,
      });
    }
    if (contentEqual(dBlock, sBlock)) continue;
    if (sBlock.bytes < dBlock.bytes) {
      diffs.push({
        kind: "truncated",
        designedRef: dBlock.id,
        sentRef: sBlock.id,
        detail: `Block ${key} truncated: designed ${dBlock.bytes}B vs sent ${sBlock.bytes}B`,
      });
    } else if (sBlock.hash !== dBlock.hash) {
      diffs.push({
        kind: "stale",
        designedRef: dBlock.id,
        sentRef: sBlock.id,
        detail: `Block ${key} content hash mismatch (stale or mutated)`,
      });
    }
  }

  // wrong-tool-result-pair
  for (const sBlock of sentBlocks) {
    if (sBlock.type !== "tool_result") continue;
    const useId = sBlock.toolUseId;
    if (!useId) {
      diffs.push({
        kind: "wrong-tool-result-pair",
        sentRef: sBlock.id,
        detail: "tool_result missing toolUseId",
      });
      continue;
    }
    const designedUse = designedKeep.find(
      (b) => b.type === "tool_use" && (b.id === useId || b.toolUseId === useId),
    );
    const sentUse = sentBlocks.find(
      (b) => b.type === "tool_use" && (b.id === useId || b.toolUseId === useId),
    );
    if (!designedUse && !sentUse) {
      diffs.push({
        kind: "wrong-tool-result-pair",
        sentRef: sBlock.id,
        detail: `tool_result references unknown tool_use ${useId}`,
      });
    }
  }
  for (const dBlock of designedKeep) {
    if (dBlock.type !== "tool_result") continue;
    const useId = dBlock.toolUseId;
    if (!useId) continue;
    const sentResult = sentBlocks.find(
      (b) => b.type === "tool_result" && b.toolUseId === useId,
    );
    if (sentResult && sentResult.toolUseId !== useId) {
      diffs.push({
        kind: "wrong-tool-result-pair",
        designedRef: dBlock.id,
        sentRef: sentResult.id,
        detail: `tool_result pair mismatch for ${useId}`,
      });
    }
  }

  // retrieval-miss
  const expectedDocs = options?.expectedRetrievalDocIds;
  if (expectedDocs?.length) {
    const sentText = JSON.stringify(sentBlocks);
    for (const docId of expectedDocs) {
      if (!sentText.includes(docId)) {
        diffs.push({
          kind: "retrieval-miss",
          detail: `Retrieval target ${docId} exists but was not returned in sent context`,
        });
      }
    }
  }
  for (const dBlock of designedKeep) {
    if (dBlock.type !== "retrieval") continue;
    const sentRetrieval = sentBlocks.find(
      (b) => b.type === "retrieval" || b.id === dBlock.id,
    );
    if (!sentRetrieval) {
      diffs.push({
        kind: "retrieval-miss",
        designedRef: dBlock.id,
        detail: `Retrieval block ${dBlock.id} missing from sent transcript`,
      });
    }
  }

  // Deduplicate similar diffs by kind+detail
  const unique = new Map<string, ContextDiffResult["diffs"][number]>();
  for (const diff of diffs) {
    unique.set(
      `${diff.kind}:${diff.designedRef}:${diff.sentRef}:${diff.detail}`,
      diff,
    );
  }
  const finalDiffs = [...unique.values()];
  const status = finalDiffs.length === 0 ? "pass" : "fail";
  return {
    status,
    diffs: finalDiffs,
    designedRef,
    sentRef,
    classificationHint: status === "fail" ? "harness_failure" : undefined,
  };
}

/** Helper to force a specific diff kind in fixtures/tests. */
export function fixtureDiff(kind: DiffKind, detail: string): ContextDiffResult {
  return {
    status: "fail",
    diffs: [{ kind, detail }],
    classificationHint: "harness_failure",
  };
}
