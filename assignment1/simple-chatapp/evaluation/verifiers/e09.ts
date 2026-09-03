import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE09: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const taskSpec = await readText(worktreePath, "server/task-spec.ts");
  const checks = [
    check("task-spec.ts exists", taskSpec !== null),
    check("freezeSpec present", !!taskSpec?.includes("freezeSpec")),
  ];
  const fileHashes = await hashFiles(worktreePath, ["server/task-spec.ts"]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
