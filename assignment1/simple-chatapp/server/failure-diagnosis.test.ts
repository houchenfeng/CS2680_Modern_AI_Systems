import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTrajectoryFixtures,
  classifyReadMaxTurnsLoop,
  createDiagnosis,
  listDiagnoses,
  persistDiagnosis,
  reviseDiagnosis,
} from "./failure-diagnosis.js";
import { FAILURE_FIXTURES, failureFixtureRecords } from "./failure-fixtures.js";

test("tool failure marks harness/spec/model not_reached", () => {
  const d = createDiagnosis({
    taskId: "ord-tool",
    attemptId: "a1",
    terminalFailureEventId: "e1",
    symptom: "mismatch",
    impact: "stop",
    evidenceRefs: ["ev1"],
    toolCheck: {
      status: "fail",
      evidenceRefs: ["ev1"],
      conclusion: "tool mismatch",
    },
    contextCheck: {
      status: "pass",
      designedRef: "d",
      sentRef: "s",
      diffRef: "",
      conclusion: "should be overwritten",
    },
    specificationCheck: {
      status: "pass",
      specHash: "h",
      humanContractorAnswer: "ok",
      conclusion: "should be overwritten",
    },
    modelCheck: {
      status: "fail",
      callIds: ["c1"],
      conclusion: "should be overwritten",
    },
  });
  assert.equal(d.classification, "tool");
  assert.equal(d.contextCheck.status, "not_reached");
  assert.equal(d.specificationCheck.status, "not_reached");
  assert.equal(d.modelCheck.status, "not_reached");
});

test("model only reachable when tool+harness+spec pass", () => {
  const d = createDiagnosis({
    taskId: "ord-model",
    attemptId: "a1",
    terminalFailureEventId: "e1",
    symptom: "wrong action",
    impact: "verifier fail",
    evidenceRefs: ["ev-t", "ev-c", "ev-s", "ev-m"],
    toolCheck: { status: "pass", evidenceRefs: ["ev-t"], conclusion: "ok" },
    contextCheck: {
      status: "pass",
      designedRef: "d",
      sentRef: "s",
      diffRef: "",
      conclusion: "ok",
    },
    specificationCheck: {
      status: "pass",
      specHash: "spec",
      humanContractorAnswer: "unique",
      conclusion: "ok",
    },
    modelCheck: {
      status: "fail",
      callIds: ["call-1"],
      conclusion: "ignored constraint",
    },
  });
  assert.equal(d.classification, "model");
  assert.equal(d.modelCheck.status, "fail");
});

test("no evidenceRefs → inconclusive", () => {
  const d = createDiagnosis({
    taskId: "no-ev",
    attemptId: "a1",
    terminalFailureEventId: "e1",
    symptom: "unknown",
    impact: "unknown",
    evidenceRefs: [],
    toolCheck: { status: "fail", evidenceRefs: [], conclusion: "maybe" },
  });
  assert.equal(d.classification, "inconclusive");
});

test("append-only persist and reviseDiagnosis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "diag-"));
  const prev = process.env.DIAGNOSES_ROOT;
  process.env.DIAGNOSES_ROOT = root;
  try {
    const first = createDiagnosis({
      taskId: "rev-task",
      attemptId: "a1",
      terminalFailureEventId: "e1",
      symptom: "x",
      impact: "y",
      evidenceRefs: ["ev1"],
      toolCheck: { status: "pass", evidenceRefs: ["ev1"], conclusion: "ok" },
      contextCheck: {
        status: "fail",
        designedRef: "d",
        sentRef: "s",
        diffRef: "diff",
        conclusion: "missing",
      },
    });
    await persistDiagnosis(first);
    const revised = await reviseDiagnosis(first, {
      classification: "harness",
      addedEvidenceRefs: ["ev2"],
      note: "confirmed missing retrieval",
    });
    assert.equal(revised.revision, 1);
    assert.ok(revised.evidenceRefs.includes("ev2"));
    const rows = await listDiagnoses("rev-task");
    assert.ok(rows.length >= 2);
  } finally {
    if (prev === undefined) delete process.env.DIAGNOSES_ROOT;
    else process.env.DIAGNOSES_ROOT = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test("four trajectory fixtures cover tool/harness/specification/model", () => {
  const fixtures = buildTrajectoryFixtures();
  assert.equal(fixtures.tool.classification, "tool");
  assert.equal(fixtures.harness.classification, "harness");
  assert.equal(fixtures.specification.classification, "specification");
  assert.equal(fixtures.model.classification, "model");
  assert.equal(fixtures.tool.modelCheck.status, "not_reached");
  assert.equal(fixtures.harness.specificationCheck.status, "not_reached");
  assert.equal(fixtures.specification.modelCheck.status, "not_reached");
  assert.equal(fixtures.model.toolCheck.status, "pass");
  assert.equal(fixtures.model.contextCheck.status, "pass");
  assert.equal(fixtures.model.specificationCheck.status, "pass");
});

test("classifyReadMaxTurnsLoop returns harness with evidence chain", () => {
  const d = classifyReadMaxTurnsLoop();
  assert.equal(d.classification, "harness");
  assert.ok(d.evidenceRefs.length >= 3);
  assert.equal(d.contextCheck.status, "fail");
  assert.equal(d.modelCheck.status, "not_reached");
  assert.match(d.symptom, /max.?turns/i);
});

test("failure-fixtures exports four complete records for API/UI", () => {
  const records = failureFixtureRecords();
  for (const key of ["tool", "harness", "specification", "model"] as const) {
    const d = records[key];
    assert.ok(d.diagnosisId);
    assert.ok(d.evidenceRefs.length > 0);
    assert.ok(d.toolCheck);
    assert.ok(d.contextCheck);
    assert.ok(d.specificationCheck);
    assert.ok(d.modelCheck);
  }
  assert.equal(FAILURE_FIXTURES.readMaxTurns.classification, "harness");
});
