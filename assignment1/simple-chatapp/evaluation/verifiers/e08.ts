import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE08: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const sessionTest = await readText(worktreePath, "server/session.test.ts");
  const lower = sessionTest?.toLowerCase() ?? "";
  const checks = [
    check("session.test.ts exists", sessionTest !== null),
    check("permission timeout test", lower.includes("timeout")),
    check("permission disconnect test", lower.includes("disconnect")),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/session.test.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
