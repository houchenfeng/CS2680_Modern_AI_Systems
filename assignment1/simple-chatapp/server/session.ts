import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Chat, WSClient } from "./types.js";
import { AgentSession } from "./ai-client.js";
import { chatStore } from "./chat-store.js";
import type { AgentEvent } from "./events.js";
import { normalizeSdkMessage } from "./event-normalizer.js";
import { normalizeError, redact } from "./redaction.js";
import { trajectoryStore } from "./trajectory.js";

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  timer: NodeJS.Timeout;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
}

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);

export class Session {
  public readonly chatId: string;
  private readonly subscribers = new Set<WSClient>();
  private readonly agentSession: AgentSession;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly alwaysAllowed = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private isListening = false;
  private sequence = 0;
  private runId = "";
  private sdkSessionId?: string;
  private status: Chat["status"];
  private stoppedRunId?: string;

  constructor(private readonly chat: Chat) {
    this.chatId = chat.id;
    this.sdkSessionId = chat.sdkSessionId;
    this.status = chat.sdkSessionId ? "resumable" : chat.status || "new";
    if (!chat.cwd) throw new Error("Chat has no validated working directory");
    this.agentSession = new AgentSession({ cwd: chat.cwd, resume: chat.sdkSessionId, canUseTool: this.canUseTool });
  }

  private build(payload: Partial<AgentEvent> & Pick<AgentEvent, "eventType">): AgentEvent {
    return { schemaVersion: 1, eventId: randomUUID(), sequence: ++this.sequence, timestamp: new Date().toISOString(), chatId: this.chatId, runId: this.runId, ...payload };
  }

  private setStatus(status: NonNullable<Chat["status"]>) {
    this.status = status;
    chatStore.updateChat(this.chatId, { status, sdkSessionId: this.sdkSessionId });
  }

  private async emit(event: AgentEvent) {
    if (event.toolUseId && event.toolName) this.toolNames.set(event.toolUseId, event.toolName);
    if (event.toolUseId && !event.toolName) event.toolName = this.toolNames.get(event.toolUseId);
    if (event.sdkSessionId) {
      this.sdkSessionId = event.sdkSessionId;
      chatStore.updateChat(this.chatId, { sdkSessionId: event.sdkSessionId });
    }
    try {
      this.broadcast({ type: "agent_event", event: await trajectoryStore.append(event) });
    } catch (error) {
      this.broadcast({ type: "agent_event", event: redact(this.build({ eventType: "system", level: "error", message: "Trajectory storage failed", error: normalizeError(error, "storage") })) });
    }
  }

  private readonly canUseTool = async (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; toolUseID: string }): Promise<PermissionResult> => {
    if (READ_ONLY_TOOLS.has(toolName) || this.alwaysAllowed.has(toolName)) return { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID };
    const requestId = randomUUID();
    this.setStatus("waiting_permission");
    await this.emit(this.build({ eventType: "permission_request", requestId, toolName, toolUseId: options.toolUseID, input }));
    return new Promise<PermissionResult>((resolve) => {
      const deny = (reason: string) => {
        if (!this.pendingPermissions.delete(requestId)) return;
        void this.emit(this.build({ eventType: "permission_result", requestId, toolName, toolUseId: options.toolUseID, decision: "deny", reason }));
        this.setStatus("running");
        resolve({ behavior: "deny", message: reason, toolUseID: options.toolUseID });
      };
      const timer = setTimeout(() => deny("Permission request timed out"), Number(process.env.PERMISSION_TIMEOUT_MS || 60_000));
      this.pendingPermissions.set(requestId, { resolve, timer, toolName, input, toolUseId: options.toolUseID });
      options.signal.addEventListener("abort", () => deny("Run was stopped"), { once: true });
    });
  };

  async resolvePermission(requestId: string, decision: "allow" | "deny", alwaysAllow = false, reason?: string) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    clearTimeout(pending.timer);
    if (alwaysAllow && decision === "allow") this.alwaysAllowed.add(pending.toolName);
    await this.emit(this.build({ eventType: "permission_result", requestId, toolName: pending.toolName, toolUseId: pending.toolUseId, decision, reason }));
    this.setStatus("running");
    pending.resolve(decision === "allow"
      ? { behavior: "allow", updatedInput: pending.input, toolUseID: pending.toolUseId }
      : { behavior: "deny", message: reason || "Denied by user", toolUseID: pending.toolUseId });
    return true;
  }

  private async startListening() {
    if (this.isListening) return;
    this.isListening = true;
    try {
      for await (const message of this.agentSession.getOutputStream()) {
        for (const event of normalizeSdkMessage(message, (payload) => this.build(payload))) {
          if (event.eventType === "run_result" && this.stoppedRunId === event.runId) continue;
          if (event.eventType === "assistant_message" && event.content) chatStore.addMessage(this.chatId, { role: "assistant", content: event.content });
          if (event.eventType === "run_result") this.setStatus(event.status === "success" ? "completed" : "error");
          await this.emit(event);
        }
      }
    } catch (error) {
      if (this.stoppedRunId !== this.runId) {
        this.setStatus("error");
        await this.emit(this.build({ eventType: "run_result", status: "error", error: normalizeError(error, "sdk"), sdkSessionId: this.sdkSessionId }));
      }
    } finally { this.isListening = false; }
  }

  async sendMessage(content: string) {
    if (this.status === "running" || this.status === "waiting_permission") throw new Error("A run is already active");
    this.runId = `run-${randomUUID()}`;
    this.stoppedRunId = undefined;
    this.setStatus("running");
    const stored = chatStore.addMessage(this.chatId, { role: "user", content });
    await this.emit(this.build({ eventType: "user_message", content, messageId: stored.id }));
    this.agentSession.sendMessage(content);
    void this.startListening();
  }

  async stop() {
    if (this.status !== "running" && this.status !== "waiting_permission") return false;
    this.stoppedRunId = this.runId;
    await this.agentSession.interrupt();
    this.setStatus("stopped");
    await this.emit(this.build({ eventType: "run_result", status: "stopped", sdkSessionId: this.sdkSessionId, stoppedBy: "user" }));
    return true;
  }

  subscribe(client: WSClient) { this.subscribers.add(client); client.sessionId = this.chatId; }
  unsubscribe(client: WSClient) {
    this.subscribers.delete(client);
    if (!this.subscribers.size) for (const requestId of [...this.pendingPermissions.keys()]) void this.resolvePermission(requestId, "deny", false, "Client disconnected");
  }
  private broadcast(message: unknown) { const serialized = JSON.stringify(redact(message)); for (const client of this.subscribers) if (client.readyState === client.OPEN) client.send(serialized); }
  close() { this.agentSession.close(); }
}
