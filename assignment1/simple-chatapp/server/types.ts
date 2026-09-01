import type { WebSocket } from "ws";
import type { AgentEvent } from "./events.js";

// WebSocket client with session data
export interface WSClient extends WebSocket {
  sessionId?: string;
  isAlive?: boolean;
}

// Chat stored in memory
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: "new" | "running" | "waiting_permission" | "stopped" | "completed" | "error" | "resumable";
  cwd?: string;
  sdkSessionId?: string;
}

// Message stored in memory
export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// WebSocket incoming messages
export interface WSChatMessage {
  type: "chat";
  content: string;
  chatId: string;
}

export interface WSSubscribeMessage {
  type: "subscribe";
  chatId: string;
}

export type IncomingWSMessage = WSChatMessage | WSSubscribeMessage;

export interface AgentEventMessage {
  type: "agent_event";
  event: AgentEvent;
}
