import { verifyE01 } from "./e01.js";
import { verifyE02 } from "./e02.js";
import { verifyE03 } from "./e03.js";
import { verifyE04 } from "./e04.js";
import { verifyE05 } from "./e05.js";
import { verifyE06 } from "./e06.js";
import { verifyE07 } from "./e07.js";
import { verifyE08 } from "./e08.js";
import { verifyE09 } from "./e09.js";
import { verifyE10 } from "./e10.js";
import type { VerifierFn, VerifierResult } from "./helpers.js";

export type {
  VerifierCheck,
  VerifierFn,
  VerifierResult,
  VerifierStatus,
} from "./helpers.js";

const VERIFIERS: Record<string, VerifierFn> = {
  E01: verifyE01,
  E02: verifyE02,
  E03: verifyE03,
  E04: verifyE04,
  E05: verifyE05,
  E06: verifyE06,
  E07: verifyE07,
  E08: verifyE08,
  E09: verifyE09,
  E10: verifyE10,
};

export function getVerifier(taskId: string): VerifierFn {
  const fn = VERIFIERS[taskId];
  if (!fn) {
    throw new Error(`No verifier registered for task ${taskId}`);
  }
  return fn;
}

/**
 * Run the frozen verifier for a task against a worktree.
 * Does NOT trust agent "done" text — only repository state.
 * Thrown errors become evaluation_harness_error (not agent failure).
 */
export async function runVerifier(
  taskId: string,
  worktreePath: string,
): Promise<VerifierResult> {
  try {
    const verifier = getVerifier(taskId);
    return await verifier(worktreePath);
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    return {
      status: "evaluation_harness_error",
      checks: [
        {
          name: "verifier_execution",
          passed: false,
          detail: message,
        },
      ],
      stdout: "",
      stderr: message,
      exitCode: 2,
    };
  }
}

export { VERIFIERS };
