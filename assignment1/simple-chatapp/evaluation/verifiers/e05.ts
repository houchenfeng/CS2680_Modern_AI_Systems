import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  fileExists,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE05: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const evidenceExists = await fileExists(
    worktreePath,
    "server/evidence-store.ts",
  );
  const replayExists = await fileExists(worktreePath, "server/tool-replay.ts");
  const evidence = await readText(worktreePath, "server/evidence-store.ts");
  const checks = [
    check("evidence-store.ts exists", evidenceExists),
    check("tool-replay.ts exists", replayExists),
    check("UI_FOLD_THRESHOLD", !!evidence?.includes("UI_FOLD_THRESHOLD")),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/evidence-store.ts",
    "server/tool-replay.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
