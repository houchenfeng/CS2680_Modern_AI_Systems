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
    | "tool"
    | "harness"
    | "specification"
    | "model"
    | "inconclusive";
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

function stepFailed(draft: Diagnosis, index: number): boolean {
  if (index === 0) return draft.toolCheck.status === "fail";
  if (index === 1) return draft.contextCheck.status === "fail";
  if (index === 2) return draft.specificationCheck.status === "fail";
  return draft.modelCheck.status === "fail";
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
  /** Furthest step the user may open; advances only via Next. */
  const [maxReached, setMaxReached] = useState(0);
  const [evidenceInput, setEvidenceInput] = useState("");
  const [reviseNote, setReviseNote] = useState("");
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
        setMaxReached(0);
      })
      .catch((caught) => setError(caught.message));
  }, [active]);

  const failLockIndex = useMemo(() => {
    if (!draft) return 3;
    for (let index = 0; index < STEPS.length; index += 1) {
      if (stepFailed(draft, index)) return index;
    }
    return STEPS.length - 1;
  }, [draft]);

  const canOpenStep = (index: number) =>
    index <= maxReached && index <= failLockIndex;

  const loadFixture = (key: string) => {
    if (!fixtures) return;
    setSelectedKey(key);
    setDraft(fixtures[key]);
    setStepIndex(0);
    setMaxReached(0);
    setSavedId("");
    setReviseNote("");
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

  const goNext = () => {
    if (!draft) return;
    if (stepFailed(draft, stepIndex)) return;
    const next = Math.min(stepIndex + 1, STEPS.length - 1);
    setStepIndex(next);
    setMaxReached((prev) => Math.max(prev, next));
  };

  const goPrev = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
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

  const reviseSaved = async () => {
    if (!draft || !savedId) return;
    if (!draft.evidenceRefs.length) {
      setError("修订同样需要 evidenceRef。");
      return;
    }
    const taskId = encodeURIComponent(draft.taskId);
    const response = await fetch(
      `/api/failure-diagnoses/${taskId}/${encodeURIComponent(savedId)}/revise`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classification: draft.classification,
          confidence: draft.confidence,
          toolCheck: draft.toolCheck,
          contextCheck: draft.contextCheck,
          specificationCheck: draft.specificationCheck,
          modelCheck: draft.modelCheck,
          addedEvidenceRefs: draft.evidenceRefs,
          note: reviseNote || "manual revision from diagnosis wizard",
        }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error?.message || `Revise failed (${response.status})`,
      );
    }
    const revision = (await response.json()) as Diagnosis;
    setDraft(revision);
    setSavedId(revision.diagnosisId);
    setReviseNote("");
  };

  if (!active) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-lg border border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold">Failure Diagnosis Wizard</h1>
          <p className="mt-1 text-sm text-slate-600">
            固定顺序：Tool → Harness/Context → Specification →
            Model。须用 Next 逐步推进；前一步 fail 后后续不可进入；无 evidence
            只能 inconclusive。
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
                    disabled={!canOpenStep(index)}
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={stepIndex === 0}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={
                    stepIndex >= STEPS.length - 1 ||
                    stepFailed(draft, stepIndex) ||
                    stepIndex >= failLockIndex
                  }
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next
                </button>
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
                {typeof draft.revision === "number" ? (
                  <div>
                    <dt className="text-xs text-slate-500">Revision</dt>
                    <dd>{draft.revision}</dd>
                  </div>
                ) : null}
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
              {savedId ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded border border-amber-200 bg-amber-50 p-3">
                  <label className="text-xs text-slate-600">
                    Revise note (append-only revision)
                    <input
                      value={reviseNote}
                      onChange={(event) => setReviseNote(event.target.value)}
                      className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="why classification changed"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void reviseSaved().catch((caught) =>
                        setError(caught.message),
                      )
                    }
                    className="rounded border border-amber-700 px-3 py-1.5 text-amber-900"
                  >
                    Revise diagnosis
                  </button>
                </div>
              ) : null}
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
