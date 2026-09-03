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
  const trajectoryTest = await readText(
    worktreePath,
    "server/trajectory.test.ts",
  );
  const session = await readText(worktreePath, "server/session.ts");
  const resumeInTest =
    !!sessionTest?.toLowerCase().includes("resume") ||
    !!trajectoryTest?.toLowerCase().includes("resume");
  const hasObservation = !!session?.includes("setObservationContext");
  const checks = [
    check(
      "resume test or setObservationContext",
      resumeInTest || hasObservation,
      resumeInTest
        ? "resume-related test found"
        : hasObservation
          ? "setObservationContext in session.ts"
          : "neither resume test nor setObservationContext found",
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/session.ts",
    "server/session.test.ts",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
