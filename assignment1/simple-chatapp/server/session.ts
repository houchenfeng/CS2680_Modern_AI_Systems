import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Chat, WSClient } from "./types.js";
import { AgentSession } from "./ai-client.js";
import {
  buildObservableRequestSnapshot,
  loadProjectInstructions,
  type ObservableRequestSnapshot,
  type ProjectInstructions,
} from "./agent-config.js";
import { chatStore } from "./chat-store.js";
import type { AgentEvent } from "./events.js";
import { normalizeSdkMessage } from "./event-normalizer.js";
import { normalizeError, redact } from "./redaction.js";
import { trajectoryStore } from "./trajectory.js";
import type { ChatStore } from "./chat-store.js";
import type { TrajectoryStore } from "./trajectory.js";

interface PendingPermission {
  requestId: string;
  resolve: (result: PermissionResult) => void;
  timer: NodeJS.Timeout;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  event: AgentEvent;
}

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);
type AgentAdapter = Pick<
  AgentSession,
  "sendMessage" | "getOutputStream" | "interrupt" | "close"
> & {
  getObservableRequest?: () => ObservableRequestSnapshot;
};

export interface SessionDependencies {
  agent?: AgentAdapter;
  agentFactory?: (
    options: ConstructorParameters<typeof AgentSession>[0],
  ) => AgentAdapter;
  store?: ChatStore;
  trajectories?: TrajectoryStore;
  projectInstructions?: ProjectInstructions;
}

export class Session {
  public readonly chatId: string;
  private readonly subscribers = new Set<WSClient>();
  private readonly agentSession: AgentAdapter;
  private readonly store: ChatStore;
  private readonly trajectories: TrajectoryStore;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly alwaysAllowed = new Set<string>();
  private readonly hookApproved = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private readonly projectInstructions: ProjectInstructions;
  private isListening = false;
  private sequence = 0;
  private runId = "";
  private sdkSessionId?: string;
  private status: Chat["status"];
  private stoppedRunId?: string;
  private runStartedAt?: string;
  private stopPromise?: Promise<boolean>;

  static async create(chat: Chat, dependencies: SessionDependencies = {}) {
    if (!chat.cwd) throw new Error("Chat has no validated working directory");
    const projectInstructions =
      dependencies.projectInstructions ||
      (await loadProjectInstructions(chat.cwd));
    return new Session(chat, { ...dependencies, projectInstructions });
  }

  constructor(
    private readonly chat: Chat,
    dependencies: SessionDependencies = {},
  ) {
    this.chatId = chat.id;
    this.sdkSessionId = chat.sdkSessionId;
    const wasInterrupted =
      chat.status === "running" || chat.status === "waiting_permission";
    this.status = chat.sdkSessionId
      ? "resumable"
      : wasInterrupted
        ? "error"
        : chat.status || "new";
    if (!chat.cwd) throw new Error("Chat has no validated working directory");
    this.store = dependencies.store || chatStore;
    this.trajectories = dependencies.trajectories || trajectoryStore;
    this.projectInstructions = dependencies.projectInstructions || {
      text: "unavailable",
      source: "unavailable",
      status: "unavailable",
    };
    const agentOptions = {
      cwd: chat.cwd,
      resume: chat.sdkSessionId,
      canUseTool: this.canUseTool,
      preToolUse: this.preToolUse,
      projectInstructions: this.projectInstructions,
    };
    this.agentSession =
      dependencies.agent ||
      dependencies.agentFactory?.(agentOptions) ||
      new AgentSession(agentOptions);
    if (wasInterrupted)
      this.store.updateChat(this.chatId, { status: this.status });
  }

