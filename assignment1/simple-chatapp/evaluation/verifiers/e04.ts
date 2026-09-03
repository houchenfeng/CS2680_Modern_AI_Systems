import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE04: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const pricing = await readText(worktreePath, "server/pricing.ts");
  const checks = [
    check("pricing.ts exists", pricing !== null),
    check("rate 0.044 (cache-hit)", !!pricing?.includes("0.044")),
    check("rate 1.32 (cache-miss)", !!pricing?.includes("1.32")),
    check("rate 3.96 (output)", !!pricing?.includes("3.96")),
  ];
  const fileHashes = await hashFiles(worktreePath, ["server/pricing.ts"]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
