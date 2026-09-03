import type { VerifierFn, VerifierResult } from "./helpers.js";
import {
  check,
  collectGitStatus,
  fileExists,
  finalize,
  hashFiles,
  readText,
} from "./helpers.js";

export const verifyE10: VerifierFn = async (
  worktreePath,
): Promise<VerifierResult> => {
  const diagnosisExists = await fileExists(
    worktreePath,
    "server/failure-diagnosis.ts",
  );
  const panelExists = await fileExists(
    worktreePath,
    "client/components/FailureDiagnosisPanel.tsx",
  );
  const metrics = await readText(worktreePath, "evaluation/metrics.ts");
  const fixtures = await readText(worktreePath, "server/failure-fixtures.ts");
  const hasCostFixtureConcept =
    !!metrics?.includes("costPerCompletedTask") ||
    !!fixtures?.includes("0.18") ||
    !!metrics?.includes("COST_FIXTURE");
  const checks = [
    check("failure-diagnosis.ts exists", diagnosisExists),
    check("FailureDiagnosisPanel.tsx exists", panelExists),
    check(
      "cost fixture conceptually present",
      hasCostFixtureConcept,
      "metrics costPerCompletedTask or fixture rates",
    ),
  ];
  const fileHashes = await hashFiles(worktreePath, [
    "server/failure-diagnosis.ts",
    "client/components/FailureDiagnosisPanel.tsx",
  ]);
  const gitStatus = await collectGitStatus(worktreePath);
  return finalize(checks, { fileHashes, gitStatus });
};
