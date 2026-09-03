import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  fileExists,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE03: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const ledger = await readText(worktreePath, "server/context-ledger.ts");
  const exists = await fileExists(worktreePath, "server/context-ledger.ts");
  const checks = [
    check("context-ledger.ts exists", exists),
    check(
      "CALL_CONTEXT_RULE_VERSION",
      !!ledger?.includes("CALL_CONTEXT_RULE_VERSION"),
    ),
    check(
      "coverage gate",
      !!ledger &&
        (ledger.includes("COVERAGE_GATE") ||
          (ledger.includes("coverage") && ledger.includes("0.95"))),
      "expects COVERAGE_GATE or 0.95 coverage gate",
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/context-ledger.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
