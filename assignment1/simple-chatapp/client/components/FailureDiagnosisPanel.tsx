import { useEffect, useMemo, useState } from "react";

type CheckStatus = "pass" | "fail" | "not_reached" | "not_applicable";

interface Diagnosis {
  diagnosisId: string;
  taskId: string;
  attemptId: string;
  terminalFailureEventId: string;
  symptom: string;
  impact: string;
  toolCheck: {
    status: CheckStatus;
    evidenceRefs: string[];
    conclusion: string;
  };
  contextCheck: {
    status: CheckStatus;
    designedRef: string;
    sentRef: string;
    diffRef: string;
    conclusion: string;
  };
  specificationCheck: {
    status: CheckStatus;
    specHash: string;
    humanContractorAnswer: string;
    conclusion: string;
  };
  modelCheck: {
    status: CheckStatus;
    callIds: string[];
    conclusion: string;
  };
  classification:
    "tool" | "harness" | "specification" | "model" | "inconclusive";
  confidence: "high" | "medium" | "low";
  evidenceRefs: string[];
  revision?: number;
}

const STEPS = ["tool", "harness", "specification", "model"] as const;

function statusColor(status: CheckStatus) {
  if (status === "pass") return "text-emerald-700";
  if (status === "fail") return "text-red-700";
  if (status === "not_applicable") return "text-slate-500";
  return "text-amber-700";
}

