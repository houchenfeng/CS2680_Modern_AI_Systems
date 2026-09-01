import path from "node:path";
import { realpath, stat } from "node:fs/promises";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function workspaceRoot() {
  const configured = process.env.AGENT_WORKSPACE_ROOT || process.cwd();
  return realpath(path.resolve(configured));
}

export async function resolveWorkspace(relativePath = ".") {
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.startsWith("\\\\")) {
    throw new WorkspaceError("Workspace path must be relative to AGENT_WORKSPACE_ROOT");
  }
  const root = await workspaceRoot();
  const candidate = path.resolve(root, relativePath);
  if (!inside(root.toLowerCase(), candidate.toLowerCase())) throw new WorkspaceError("Workspace path escapes the allowed root");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new WorkspaceError("Workspace directory does not exist");
  }
  if (!inside(root.toLowerCase(), resolved.toLowerCase())) throw new WorkspaceError("Workspace symlink escapes the allowed root");
  if (!(await stat(resolved)).isDirectory()) throw new WorkspaceError("Workspace path is not a directory");
  return { root, cwd: resolved, relativePath: path.relative(root, resolved) || "." };
}

