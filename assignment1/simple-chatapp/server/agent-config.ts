import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { redact } from "./redaction.js";

export const SYSTEM_PROMPT = `You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.`;

export const AGENT_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
] as const;

export const ALLOWED_TOOLS = ["Read", "Glob", "Grep"] as const;

/** Empty array disables implicit user/project/local settings and CLAUDE.md auto-load. */
export const SETTING_SOURCES: [] = [];

export const MAX_PROJECT_INSTRUCTION_BYTES = 256_000;

export const OBSERVABILITY_NOTE =
  "This snapshot only includes application-controlled inputs provided to the SDK (system prompt, tools, cwd, model, and any explicitly loaded CLAUDE.md). It does not include hidden SDK runtime or Anthropic server-side prompts.";

export type ProjectInstructionStatus =
  "loaded" | "unavailable" | "error" | "truncated";

export interface ProjectInstructions {
  text: string | "unavailable";
  source: string | "unavailable";
  status: ProjectInstructionStatus;
  error?: string;
  originalBytes?: number;
}

export interface ObservableRequestSnapshot {
  systemPrompt: string;
  projectInstructions: string | "unavailable";
  projectInstructionSource: string | "unavailable";
  projectInstructionStatus: ProjectInstructionStatus;
  projectInstructionError?: string;
  tools: string[];
  model: string;
  cwd: string;
  settingSources: [];
  observabilityNote: string;
}

export function resolveModel() {
  return process.env.ANTHROPIC_MODEL || "opus";
}

export function composeSystemPrompt(
  projectInstructions: ProjectInstructions,
  basePrompt = SYSTEM_PROMPT,
) {
  if (
    projectInstructions.status === "unavailable" ||
    projectInstructions.text === "unavailable" ||
    !String(projectInstructions.text).trim()
  ) {
    return basePrompt;
  }
  const source =
    projectInstructions.source === "unavailable"
      ? "CLAUDE.md"
      : projectInstructions.source;
  return `${basePrompt}

---
Project instructions from ${source}:
${projectInstructions.text}`;
}

export async function loadProjectInstructions(
  cwd: string,
): Promise<ProjectInstructions> {
  const candidate = path.join(cwd, "CLAUDE.md");
  try {
    await access(candidate, fsConstants.R_OK);
  } catch {
    return {
      text: "unavailable",
      source: "unavailable",
      status: "unavailable",
    };
  }

  try {
    const root = await realpath(cwd);
    const resolved = await realpath(candidate);
    const relative = path.relative(root, resolved);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.includes(`..${path.sep}`)
    ) {
      return {
        text: "unavailable",
        source: "unavailable",
        status: "error",
        error: "CLAUDE.md resolved outside the session working directory",
      };
    }

    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      return {
        text: "unavailable",
        source: "unavailable",
        status: "error",
        error: "CLAUDE.md is not a regular file",
      };
    }

    const raw = await readFile(resolved, "utf8");
    const bytes = Buffer.byteLength(raw, "utf8");
    const source = path.join(path.basename(root) || ".", "CLAUDE.md");
    if (bytes > MAX_PROJECT_INSTRUCTION_BYTES) {
      const truncated = raw.slice(0, MAX_PROJECT_INSTRUCTION_BYTES);
      return {
        text: String(redact(truncated)),
        source,
        status: "truncated",
        originalBytes: bytes,
        error: `CLAUDE.md exceeded ${MAX_PROJECT_INSTRUCTION_BYTES} bytes and was truncated`,
      };
    }
    return {
      text: String(redact(raw)),
      source,
      status: "loaded",
      originalBytes: bytes,
    };
  } catch (error) {
    return {
      text: "unavailable",
      source: "unavailable",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildObservableRequestSnapshot(input: {
  cwd: string;
  projectInstructions: ProjectInstructions;
  systemPrompt?: string;
  model?: string;
  tools?: readonly string[];
}): ObservableRequestSnapshot {
  const projectInstructions = input.projectInstructions;
  return {
    systemPrompt:
      input.systemPrompt || composeSystemPrompt(projectInstructions),
    projectInstructions: projectInstructions.text,
    projectInstructionSource: projectInstructions.source,
    projectInstructionStatus: projectInstructions.status,
    projectInstructionError: projectInstructions.error,
    tools: [...(input.tools || AGENT_TOOLS)],
    model: input.model || resolveModel(),
    cwd: input.cwd,
    settingSources: SETTING_SOURCES,
    observabilityNote: OBSERVABILITY_NOTE,
  };
}