export function FailureDiagnosisPanel({
  chatId,
  active = true,
}: {
  chatId: string | null;
  active?: boolean;
}) {
  const [fixtures, setFixtures] = useState<Record<string, Diagnosis> | null>(
    null,
  );
  const [selectedKey, setSelectedKey] = useState("tool");
  const [draft, setDraft] = useState<Diagnosis | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [evidenceInput, setEvidenceInput] = useState("");
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState("");

  useEffect(() => {
    if (!active) return;
    void fetch("/api/failure-diagnoses/fixtures")
      .then((response) => response.json())
      .then((payload) => {
        setFixtures(payload);
        setDraft(payload.tool);
        setSelectedKey("tool");
        setStepIndex(0);
      })
      .catch((caught) => setError(caught.message));
  }, [active]);

  const lockedSteps = useMemo(() => {
    if (!draft)
      return { tool: false, harness: true, specification: true, model: true };
    return {
      tool: false,
      harness: draft.toolCheck.status === "fail",
      specification:
        draft.toolCheck.status === "fail" ||
        draft.contextCheck.status === "fail",
      model:
        draft.toolCheck.status !== "pass" ||
        draft.contextCheck.status !== "pass" ||
        draft.specificationCheck.status !== "pass",
    };
  }, [draft]);

  const loadFixture = (key: string) => {
    if (!fixtures) return;
    setSelectedKey(key);
    setDraft(fixtures[key]);
    setStepIndex(0);
    setSavedId("");
    setError("");
  };

  const addEvidence = () => {
    if (!draft || !evidenceInput.trim()) return;
    const ref = evidenceInput.trim();
    setDraft({
      ...draft,
      evidenceRefs: [...new Set([...draft.evidenceRefs, ref])],
      toolCheck: {
        ...draft.toolCheck,
        evidenceRefs: [...new Set([...draft.toolCheck.evidenceRefs, ref])],
      },
    });
    setEvidenceInput("");
  };

  const saveDiagnosis = async () => {
    if (!draft) return;
    if (!draft.evidenceRefs.length) {
      setError("每个结论必须有 evidenceRef；无证据只能 inconclusive。");
      return;
    }
    const payload = {
      ...draft,
      taskId: chatId ? `${chatId}/manual` : draft.taskId,
    };
    const response = await fetch("/api/failure-diagnoses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error?.message || `Save failed (${response.status})`,
      );
    }
    const saved = (await response.json()) as Diagnosis;
    setSavedId(saved.diagnosisId);
    setDraft(saved);
  };

  if (!active) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-lg border border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold">Failure Diagnosis Wizard</h1>
          <p className="mt-1 text-sm text-slate-600">
            固定顺序：Tool → Harness/Context → Specification → Model。前一步
            fail 后后续为 not_reached；无 evidence 只能 inconclusive。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fixtures
              ? Object.keys(fixtures).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => loadFixture(key)}
                    className={`rounded border px-3 py-1 text-sm ${
                      selectedKey === key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {key}
                  </button>
                ))
              : null}
          </div>
        </header>

        {draft ? (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                {STEPS.map((step, index) => (
                  <button
                    key={step}
                    type="button"
                    disabled={index > 0 && lockedSteps[STEPS[index]]}
                    onClick={() => setStepIndex(index)}
                    className={`rounded px-3 py-1.5 text-sm capitalize ${
                      stepIndex === index
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {index + 1}. {step}
                  </button>
                ))}
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Symptom</dt>
                  <dd>{draft.symptom}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Impact</dt>
                  <dd>{draft.impact}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Classification</dt>
                  <dd className="font-medium">{draft.classification}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Confidence</dt>
                  <dd>{draft.confidence}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              {stepIndex === 0 ? (
                <CheckCard
                  title="Tool check"
                  status={draft.toolCheck.status}
                  conclusion={draft.toolCheck.conclusion}
                  evidenceRefs={draft.toolCheck.evidenceRefs}
                />
              ) : null}
              {stepIndex === 1 ? (
                <CheckCard
                  title="Harness / context check"
                  status={draft.contextCheck.status}
                  conclusion={draft.contextCheck.conclusion}
                  evidenceRefs={[
                    draft.contextCheck.designedRef,
                    draft.contextCheck.sentRef,
                    draft.contextCheck.diffRef,
                  ].filter(Boolean)}
                />
              ) : null}
              {stepIndex === 2 ? (
                <CheckCard
                  title="Specification check"
                  status={draft.specificationCheck.status}
                  conclusion={draft.specificationCheck.conclusion}
                  evidenceRefs={[draft.specificationCheck.specHash].filter(
                    Boolean,
                  )}
                  extra={`Human contractor: ${draft.specificationCheck.humanContractorAnswer}`}
                />
              ) : null}
              {stepIndex === 3 ? (
                <CheckCard
                  title="Model check"
                  status={draft.modelCheck.status}
                  conclusion={draft.modelCheck.conclusion}
                  evidenceRefs={draft.modelCheck.callIds}
                />
              ) : null}

              <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
                <label className="text-xs text-slate-600">
                  Add evidenceRef
                  <input
                    value={evidenceInput}
                    onChange={(event) => setEvidenceInput(event.target.value)}
                    className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="ev-sha256 / callId / artifact path"
                  />
                </label>
                <button
                  type="button"
                  onClick={addEvidence}
                  className="rounded border border-slate-300 px-3 py-1.5"
                >
                  Attach
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void saveDiagnosis().catch((caught) =>
                      setError(caught.message),
                    )
                  }
                  className="rounded bg-slate-900 px-3 py-1.5 text-white"
                >
                  Persist diagnosis
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Evidence refs: {draft.evidenceRefs.join(", ") || "(none)"}
              </p>
              {savedId ? (
                <p className="mt-2 text-xs text-emerald-700">
                  Saved diagnosisId: {savedId}
                </p>
              ) : null}
            </section>
          </>
        ) : (
          <p className="text-sm text-slate-500">Loading fixtures…</p>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}

function CheckCard({
  title,
  status,
  conclusion,
  evidenceRefs,
  extra,
}: {
  title: string;
  status: CheckStatus;
  conclusion: string;
  evidenceRefs: string[];
  extra?: string;
}) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className={`mt-1 text-sm font-medium ${statusColor(status)}`}>
        status: {status}
      </p>
      <p className="mt-2 text-sm text-slate-700">{conclusion}</p>
      {extra ? <p className="mt-2 text-xs text-slate-500">{extra}</p> : null}
      <ul className="mt-3 list-disc pl-5 text-xs text-slate-600">
        {evidenceRefs.length ? (
          evidenceRefs.map((ref) => <li key={ref}>{ref}</li>)
        ) : (
          <li>No evidence refs — diagnosis must stay inconclusive.</li>
        )}
      </ul>
    </div>
  );
}
