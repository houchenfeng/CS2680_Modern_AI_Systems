import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../types";

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
  const [runId, setRunId] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [eventType, setEventType] = useState("");
  const [toolName, setToolName] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [error, setError] = useState("");
  const runsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!chatId) {
      runsRef.current = [];
      setRuns([]);
      setRunId("");
      setEvents([]);
      setSummary(null);
      return;
    }
    if (!active) return;
    void fetch(`/api/chats/${chatId}/traces`)
      .then((response) => response.json())
      .then((items: string[]) => {
        const previous = runsRef.current;
        runsRef.current = items;
        setRuns(items);
        const latest = items.at(-1) || "";
        setRunId((current) => {
          if (!current || !items.includes(current)) return latest;
          if (items.length > previous.length && current === previous.at(-1))
            return latest;
          return current;
        });
      })
      .catch((caught) => setError(caught.message));
  }, [chatId, active, refreshKey]);

  useEffect(() => {
    if (!chatId || !runId) return;
    void Promise.all([
      fetch(`/api/traces/${chatId}/${runId}`).then((response) =>
        response.json(),
      ),
      fetch(`/api/traces/${chatId}/${runId}/summary`).then((response) =>
        response.json(),
      ),
    ])
      .then(([nextEvents, nextSummary]) => {
        setEvents(nextEvents);
        setSummary(nextSummary);
      })
      .catch((caught) => setError(caught.message));
  }, [chatId, runId]);

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
        .sort((a, b) => a.sequence - b.sequence),
    [events, eventType, toolName, errorsOnly],
  );
  const toolNames = useMemo(
    () =>
      [
        ...new Set(events.map((event) => event.toolName).filter(Boolean)),
      ] as string[],
    [events],
  );
  const runStartedAt = events.length
    ? Date.parse(
        [...events].sort((a, b) => a.sequence - b.sequence)[0].timestamp,
      )
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

  if (!chatId)
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        Select a session to inspect traces.
      </div>
    );
  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-xs text-slate-600">
            Run
            <select
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              className="mt-1 block max-w-xs rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {runs.map((run, index) => (
                <option key={run} value={run}>
                  {`Turn ${index + 1} · ${run}`}
                </option>
              ))}
            </select>
            {runs.length ? (
              <span className="mt-1 block text-[11px] text-slate-400">
                {runs.length} run{runs.length === 1 ? "" : "s"} in this session
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
          {runId ? (
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
                summary.ledger.map((item) => (
                  <dl
                    key={item.runId}
                    className="grid grid-cols-2 gap-1 text-sm"
                  >
                    <dt>Measurement</dt>
                    <dd>{item.measurement}</dd>
                    <dt>Model</dt>
                    <dd>{item.model || "unavailable"}</dd>
                    <dt>Input / output</dt>
                    <dd>
                      {item.inputTokens ?? "unavailable"} /{" "}
                      {item.outputTokens ?? "unavailable"}
                    </dd>
                    <dt>Cache read / write</dt>
                    <dd>
                      {item.cacheReadTokens ?? "unavailable"} /{" "}
                      {item.cacheWriteTokens ?? "unavailable"}
                    </dd>
                    <dt>Total</dt>
                    <dd>{item.totalTokens ?? "unavailable"}</dd>
                    <dt>Cost</dt>
                    <dd>{item.costUsd ?? "unavailable"}</dd>
                    <dt>Wall-clock duration</dt>
                    <dd>
                      {item.durationMs ?? "unavailable"}
                      {item.durationMs === undefined ? "" : " ms"}
                    </dd>
                    <dt>Hidden context</dt>
                    <dd>unavailable</dd>
                  </dl>
                ))
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
        <section className="space-y-2">
          {filtered.map((event) => {
            const pairedStart = event.toolUseId
              ? toolStarts.get(event.toolUseId)
              : undefined;
            const relativeMs = Math.max(
              0,
              Date.parse(event.timestamp) - runStartedAt,
            );
            return (
              <details
                key={event.eventId}
                className={`rounded-lg border-l-4 bg-white p-3 ${event.eventType === "tool_error" || event.error ? "border-red-300" : event.eventType === "tool_start" ? "border-l-blue-500 border-slate-200" : pairedStart ? "border-l-emerald-500 border-slate-200" : "border-slate-200"}`}
              >
                <summary className="cursor-pointer text-sm">
                  <span className="mr-2 font-mono text-xs text-slate-500">
                    #{event.sequence} · +{relativeMs} ms
                  </span>
                  <strong>{event.eventType}</strong>
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
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(event, null, 2)}
                </pre>
              </details>
            );
          })}
        </section>
        {error ? <p className="text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
