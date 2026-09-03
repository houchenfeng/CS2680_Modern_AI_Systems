import {
  buildTrajectoryFixtures,
  classifyReadMaxTurnsLoop,
  type FailureDiagnosis,
} from "./failure-diagnosis.js";

/**
 * Four complete diagnosis records ready for API/UI, plus the historical
 * Read/max-turns harness classification.
 */
export function failureFixtureRecords(): {
  tool: FailureDiagnosis;
  harness: FailureDiagnosis;
  specification: FailureDiagnosis;
  model: FailureDiagnosis;
  readMaxTurns: FailureDiagnosis;
} {
  const four = buildTrajectoryFixtures();
  return {
    ...four,
    readMaxTurns: classifyReadMaxTurnsLoop(),
  };
}

export const FAILURE_FIXTURES = failureFixtureRecords();
