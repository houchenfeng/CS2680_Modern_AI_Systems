import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VerifierStatus = "pass" | "fail" | "evaluation_harness_error";

export interface VerifierCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface VerifierResult {
  status: VerifierStatus;
  checks: VerifierCheck[];
  stdout: string;
  stderr: string;
  exitCode: number;
  fileHashes?: Record<string, string>;
  gitStatus?: string;
}

export type VerifierFn = (worktreePath: string) => Promise<VerifierResult>;

export function resolvePath(worktreePath: string, ...parts: string[]): string {
  return join(worktreePath, ...parts);
}

export async function fileExists(
  worktreePath: string,
  relPath: string,
): Promise<boolean> {
  try {
    await stat(resolvePath(worktreePath, relPath));
    return true;
  } catch {
    return false;
  }
}

export async function readText(
  worktreePath: string,
  relPath: string,
): Promise<string | null> {
  try {
    return await readFile(resolvePath(worktreePath, relPath), "utf8");
  } catch {
    return null;
  }
}

export async function sha256File(
  worktreePath: string,
  relPath: string,
): Promise<string | null> {
  const text = await readText(worktreePath, relPath);
  if (text === null) return null;
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function check(
  name: string,
  passed: boolean,
  detail?: string,
): VerifierCheck {
  return { name, passed, detail };
}

export function finalize(
  checks: VerifierCheck[],
  extras: Partial<VerifierResult> = {},
): VerifierResult {
  const allPassed = checks.length > 0 && checks.every((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);
  const stdout = checks
    .map((c) => `${c.passed ? "PASS" : "FAIL"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`)
    .join("\n");
  const stderr = failed.map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("\n");
  return {
    status: allPassed ? "pass" : "fail",
    checks,
    stdout,
    stderr,
    exitCode: allPassed ? 0 : 1,
    ...extras,
  };
}

export async function collectGitStatus(
  worktreePath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v2"],
      { cwd: worktreePath, windowsHide: true },
    );
    return stdout;
  } catch {
    return undefined;
  }
}

export async function hashFiles(
  worktreePath: string,
  relPaths: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of relPaths) {
    const h = await sha256File(worktreePath, rel);
    if (h) out[rel] = h;
  }
  return out;
}

/** Walk up from worktreePath looking for package.json (simple-chatapp root). */
export function findAppRoot(worktreePath: string): string {
  if (existsSync(join(worktreePath, "package.json"))) {
    return worktreePath;
  }
  // If runner copied into a nested layout, accept as-is.
  return worktreePath;
}

export async function listRelFiles(
  root: string,
  max = 200,
): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= max) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        results.push(relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  await walk(root);
  return results;
}
