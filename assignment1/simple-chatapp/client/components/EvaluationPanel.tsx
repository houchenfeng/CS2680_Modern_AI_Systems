import { useEffect, useState } from "react";

interface Aggregate {
  phase: string;
  overall: {
    attempts: number;
    successes: number;
    successRate: number;
    bernoulliVariance: number;
    providerCostPerCompletion?: number;
    providerCostPerCompletionRounded?: number;
    peakCostPerCompletion?: number;
    peakCostPerCompletionRounded?: number;
    failedCostShare: number;
    wall?: Record<string, number>;
    ttfu?: Record<string, number>;
  };
  byTask: Record<string, any>;
  byCache: Record<string, any>;
  failureDistribution: Record<string, number>;
  caseStudies: Array<{
    attemptId: string;
    taskId: string;
    classification?: string;
    costUsd?: number;
  }>;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value?: number) {
  return value === undefined || value === null
    ? "undefined"
    : `$${value.toFixed(4)}`;
}

export function EvaluationPanel({ active = true }: { active?: boolean }) {
  const [phase, setPhase] = useState<"pilot" | "final">("final");
  const [report, setReport] = useState<Aggregate | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    void fetch(`/api/evaluation/${phase}/aggregate`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setReport(payload);
        setError("");
      })
      .catch((caught) => {
        setReport(null);
        setError(caught.message);
      });
  }, [active, phase]);

  if (!active) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-lg border border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold">Evaluation Results</h1>
          <p className="mt-1 text-sm text-slate-600">
            自动聚合 raw attempt summaries。agent 自报完成不计入 success；成本分子含失败。
          </p>
          <div className="mt-3 flex gap-2">
            {(["pilot", "final"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPhase(item)}
                className={`rounded px-3 py-1.5 text-sm ${
                  phase === item
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </header>

        {report ? (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <Stat
                label="Success rate"
                value={`${report.overall.successes}/${report.overall.attempts} (${pct(report.overall.successRate)})`}
              />
              <Stat
                label="Provider $/completion"
                value={money(report.overall.providerCostPerCompletionRounded ?? report.overall.providerCostPerCompletion)}
              />
              <Stat
                label="Peak normalized $/completion"
                value={money(report.overall.peakCostPerCompletionRounded ?? report.overall.peakCostPerCompletion)}
              />
              <Stat
                label="Failed cost share"
                value={pct(report.overall.failedCostShare)}
              />
              <Stat
                label="Bernoulli variance p(1-p)"
                value={report.overall.bernoulliVariance.toFixed(4)}
              />
              <Stat
                label="TTFU mean (ms)"
                value={String(report.overall.ttfu?.mean?.toFixed?.(1) ?? "n/a")}
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Per-task</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Success</th>
                      <th>$/completion</th>
                      <th>Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.byTask).map(([taskId, row]) => (
                      <tr key={taskId}>
                        <td>{taskId}</td>
                        <td>
                          {row.successes}/{row.attempts} ({pct(row.successRate)})
                        </td>
                        <td>
                          {row.costPerCompletionRounded === undefined &&
                          row.costPerCompletion === undefined
                            ? "undefined"
                            : money(
                                row.costPerCompletionRounded ??
                                  row.costPerCompletion,
                              )}
                        </td>
                        <td>{JSON.stringify(row.failureClasses || {})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <h2 className="font-semibold">Cache strata</h2>
                <pre className="mt-2 overflow-auto text-xs">
                  {JSON.stringify(report.byCache, null, 2)}
                </pre>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <h2 className="font-semibold">Failure distribution</h2>
                <pre className="mt-2 overflow-auto text-xs">
                  {JSON.stringify(report.failureDistribution, null, 2)}
                </pre>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-semibold">Case studies</h2>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {report.caseStudies.map((item) => (
                  <li key={item.attemptId}>
                    {item.attemptId} · {item.taskId} · {item.classification} ·{" "}
                    {money(item.costUsd)}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {error
              ? `No aggregate yet (${error}). Run npm run eval:pilot / eval:final.`
              : "Loading…"}
          </p>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
