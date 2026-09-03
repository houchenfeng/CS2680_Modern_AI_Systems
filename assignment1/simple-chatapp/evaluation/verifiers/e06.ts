import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE06: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const diff = await readText(worktreePath, "server/context-diff.ts");
  const hasMissing =
    !!diff &&
    (diff.includes('"missing"') ||
      diff.includes("'missing'") ||
      /DiffKind[\s\S]*?missing/.test(diff));
  const hasWrongParent = !!diff && diff.includes("wrong-parent");
  const checks = [
    check("context-diff.ts exists", diff !== null),
    check("DiffKind includes missing", hasMissing),
    check("DiffKind includes wrong-parent", hasWrongParent),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/context-diff.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