  private build(
    payload: Partial<AgentEvent> & Pick<AgentEvent, "eventType">,
  ): AgentEvent {
    return {
      schemaVersion: 1,
      eventId: randomUUID(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      chatId: this.chatId,
      runId: this.runId,
      ...payload,
    };
  }

  private setStatus(status: NonNullable<Chat["status"]>) {
    this.status = status;
    this.store.updateChat(this.chatId, {
      status,
      sdkSessionId: this.sdkSessionId,
    });
  }

  private async emit(event: AgentEvent) {
    if (event.toolUseId && event.toolName)
      this.toolNames.set(event.toolUseId, event.toolName);
    if (event.toolUseId && !event.toolName)
      event.toolName = this.toolNames.get(event.toolUseId);
    if (event.sdkSessionId) {
      this.sdkSessionId = event.sdkSessionId;
      this.store.updateChat(this.chatId, { sdkSessionId: event.sdkSessionId });
    }
    try {
      this.broadcast({
        type: "agent_event",
        event: await this.trajectories.append(event),
      });
    } catch (error) {
      this.broadcast({
        type: "agent_event",
        event: redact(
          this.build({
            eventType: "system",
            level: "error",
            message: "Trajectory storage failed",
            error: normalizeError(error, "storage"),
          }),
        ),
      });
    }
  }

  private readonly canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string },
  ): Promise<PermissionResult> => {
    if (this.status !== "running" && this.status !== "waiting_permission")
      return {
        behavior: "deny",
        message: "Run already finished",
        toolUseID: options.toolUseID,
      };
    if (this.hookApproved.delete(options.toolUseID))
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    if (READ_ONLY_TOOLS.has(toolName) || this.alwaysAllowed.has(toolName))
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    const requestId = randomUUID();
    this.setStatus("waiting_permission");
    const permissionEvent = this.build({
      eventType: "permission_request",
      requestId,
      toolName,
      toolUseId: options.toolUseID,
      input,
    });
    await this.emit(permissionEvent);
    return new Promise<PermissionResult>((resolve) => {
      const deny = (reason: string) => {
        if (!this.pendingPermissions.delete(requestId)) return;
        void this.emit(
          this.build({
            eventType: "permission_result",
            requestId,
            toolName,
            toolUseId: options.toolUseID,
            decision: "deny",
            reason,
          }),
        );
        this.setStatus("running");
        resolve({
          behavior: "deny",
          message: reason,
          toolUseID: options.toolUseID,
        });
      };
      const timer = setTimeout(
        () => deny("Permission request timed out"),
        Number(process.env.PERMISSION_TIMEOUT_MS || 60_000),
      );
      this.pendingPermissions.set(requestId, {
        requestId,
        resolve,
        timer,
        toolName,
        input,
        toolUseId: options.toolUseID,
        event: permissionEvent,
      });
      options.signal.addEventListener("abort", () => deny("Run was stopped"), {
        once: true,
      });
    });
  };

  private readonly preToolUse = async (
    input: any,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => {
    const id = toolUseId || input.tool_use_id || randomUUID();
    if (READ_ONLY_TOOLS.has(input.tool_name)) return { continue: true };
    const decision = await this.canUseTool(
      input.tool_name,
      input.tool_input || {},
      { signal: options.signal, toolUseID: id },
    );
    if (decision.behavior === "allow") {
      this.hookApproved.add(id);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          permissionDecisionReason: "Approved through Web UI",
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: decision.message,
      },
    };
  };

  async resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
    alwaysAllow = false,
    reason?: string,
  ) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    clearTimeout(pending.timer);
    if (alwaysAllow && decision === "allow")
      this.alwaysAllowed.add(pending.toolName);
    await this.emit(
      this.build({
        eventType: "permission_result",
        requestId,
        toolName: pending.toolName,
        toolUseId: pending.toolUseId,
        decision,
        reason,
      }),
    );
    this.setStatus(
      this.pendingPermissions.size ? "waiting_permission" : "running",
    );
    pending.resolve(
      decision === "allow"
        ? {
            behavior: "allow",
            updatedInput: pending.input,
            toolUseID: pending.toolUseId,
          }
        : {
            behavior: "deny",
            message: reason || "Denied by user",
            toolUseID: pending.toolUseId,
          },
    );
    return true;
  }

  private async denyPendingPermissions(reason: string) {
    for (const requestId of [...this.pendingPermissions.keys()]) {
      await this.resolvePermission(requestId, "deny", false, reason);
    }
  }

  private async startListening() {
    if (this.isListening) return;
    this.isListening = true;
    try {
      for await (const message of this.agentSession.getOutputStream()) {
        for (const event of normalizeSdkMessage(message, (payload) =>
          this.build(payload),
        )) {
          if (
            event.eventType === "run_result" &&
            this.stoppedRunId === event.runId
          )
            continue;
          if (event.eventType === "assistant_message" && event.content)
            this.store.addMessage(this.chatId, {
              role: "assistant",
              content: event.content,
            });
          if (event.eventType === "run_result") {
            await this.denyPendingPermissions("Run already finished");
            const endedAt = new Date().toISOString();
            event.startedAt = this.runStartedAt;
            event.endedAt = endedAt;
            if (event.durationMs === undefined && this.runStartedAt)
              event.durationMs =
                Date.parse(endedAt) - Date.parse(this.runStartedAt);
            this.setStatus(event.status === "success" ? "completed" : "error");
          }
          await this.emit(event);
        }
      }
    } catch (error) {
      if (this.stoppedRunId !== this.runId) {
        this.setStatus("error");
        await this.emit(
          this.build({
            eventType: "run_result",
            status: "error",
            error: normalizeError(error, "sdk"),
            sdkSessionId: this.sdkSessionId,
          }),
        );
      }
    } finally {
      this.isListening = false;
    }
  }

  async sendMessage(content: string) {
    if (this.status === "running" || this.status === "waiting_permission")
      throw new Error("A run is already active");
    this.runId = `run-${randomUUID()}`;
    this.stoppedRunId = undefined;
    this.stopPromise = undefined;
    this.runStartedAt = new Date().toISOString();
    this.setStatus("running");
    const snapshot =
      this.agentSession.getObservableRequest?.() ||
      buildObservableRequestSnapshot({
        cwd: this.chat.cwd!,
        projectInstructions: this.projectInstructions,
      });
    await this.emit(
      this.build({
        eventType: "request_snapshot",
        ...snapshot,
      }),
    );
    const stored = this.store.addMessage(this.chatId, {
      role: "user",
      content,
    });
    await this.emit(
      this.build({ eventType: "user_message", content, messageId: stored.id }),
    );
    this.agentSession.sendMessage(content);
    void this.startListening();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.status !== "running" && this.status !== "waiting_permission")
      return false;
    const targetRunId = this.runId;
    this.stopPromise = (async () => {
      this.stoppedRunId = targetRunId;
      await this.agentSession.interrupt();
      if (this.runId !== targetRunId) return false;
      const endedAt = new Date().toISOString();
      this.setStatus("stopped");
      await this.emit(
        this.build({
          eventType: "run_result",
          status: "stopped",
          sdkSessionId: this.sdkSessionId,
          stoppedBy: "user",
          startedAt: this.runStartedAt,
          endedAt,
          durationMs: this.runStartedAt
            ? Date.parse(endedAt) - Date.parse(this.runStartedAt)
            : undefined,
        }),
      );
      return true;
    })();
    return this.stopPromise;
  }

  subscribe(client: WSClient) {
    this.subscribers.add(client);
    client.sessionId = this.chatId;
    for (const pending of this.pendingPermissions.values())
      client.send(
        JSON.stringify(
          redact({
            type: "agent_event",
            event: { ...pending.event, replayed: true },
          }),
        ),
      );
  }
  unsubscribe(client: WSClient) {
    this.subscribers.delete(client);
    if (!this.subscribers.size)
      for (const requestId of [...this.pendingPermissions.keys()])
        void this.resolvePermission(
          requestId,
          "deny",
          false,
          "Client disconnected",
        );
  }
  private broadcast(message: unknown) {
    const serialized = JSON.stringify(redact(message));
    for (const client of this.subscribers)
      if (client.readyState === client.OPEN) client.send(serialized);
  }
  close() {
    this.agentSession.close();
  }
}
