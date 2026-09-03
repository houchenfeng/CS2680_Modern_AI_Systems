import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE01: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const testSrc = await readText(
    worktreePath,
    "server/event-normalizer.test.ts",
  );
  const eventsSrc = await readText(worktreePath, "server/events.ts");
  const checks = [
    check(
      "event-normalizer.test.ts exists",
      testSrc !== null,
      testSrc ? "present" : "missing",
    ),
    check(
      "same message ID with three fragments",
      !!testSrc?.includes("same message ID with three fragments"),
      "fixture phrase required in event-normalizer.test.ts",
    ),
    check(
      "events.ts has callUsage",
      !!eventsSrc?.includes("callUsage"),
      eventsSrc ? "callUsage symbol present" : "events.ts missing",
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/event-normalizer.test.ts",
    "server/events.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
