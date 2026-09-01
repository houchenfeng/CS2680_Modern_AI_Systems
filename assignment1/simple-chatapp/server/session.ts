import { randomUUID } from "node:crypto";
import type { WSClient } from "./types.js";
import { AgentSession } from "./ai-client.js";
import { chatStore } from "./chat-store.js";
import type { AgentEvent } from "./events.js";
import { normalizeSdkMessage } from "./event-normalizer.js";
import { normalizeError, redact } from "./redaction.js";
import { trajectoryStore } from "./trajectory.js";

export class Session {
  public readonly chatId: string;
  private readonly subscribers = new Set<WSClient>();
  private readonly agentSession = new AgentSession();
  private isListening = false;
  private sequence = 0;
  private runId = "";
  private sdkSessionId?: string;
  private readonly toolNames = new Map<string, string>();

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  private build(payload: Partial<AgentEvent> & Pick<AgentEvent, "eventType">): AgentEvent {
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

  private async emit(event: AgentEvent) {
    if (event.toolUseId && event.toolName) this.toolNames.set(event.toolUseId, event.toolName);
    if (event.toolUseId && !event.toolName) event.toolName = this.toolNames.get(event.toolUseId);
    if (event.sdkSessionId) this.sdkSessionId = event.sdkSessionId;
    try {
      const safe = await trajectoryStore.append(event);
      this.broadcast({ type: "agent_event", event: safe });
    } catch (error) {
      const storageEvent = this.build({
        eventType: "system",
        level: "error",
        message: "Trajectory storage failed",
        error: normalizeError(error, "storage"),
      });
      this.broadcast({ type: "agent_event", event: redact(storageEvent) });
    }
  }

  private async startListening() {
    if (this.isListening) return;
    this.isListening = true;
    try {
      for await (const message of this.agentSession.getOutputStream()) {
        const events = normalizeSdkMessage(message, (payload) => this.build(payload));
        for (const event of events) {
          if (event.eventType === "assistant_message" && event.content) {
            chatStore.addMessage(this.chatId, { role: "assistant", content: event.content });
          }
          await this.emit(event);
        }
      }
    } catch (error) {
      await this.emit(this.build({
        eventType: "run_result",
        status: "error",
        error: normalizeError(error, "sdk"),
        sdkSessionId: this.sdkSessionId,
      }));
    } finally {
      this.isListening = false;
    }
  }

  async sendMessage(content: string) {
    this.runId = `run-${randomUUID()}`;
    const stored = chatStore.addMessage(this.chatId, { role: "user", content });
    await this.emit(this.build({ eventType: "user_message", content, messageId: stored.id }));
    this.agentSession.sendMessage(content);
    void this.startListening();
  }

  subscribe(client: WSClient) {
    this.subscribers.add(client);
    client.sessionId = this.chatId;
  }

  unsubscribe(client: WSClient) {
    this.subscribers.delete(client);
  }

  private broadcast(message: unknown) {
    const serialized = JSON.stringify(redact(message));
    for (const client of this.subscribers) {
      if (client.readyState === client.OPEN) client.send(serialized);
    }
  }

  async stop() {
    await this.agentSession.interrupt();
  }

  close() {
    this.agentSession.close();
  }
}
