import {
  mkdir,
  open,
  readFile,
  rename,
  appendFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { redact } from "./redaction.js";

export const UI_FOLD_THRESHOLD = 64_000;

export interface EvidenceMeta {
  schemaVersion: 1;
  evidenceId: string;
  chatId: string;
  runId: string;
  sha256: string;
  mimeType: string;
  originalLength: number;
  storedLength: number;
  truncated: boolean;
  redactionStatus: "redacted" | "clean";
  relativePath: string;
  createdAt: string;
  kind?: string;
  sourceEventId?: string;
  labels?: string[];
}

export interface StoreEvidenceInput {
  chatId: string;
  runId: string;
  content: unknown;
  mimeType?: string;
  kind?: string;
  sourceEventId?: string;
  labels?: string[];
  /** When true, content is already redacted. */
  alreadyRedacted?: boolean;
}

function evidenceRoot() {
  return path.resolve(
    process.env.EVIDENCE_ROOT || path.join(process.cwd(), "evidence"),
  );
}

function emergencyLogPath() {
  return path.resolve(
    process.env.EMERGENCY_LOG ||
      path.join(process.cwd(), "emergency-logs", "evidence-failures.log"),
  );
}

function sha256Of(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function serializeContent(content: unknown): {
  buffer: Buffer;
  mimeType: string;
} {
  if (typeof content === "string") {
    return { buffer: Buffer.from(content, "utf8"), mimeType: "text/plain" };
  }
  if (Buffer.isBuffer(content)) {
    return { buffer: content, mimeType: "application/octet-stream" };
  }
  return {
    buffer: Buffer.from(JSON.stringify(content, null, 2), "utf8"),
    mimeType: "application/json",
  };
}

async function writeEmergency(message: string, detail?: unknown) {
  try {
    const file = emergencyLogPath();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(
      file,
      `${new Date().toISOString()}\t${message}\t${JSON.stringify(detail ?? null)}\n`,
      "utf8",
    );
  } catch {
    // Never recurse into logger failure.
  }
}

async function atomicWriteFile(filePath: string, data: Buffer | string) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}

export class EvidenceStore {
  constructor(private readonly root = evidenceRoot()) {}

  private runDir(chatId: string, runId: string) {
    return path.join(this.root, chatId, runId);
  }

  private indexPath(chatId: string, runId: string) {
    return path.join(this.runDir(chatId, runId), "index.jsonl");
  }

  async store(input: StoreEvidenceInput): Promise<EvidenceMeta> {
    try {
      const redacted = input.alreadyRedacted
        ? input.content
        : redact(input.content);
      const { buffer, mimeType } = serializeContent(redacted);
      const sha256 = sha256Of(buffer);
      const extension = mimeType === "text/plain" ? "txt" : "json";
      const relativePath = path
        .join(input.chatId, input.runId, `${sha256}.${extension}`)
        .replace(/\\/g, "/");
      const absolutePath = path.join(this.root, relativePath);
      const metaPath = path.join(
        this.runDir(input.chatId, input.runId),
        `${sha256}.meta.json`,
      );

      let existed = false;
      try {
        await readFile(absolutePath);
        existed = true;
      } catch {
        existed = false;
      }

      if (!existed) {
        await atomicWriteFile(absolutePath, buffer);
      }

      const originalSerialized = serializeContent(
        input.alreadyRedacted ? input.content : input.content,
      ).buffer;
      const meta: EvidenceMeta = {
        schemaVersion: 1,
        evidenceId: `ev-${sha256.slice(0, 16)}`,
        chatId: input.chatId,
        runId: input.runId,
        sha256,
        mimeType: input.mimeType || mimeType,
        originalLength: originalSerialized.byteLength,
        storedLength: buffer.byteLength,
        truncated: false,
        redactionStatus: input.alreadyRedacted ? "clean" : "redacted",
        relativePath,
        createdAt: new Date().toISOString(),
        kind: input.kind,
        sourceEventId: input.sourceEventId,
        labels: input.labels,
      };

      if (!existed) {
        await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
        await appendFile(
          this.indexPath(input.chatId, input.runId),
          `${JSON.stringify(meta)}\n`,
          "utf8",
        );
      } else {
        // Deduped body; still return meta (read existing if present).
        try {
          const existing = JSON.parse(
            await readFile(metaPath, "utf8"),
          ) as EvidenceMeta;
          return existing;
        } catch {
          await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
        }
      }
      return meta;
    } catch (error) {
      await writeEmergency("evidence_store_failed", {
        chatId: input.chatId,
        runId: input.runId,
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async read(chatId: string, runId: string, sha256: string) {
    const directory = this.runDir(chatId, runId);
    for (const extension of ["json", "txt"]) {
      try {
        return await readFile(path.join(directory, `${sha256}.${extension}`));
      } catch {
        // try next
      }
    }
    throw new Error(`Evidence ${sha256} not found`);
  }

  async readMeta(chatId: string, runId: string, sha256: string) {
    const metaPath = path.join(
      this.runDir(chatId, runId),
      `${sha256}.meta.json`,
    );
    return JSON.parse(await readFile(metaPath, "utf8")) as EvidenceMeta;
  }

  async list(chatId: string, runId: string): Promise<EvidenceMeta[]> {
    try {
      const raw = await readFile(this.indexPath(chatId, runId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EvidenceMeta);
    } catch {
      return [];
    }
  }
}

export const evidenceStore = new EvidenceStore();

/** UI-safe preview: fold bodies larger than 64KB but keep evidence hash. */
export function uiFold(
  value: unknown,
  evidence?: Pick<EvidenceMeta, "sha256" | "storedLength" | "relativePath">,
) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (serialized.length <= UI_FOLD_THRESHOLD) {
    return {
      preview: value,
      truncated: false,
      originalLength: serialized.length,
      evidenceSha256: evidence?.sha256,
      evidencePath: evidence?.relativePath,
    };
  }
  return {
    preview:
      typeof value === "string"
        ? value.slice(0, UI_FOLD_THRESHOLD)
        : serialized.slice(0, UI_FOLD_THRESHOLD),
    truncated: true,
    originalLength: serialized.length,
    evidenceSha256: evidence?.sha256,
    evidencePath: evidence?.relativePath,
    note: "Full redacted artifact stored in evidence store; UI shows folded preview.",
  };
}

export function hashContent(content: unknown) {
  return sha256Of(serializeContent(content).buffer);
}
