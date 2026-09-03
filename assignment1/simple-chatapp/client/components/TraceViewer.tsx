import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../types";
import {
  buildCallViewModels,
  diffAdjacentCalls,
  type CallViewModel,
} from "../call-view";

const ALL_RUNS = "__all__";

interface Summary {
  ledger: Array<{
    runId: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    durationMs?: number;
    measurement: string;
  }>;
  context: Record<
    string,
    { events: number; bytes: number; estimatedTokens: number }
  >;
}

function RequestSnapshotCard({ event }: { event: AgentEvent }) {
  return (
    <div className="mt-3 space-y-3">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {event.observabilityNote ||
          "This snapshot only includes application-controlled inputs. It does not include hidden SDK runtime or Anthropic server-side prompts."}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Model</dt>
          <dd className="font-mono text-xs">{event.model || "unavailable"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">
            Working directory
          </dt>
          <dd className="break-all font-mono text-xs">
            {event.cwd || "unavailable"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-slate-500">Tools</dt>
          <dd className="font-mono text-xs">
            {Array.isArray(event.tools) && event.tools.length
              ? event.tools.join(", ")
              : "unavailable"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-slate-500">
            Project instruction source
          </dt>
          <dd className="font-mono text-xs">
            {event.projectInstructionSource || "unavailable"}
            {event.projectInstructionStatus
              ? ` · ${event.projectInstructionStatus}`
              : ""}
          </dd>
        </div>
      </dl>
      <details className="rounded border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          System prompt
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-950 p-3 text-xs text-slate-100">
          {event.systemPrompt || "unavailable"}
        </pre>
      </details>
      <details className="rounded border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Project instructions
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-950 p-3 text-xs text-slate-100">
          {event.projectInstructions || "unavailable"}
          {event.projectInstructionError
            ? `\n\n[status] ${event.projectInstructionError}`
            : ""}
        </pre>
      </details>
      <details className="rounded border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Raw snapshot JSON
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-950 p-3 text-xs text-slate-100">
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function byTimestampThenSequence(a: AgentEvent, b: AgentEvent) {
  const timeDiff = Date.parse(a.timestamp) - Date.parse(b.timestamp);
  if (timeDiff !== 0) return timeDiff;
  if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
  return a.sequence - b.sequence;
}

function mergeContext(summaries: Summary[]): Summary["context"] {
  const merged: Summary["context"] = {};
  for (const summary of summaries) {
    for (const [category, values] of Object.entries(summary.context || {})) {
      const current = (merged[category] ||= {
        events: 0,
        bytes: 0,
        estimatedTokens: 0,
      });
      current.events += values.events;
      current.bytes += values.bytes;
      current.estimatedTokens += values.estimatedTokens;
    }
  }
  return merged;
}

function sumLedgerField(
  ledger: Summary["ledger"],
  field:
    | "inputTokens"
    | "outputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "totalTokens"
    | "costUsd"
    | "durationMs",
) {
  let sum = 0;
  let sawValue = false;
  for (const item of ledger) {
    const value = item[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      sawValue = true;
    }
  }
  return sawValue ? sum : undefined;
}

function formatLedgerNumber(value: number | undefined) {
  return value === undefined ? "unavailable" : value;
}

function LedgerRows({
  item,
  showRun = false,
}: {
  item: Summary["ledger"][number];
  showRun?: boolean;
}) {
  return (
    <dl className="grid grid-cols-2 gap-1 text-sm">
      {showRun ? (
        <>
          <dt>Run</dt>
          <dd className="truncate font-mono text-xs">{item.runId}</dd>
        </>
      ) : null}
      <dt>Measurement</dt>
      <dd>{item.measurement}</dd>
      <dt>Model</dt>
      <dd>{item.model || "unavailable"}</dd>
      <dt>Input / output</dt>
      <dd>
        {formatLedgerNumber(item.inputTokens)} /{" "}
        {formatLedgerNumber(item.outputTokens)}
      </dd>
      <dt>Cache read / write</dt>
      <dd>
        {formatLedgerNumber(item.cacheReadTokens)} /{" "}
        {formatLedgerNumber(item.cacheWriteTokens)}
      </dd>
      <dt>Total</dt>
      <dd>{formatLedgerNumber(item.totalTokens)}</dd>
      <dt>Cost</dt>
      <dd>{formatLedgerNumber(item.costUsd)}</dd>
      <dt>Wall-clock duration</dt>
      <dd>
        {formatLedgerNumber(item.durationMs)}
        {item.durationMs === undefined ? "" : " ms"}
      </dd>
      <dt>Hidden context</dt>
      <dd>unavailable</dd>
    </dl>
  );
}

async function loadRunEvents(chatId: string, runId: string) {
  const response = await fetch(`/api/traces/${chatId}/${runId}`);
  if (!response.ok) throw new Error(`Failed to load run ${runId}`);
  return (await response.json()) as AgentEvent[];
}

async function loadRunSummary(chatId: string, runId: string) {
  const response = await fetch(`/api/traces/${chatId}/${runId}/summary`);
  if (!response.ok) throw new Error(`Failed to load summary for ${runId}`);
  return (await response.json()) as Summary;
}

export function TraceViewer({
  chatId,
  active = true,
  refreshKey = 0,
}: {
  chatId: string | null;
  active?: boolean;
  refreshKey?: number;
}) {
  const [runs, setRuns] = useState<string[]>([]);
  const [runId, setRunId] = useState(ALL_RUNS);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [eventType, setEventType] = useState("");
  const [toolName, setToolName] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"events" | "calls">("calls");
  const runsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!chatId) {
      runsRef.current = [];
      setRuns([]);
      setRunId(ALL_RUNS);
      setEvents([]);
      setSummary(null);
      return;
    }
    if (!active) return;
    void fetch(`/api/chats/${chatId}/traces`)
      .then((response) => response.json())
      .then((items: string[]) => {
        runsRef.current = items;
        setRuns(items);
        setRunId((current) => {
          if (current === ALL_RUNS) return ALL_RUNS;
          if (!current || !items.includes(current)) return ALL_RUNS;
          return current;
        });
      })
      .catch((caught) => setError(caught.message));
  }, [chatId, active, refreshKey]);

  useEffect(() => {
    if (!chatId || !runId) return;
    if (runId === ALL_RUNS) {
      if (!runs.length) {
        setEvents([]);
        setSummary({ ledger: [], context: {} });
        return;
      }
      void Promise.all([
        Promise.all(runs.map((id) => loadRunEvents(chatId, id))),
        Promise.all(runs.map((id) => loadRunSummary(chatId, id))),
      ])
        .then(([eventGroups, summaries]) => {
          setEvents(eventGroups.flat().sort(byTimestampThenSequence));
          setSummary({
            ledger: summaries.flatMap((item) => item.ledger),
            context: mergeContext(summaries),
          });
          setError("");
        })
        .catch((caught) => setError(caught.message));
      return;
    }

    void Promise.all([
      loadRunEvents(chatId, runId),
      loadRunSummary(chatId, runId),
    ])
      .then(([nextEvents, nextSummary]) => {
        setEvents(nextEvents);
        setSummary(nextSummary);
        setError("");
      })
      .catch((caught) => setError(caught.message));
  }, [chatId, runId, runs, refreshKey]);

  const filtered = useMemo(
    () =>
      events
        .filter(
          (event) =>
            (!eventType || event.eventType === eventType) &&
            (!toolName || event.toolName === toolName) &&
            (!errorsOnly ||
              event.eventType === "tool_error" ||
              Boolean(event.error)),
        )
        .sort(
          runId === ALL_RUNS
            ? byTimestampThenSequence
            : (a, b) => a.sequence - b.sequence,
        ),
    [events, eventType, toolName, errorsOnly, runId],
  );
  const toolNames = useMemo(
    () =>
      [
        ...new Set(events.map((event) => event.toolName).filter(Boolean)),
      ] as string[],
    [events],
  );
  const timelineStart = filtered.length
    ? Date.parse(filtered[0].timestamp)
    : events.length
      ? Date.parse([...events].sort(byTimestampThenSequence)[0].timestamp)
      : 0;
  const toolStarts = useMemo(
    () =>
      new Map(
        events
          .filter((event) => event.eventType === "tool_start")
          .map((event) => [event.toolUseId, event]),
      ),
    [events],
  );
  const calls = useMemo(() => buildCallViewModels(events), [events]);

  const downloadAllJsonl = () => {
    const body = events
      .slice()
      .sort(byTimestampThenSequence)
      .map((event) => JSON.stringify(event))
      .join("\n");
    const blob = new Blob([body ? `${body}\n` : ""], {
      type: "application/x-ndjson",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${chatId || "session"}-all-runs.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!chatId)
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        Select a session to inspect traces.
      </div>
    );
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-xs text-slate-600">
            Run
            <select
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              className="mt-1 block max-w-xs rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value={ALL_RUNS}>ALL · all turns</option>
              {runs.map((run, index) => (
                <option key={run} value={run}>
                  {`Turn ${index + 1} · ${run}`}
                </option>
              ))}
            </select>
            {runs.length ? (
              <span className="mt-1 block text-[11px] text-slate-400">
                {runs.length} run{runs.length === 1 ? "" : "s"} in this session
                {runId === ALL_RUNS ? " · showing oldest → newest" : ""}
              </span>
            ) : null}
          </label>
          <label className="text-xs text-slate-600">
            Event type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {[
                "request_snapshot",
                "user_message",
                "assistant_message",
                "tool_start",
                "tool_result",
                "tool_error",
                "permission_request",
                "permission_result",
                "run_result",
                "system",
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Tool
            <select
              value={toolName}
              onChange={(event) => setToolName(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {toolNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(event) => setErrorsOnly(event.target.checked)}
            />{" "}
            Errors only
          </label>
          <div className="flex items-center gap-1 rounded border border-slate-300 p-0.5 text-sm">
            <button
              type="button"
              className={`rounded px-2 py-1 ${viewMode === "calls" ? "bg-slate-900 text-white" : ""}`}
              onClick={() => setViewMode("calls")}
            >
              Calls
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${viewMode === "events" ? "bg-slate-900 text-white" : ""}`}
              onClick={() => setViewMode("events")}
            >
              Events
            </button>
          </div>
          {runId === ALL_RUNS ? (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={downloadAllJsonl}
                disabled={!events.length}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download JSONL
              </button>
            </div>
          ) : runId ? (
            <div className="ml-auto flex gap-2">
              <a
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                href={`/api/traces/${chatId}/${runId}/raw`}
                download
              >
                Download JSONL
              </a>
              <a
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                href={`/api/traces/${chatId}/${runId}/context.csv`}
                download
              >
                Context CSV
              </a>
            </div>
          ) : null}
        </header>
        {summary ? (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-semibold">Token ledger</h2>
              {summary.ledger.length ? (
                <div className="space-y-3">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Session total
                      {runId === ALL_RUNS
                        ? ` · ${summary.ledger.length} turn${summary.ledger.length === 1 ? "" : "s"}`
                        : ""}
                    </p>
                    <dl className="grid grid-cols-2 gap-1 text-sm">
                      <dt>Input tokens</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "inputTokens"),
                        )}
                      </dd>
                      <dt>Output tokens</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "outputTokens"),
                        )}
                      </dd>
                      <dt>Cache read / write</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "cacheReadTokens"),
                        )}{" "}
                        /{" "}
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "cacheWriteTokens"),
                        )}
                      </dd>
                      <dt>Total tokens</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "totalTokens"),
                        )}
                      </dd>
                      <dt>Cost</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "costUsd"),
                        )}
                      </dd>
                      <dt>Wall-clock duration</dt>
                      <dd>
                        {formatLedgerNumber(
                          sumLedgerField(summary.ledger, "durationMs"),
                        )}
                        {sumLedgerField(summary.ledger, "durationMs") ===
                        undefined
                          ? ""
                          : " ms"}
                      </dd>
                    </dl>
                  </div>
                  {summary.ledger.map((item, index) => {
                    const turnIndex = runs.indexOf(item.runId);
                    const label =
                      turnIndex >= 0
                        ? `Turn ${turnIndex + 1}`
                        : `Turn ${index + 1}`;
                    return (
                      <details
                        key={item.runId}
                        className="rounded border border-slate-200 bg-white"
                      >
                        <summary className="cursor-pointer list-none px-3 py-2 text-sm marker:content-none [&::-webkit-details-marker]:hidden">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">
                              {label}
                              <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                                {item.runId}
                              </span>
                            </span>
                            <span className="text-xs text-slate-500">
                              in {formatLedgerNumber(item.inputTokens)} / out{" "}
                              {formatLedgerNumber(item.outputTokens)} · total{" "}
                              {formatLedgerNumber(item.totalTokens)}
                            </span>
                          </div>
                        </summary>
                        <div className="border-t border-slate-100 px-3 py-3">
                          <LedgerRows item={item} showRun />
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Usage unavailable</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-semibold">Observable context</h2>
              <p className="mb-2 text-xs text-slate-500">
                Categories are computed deterministically during export. Hidden
                context is unavailable and is never estimated.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Events</th>
                      <th>Bytes</th>
                      <th>Est. tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.context).map(
                      ([category, values]) => (
                        <tr key={category}>
                          <td>{category}</td>
                          <td>{values.events}</td>
                          <td>{values.bytes}</td>
                          <td>{values.estimatedTokens}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
        {viewMode === "calls" ? (
          <CallsPanel calls={calls} />
        ) : (
          <section className="space-y-2">
            {filtered.map((event) => {
              const pairedStart = event.toolUseId
                ? toolStarts.get(event.toolUseId)
                : undefined;
              const relativeMs = Math.max(
                0,
                Date.parse(event.timestamp) - timelineStart,
              );
              const turnIndex = runs.indexOf(event.runId);
              return (
                <details
                  key={event.eventId}
                  className={`rounded-lg border-l-4 bg-white p-3 ${event.eventType === "request_snapshot" ? "border-l-violet-500 border-slate-200" : event.eventType === "tool_error" || event.error ? "border-red-300" : event.eventType === "tool_start" ? "border-l-blue-500 border-slate-200" : pairedStart ? "border-l-emerald-500 border-slate-200" : "border-slate-200"}`}
                >
                  <summary className="cursor-pointer text-sm">
                    <span className="mr-2 font-mono text-xs text-slate-500">
                      {runId === ALL_RUNS && turnIndex >= 0
                        ? `T${turnIndex + 1} · `
                        : ""}
                      #{event.sequence} · +{relativeMs} ms
                    </span>
                    <strong>
                      {event.eventType === "request_snapshot"
                        ? "Observable request snapshot"
                        : event.eventType}
                    </strong>
                    {event.toolName ? ` · ${event.toolName}` : ""}
                    <span className="ml-2 text-xs text-slate-400">
                      event {event.eventId} · run {event.runId}
                      {event.toolUseId ? ` · tool ${event.toolUseId}` : ""}
                    </span>
                    {pairedStart && event.eventType !== "tool_start" ? (
                      <span className="ml-2 text-xs text-emerald-700">
                        paired with #{pairedStart.sequence}
                      </span>
                    ) : null}
                  </summary>
                  {event.eventType === "request_snapshot" ? (
                    <RequestSnapshotCard event={event} />
                  ) : (
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-100">
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  )}
                </details>
              );
            })}
          </section>
        )}
        {error ? <p className="text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}

function formatMaybe(value: unknown) {
  if (value === null || value === undefined) return "unavailable";
  if (typeof value === "number")
    return Number.isFinite(value) ? value : "unavailable";
  return String(value);
}

function CallsPanel({ calls }: { calls: CallViewModel[] }) {
  if (!calls.length) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        No model calls captured yet. Observed requests appear here after the
        localhost observation proxy records `/v1/messages` traffic.
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">
        Model calls{" "}
        <span className="text-sm font-normal text-slate-500">
          {calls.length}
        </span>
      </h2>
      {calls.map((call, index) => {
        const previous = index > 0 ? calls[index - 1] : undefined;
        const diff = diffAdjacentCalls(previous, call);
        const usage = call.callUsage || {};
        return (
          <details
            key={call.callId}
            open={index === calls.length - 1}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <summary className="cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    Call {index + 1}{" "}
                    <span className="font-mono text-xs font-normal text-slate-500">
                      {call.callId}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    run {call.runId}
                    {call.providerRequestId
                      ? ` · provider ${call.providerRequestId}`
                      : ""}
                    {call.parentCallId ? ` · parent ${call.parentCallId}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <div>
                    coverage{" "}
                    {call.coverage === null || call.coverage === undefined
                      ? "unavailable"
                      : `${(call.coverage * 100).toFixed(2)}%`}
                  </div>
                  <div>
                    in{" "}
                    {formatMaybe(
                      usage.logicalInputTokens ?? usage.uncachedInputTokens,
                    )}{" "}
                    / out {formatMaybe(usage.outputTokens)}
                  </div>
                </div>
              </div>
            </summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tokens &amp; cache
                </h3>
                <dl className="grid grid-cols-2 gap-1">
                  <dt>Uncached</dt>
                  <dd>{formatMaybe(usage.uncachedInputTokens)}</dd>
                  <dt>Cache read</dt>
                  <dd>{formatMaybe(usage.cacheReadTokens)}</dd>
                  <dt>Cache write</dt>
                  <dd>{formatMaybe(usage.cacheWriteTokens)}</dd>
                  <dt>Logical input</dt>
                  <dd>{formatMaybe(usage.logicalInputTokens)}</dd>
                  <dt>Output</dt>
                  <dd>{formatMaybe(usage.outputTokens)}</dd>
                  <dt>Residual</dt>
                  <dd>{formatMaybe(call.residual)}</dd>
                </dl>
                <p className="text-xs text-slate-500">
                  Cache is billing state, not a content source.
                  {call.coverageReason ? ` ${call.coverageReason}` : ""}
                </p>
              </div>
              <div className="space-y-2 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cost &amp; timing
                </h3>
                <dl className="grid grid-cols-2 gap-1">
                  <dt>Provider cost</dt>
                  <dd>{formatMaybe(call.providerReportedCostUsd)}</dd>
                  <dt>Normalized peak</dt>
                  <dd>{formatMaybe(call.normalizedPeakCostUsd)}</dd>
                  <dt>Queue</dt>
                  <dd>{formatMaybe(call.timing?.queueMs)} ms</dd>
                  <dt>TTFB</dt>
                  <dd>{formatMaybe(call.timing?.ttfbMs)} ms</dd>
                  <dt>TTFV</dt>
                  <dd>{formatMaybe(call.timing?.timeToFirstVisibleMs)} ms</dd>
                  <dt>TTFU</dt>
                  <dd>{formatMaybe(call.timing?.timeToFirstUsefulMs)} ms</dd>
                  <dt>Wall-clock</dt>
                  <dd>{formatMaybe(call.timing?.wallClockMs)} ms</dd>
                  <dt>API duration</dt>
                  <dd>{formatMaybe(call.timing?.durationApiMs)} ms</dd>
                </dl>
              </div>
            </div>
            {call.sources?.length ? (
              <div className="mt-3 overflow-x-auto">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Provenance sources
                </h3>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Tokens</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {call.sources.map((source) => (
                      <tr key={String(source.id || source.label)}>
                        <td>{String(source.label || source.id)}</td>
                        <td>{formatMaybe(source.tokens)}</td>
                        <td>
                          {typeof source.share === "number"
                            ? `${(source.share * 100).toFixed(2)}%`
                            : "unavailable"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {previous ? (
              <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-xs">
                <h3 className="mb-1 font-semibold text-slate-600">
                  Context diff vs previous call
                </h3>
                <p>Added: {diff.added.length || 0}</p>
                <p>Retained: {diff.retained.length || 0}</p>
                <p>Removed: {diff.removed.length || 0}</p>
                <p>Summarized: {diff.summarized.length || 0}</p>
              </div>
            ) : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-500">
                Fragments &amp; raw evidence ({call.fragments.length})
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(
                  {
                    observation: call.observation,
                    fragments: call.fragments,
                    contextLedger: call.contextLedger,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </details>
        );
      })}
    </section>
  );
}
