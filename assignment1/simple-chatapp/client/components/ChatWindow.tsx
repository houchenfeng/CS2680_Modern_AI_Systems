import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AgentEvent, Chat } from "../types";

interface Props {
  chatId: string | null;
  events: AgentEvent[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  chat: Chat | null;
  onStop: () => void;
  onResolvePermission: (
    requestId: string,
    decision: "allow" | "deny",
    alwaysAllow?: boolean,
  ) => void;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="mt-2 rounded border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">
        {label}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function ToolCard({
  start,
  result,
}: {
  start: AgentEvent;
  result?: AgentEvent;
}) {
  const status = !result
    ? "running"
    : result.eventType === "tool_error"
      ? "error"
      : "success";
  const duration = result?.durationMs;
  return (
    <article
      className="rounded-lg border border-slate-300 bg-slate-50 p-3"
      data-tool-id={start.toolUseId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-slate-800">{start.toolName}</strong>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${status === "success" ? "bg-emerald-100 text-emerald-700" : status === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
        >
          {status}
        </span>
        <time className="text-xs text-slate-500">
          {new Date(start.timestamp).toLocaleTimeString()}
        </time>
        {duration !== undefined ? (
          <span className="text-xs text-slate-500">{duration} ms</span>
        ) : null}
      </div>
      <JsonDetails label="Input" value={start.input} />
      {result &&
      (result.toolName === "Bash" || start.toolName === "Bash") ? (
        <div className="mt-2 grid gap-2">
          <p className="text-xs font-medium text-slate-600">
            Exit code: {result.exitCode ?? "unavailable"}
          </p>
          {result.stdout !== undefined ? (
            <JsonDetails label="stdout" value={result.stdout} />
          ) : null}
          {result.stderr !== undefined ? (
            <JsonDetails label="stderr" value={result.stderr} />
          ) : null}
        </div>
      ) : null}
      {result ? (
        <JsonDetails
          label={`${status === "error" ? "Error" : "Output"}${result.truncated ? ` (truncated from ${result.originalLength} characters)` : ""}`}
          value={result.error || result.output}
        />
      ) : null}
    </article>
  );
}

function Timeline({ events }: { events: AgentEvent[] }) {
  const toolResults = useMemo(
    () =>
      new Map(
        events
          .filter(
            (event) =>
              event.eventType === "tool_result" ||
              event.eventType === "tool_error",
          )
          .map((event) => [event.toolUseId, event]),
      ),
    [events],
  );

  return events.map((event) => {
    if (event.eventType === "tool_result" || event.eventType === "tool_error")
      return null;
    if (event.eventType === "tool_start")
      return (
        <ToolCard
          key={event.eventId}
          start={event}
          result={toolResults.get(event.toolUseId)}
        />
      );
    if (
      event.eventType === "user_message" ||
      event.eventType === "assistant_message"
    ) {
      const user = event.eventType === "user_message";
      return (
        <div
          key={event.eventId}
          className={`flex ${user ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[82%] rounded-xl px-4 py-3 ${user ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-900"}`}
          >
            <p className="whitespace-pre-wrap">{event.content}</p>
            <time
              className={`mt-1 block text-[10px] ${user ? "text-blue-100" : "text-slate-400"}`}
            >
              #{event.sequence} ·{" "}
              {new Date(event.timestamp).toLocaleTimeString()}
            </time>
          </div>
        </div>
      );
    }
    if (event.eventType === "run_result") {
      return (
        <div
          key={event.eventId}
          className="rounded border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600"
        >
          Run {event.status} · {event.durationMs ?? "duration unavailable"} ms
        </div>
      );
    }
    if (event.error || event.level === "error") {
      return (
        <div
          key={event.eventId}
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {event.error?.source}: {event.error?.message || event.message}
        </div>
      );
    }
    return null;
  });
}

export function ChatWindow({
  chatId,
  events,
  isConnected,
  isLoading,
  error,
  onSendMessage,
  chat,
  onStop,
  onResolvePermission,
}: Props) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const pendingPermission = [...events]
    .reverse()
    .find(
      (event) =>
        event.eventType === "permission_request" &&
        !events.some(
          (candidate) =>
            candidate.eventType === "permission_result" &&
            candidate.requestId === event.requestId,
        ),
    );
  const canStop =
    chat?.status === "running" || chat?.status === "waiting_permission";
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || !chatId || isLoading || !isConnected) return;
    onSendMessage(content);
    setInput("");
  };

  if (!chatId)
    return (
      <main className="flex flex-1 items-center justify-center text-slate-500">
        Create or select a chat to begin.
      </main>
    );

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-slate-900">Agent session</h1>
          <p className="truncate text-xs text-slate-500">
            Workspace: {chat?.cwd || chat?.workspacePath || "."} · Policy: read
            and search allowed; writes and commands require approval ·{" "}
            {chat?.status || "new"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onStop}
            disabled={!canStop}
            className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>
          <span
            className={`text-xs font-medium ${isConnected ? "text-emerald-600" : "text-red-600"}`}
          >
            {isConnected ? "● Connected" : "● Disconnected"}
          </span>
        </div>
      </header>
      <section
        className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5"
        aria-live="polite"
      >
        {events.length ? (
          <Timeline events={events} />
        ) : (
          <p className="mt-8 text-center text-sm text-slate-400">
            Send a task to start the trajectory.
          </p>
        )}
        {isLoading ? (
          <div className="text-sm text-slate-500">Agent is working…</div>
        ) : null}
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {pendingPermission ? (
          <div className="sticky bottom-0 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg">
            <p className="font-medium text-amber-900">
              Allow {pendingPermission.toolName}?
            </p>
            <JsonDetails label="Tool input" value={pendingPermission.input} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() =>
                  onResolvePermission(
                    String(pendingPermission.requestId),
                    "allow",
                  )
                }
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white"
              >
                Allow once
              </button>
              <button
                onClick={() =>
                  onResolvePermission(
                    String(pendingPermission.requestId),
                    "allow",
                    true,
                  )
                }
                className="rounded border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700"
              >
                Always this session
              </button>
              <button
                onClick={() =>
                  onResolvePermission(
                    String(pendingPermission.requestId),
                    "deny",
                  )
                }
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white"
              >
                Deny
              </button>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </section>
      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-slate-200 p-4"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!isConnected || isLoading}
          placeholder={isConnected ? "Describe a task…" : "Connecting…"}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={!input.trim() || !isConnected || isLoading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
