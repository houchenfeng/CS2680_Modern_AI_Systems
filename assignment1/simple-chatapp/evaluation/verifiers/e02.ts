import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE02: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const normalizer = await readText(
    worktreePath,
    "server/event-normalizer.ts",
  );
  const checks = [
    check(
      "event-normalizer.ts exists",
      normalizer !== null,
      normalizer ? "present" : "missing",
    ),
    check(
      "handles compact_boundary",
      !!normalizer?.includes("compact_boundary"),
    ),
    check(
      "handles unknown_sdk_block",
      !!normalizer?.includes("unknown_sdk_block"),
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/event-normalizer.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
