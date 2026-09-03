import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE07: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const sessionTest = await readText(worktreePath, "server/session.test.ts");
  const session = await readText(worktreePath, "server/session.ts");
  const resumeInTest = !!sessionTest?.toLowerCase().includes("resume");
  const hasObservation = !!session?.includes("setObservationContext");
  const checks = [
    check(
      "session.ts exposes setObservationContext",
      hasObservation,
      hasObservation
        ? "setObservationContext in session.ts"
        : "setObservationContext missing",
    ),
    check(
      "session tests mention resume",
      resumeInTest,
      resumeInTest ? "resume-related test found" : "no resume test text",
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/session.ts",
    "server/session.test.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
