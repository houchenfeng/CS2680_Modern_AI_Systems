import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearSpecRegistry,
  diagnoseSpecificationClarity,
  freezeSpec,
  getSpecVersions,
  reviseSpec,
} from "./task-spec.js";

beforeEach(() => {
  clearSpecRegistry();
});

test("freezeSpec computes hash and is immutable for same version", () => {
  const spec = freezeSpec({
    taskId: "t1",
    prompt: "Add a README with setup steps",
    acceptanceCriteria: ["README.md exists", "Contains install + run sections"],
    outOfScope: ["Rewriting application code"],
    allowedTools: ["Read", "Write"],
    budget: { maxTurns: 10 },
    doneCondition: "README committed with both sections",
  });
  assert.ok(spec.specHash.length === 64);
  assert.equal(spec.version, 1);
  assert.throws(() => {
    (spec as { prompt: string }).prompt = "mutated";
  });
  assert.throws(() =>
    freezeSpec({
      taskId: "t1",
      version: 1,
      prompt: "duplicate version",
      acceptanceCriteria: ["x"],
      doneCondition: "y",
    }),
  );
});

test("reviseSpec creates new version and keeps old", () => {
  const v1 = freezeSpec({
    taskId: "t2",
    prompt: "v1 prompt",
    acceptanceCriteria: ["A"],
    doneCondition: "done A",
  });
  const v2 = reviseSpec(v1, {
    prompt: "v2 prompt",
    acceptanceCriteria: ["A", "B"],
  });
  assert.equal(v2.version, 2);
  assert.notEqual(v2.specHash, v1.specHash);
  const versions = getSpecVersions("t2");
  assert.equal(versions.length, 2);
  assert.equal(versions[0].prompt, "v1 prompt");
  assert.equal(versions[1].prompt, "v2 prompt");
});

test("ambiguous prompt → specification_failure with >=2 interpretations", () => {
  const spec = freezeSpec({
    taskId: "t3",
    prompt: "Improve the code appropriately and fix things as needed",
    acceptanceCriteria: [],
    doneCondition: "done",
  });
  const diagnosis = diagnoseSpecificationClarity(spec);
  assert.equal(diagnosis.classificationHint, "specification_failure");
  assert.ok(diagnosis.ambiguities.length >= 1);
  assert.ok(diagnosis.reasonableInterpretations.length >= 2);
  assert.equal(
    diagnosis.professionalExecutorJudgment.uniquelyDetermined,
    false,
  );
});

test("clear spec → uniquely determined pass without seeing agent answer", () => {
  const spec = freezeSpec({
    taskId: "t4",
    prompt: "Create file output.txt containing exactly the string READY",
    acceptanceCriteria: [
      "output.txt exists at repo root",
      "File contents are exactly READY with no trailing spaces",
    ],
    outOfScope: ["Any other files"],
    allowedTools: ["Write"],
    doneCondition: "output.txt bytes equal READY",
  });
  const diagnosis = diagnoseSpecificationClarity(spec);
  assert.equal(diagnosis.classificationHint, "pass");
  assert.equal(diagnosis.professionalExecutorJudgment.uniquelyDetermined, true);
  assert.ok(diagnosis.reasonableInterpretations.length >= 2);
  assert.throws(() =>
    diagnoseSpecificationClarity(spec, {
      analystNotes: "The agent answered with WRONG",
    }),
  );
});
