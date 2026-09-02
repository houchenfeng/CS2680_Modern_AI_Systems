import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Chat, ChatMessage } from "./types.js";

interface StoredState {
  chats: Chat[];
  messages: Record<string, ChatMessage[]>;
}

export class ChatStore {
  private chats = new Map<string, Chat>();
  private messages = new Map<string, ChatMessage[]>();

  constructor(
    private readonly file = path.resolve(
      process.env.DATA_ROOT || path.join(process.cwd(), "data"),
      "chats.json",
    ),
  ) {
    this.load();
  }

  private load() {
    if (!existsSync(this.file)) return;
    const state = JSON.parse(readFileSync(this.file, "utf8")) as StoredState;
    let normalizedInterruptedState = false;
    this.chats = new Map(
      state.chats.map((chat) => {
        if (chat.status === "running" || chat.status === "waiting_permission") {
          chat.status = chat.sdkSessionId ? "resumable" : "error";
          normalizedInterruptedState = true;
        }
        return [chat.id, chat];
      }),
    );
    this.messages = new Map(Object.entries(state.messages));
    if (normalizedInterruptedState) this.persist();
  }

  private persist() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify(
        {
          chats: [...this.chats.values()],
          messages: Object.fromEntries(this.messages),
        },
        null,
        2,
      ),
      "utf8",
    );
    renameSync(temporary, this.file);
  }

  createChat(options: {
    title?: string;
    cwd: string;
    workspacePath: string;
  }): Chat {
    const now = new Date().toISOString();
    const chat: Chat = {
      id: uuidv4(),
      title: options.title || "New Chat",
      createdAt: now,
      updatedAt: now,
      status: "new",
      cwd: options.cwd,
      workspacePath: options.workspacePath,
    };
    this.chats.set(chat.id, chat);
    this.messages.set(chat.id, []);
    this.persist();
    return chat;
  }

  getChat(id: string) {
    return this.chats.get(id);
  }
  getAllChats() {
    return [...this.chats.values()].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }
  updateChat(id: string, changes: Partial<Chat>) {
    const chat = this.chats.get(id);
    if (!chat) return undefined;
    Object.assign(chat, changes, { updatedAt: new Date().toISOString() });
    this.persist();
    return chat;
  }
  deleteChat(id: string) {
    this.messages.delete(id);
    const deleted = this.chats.delete(id);
    if (deleted) this.persist();
    return deleted;
  }
  addMessage(
    chatId: string,
    message: Omit<ChatMessage, "id" | "chatId" | "timestamp">,
  ) {
    const messages = this.messages.get(chatId);
    if (!messages) throw new Error(`Chat ${chatId} not found`);
    const stored: ChatMessage = {
      id: uuidv4(),
      chatId,
      timestamp: new Date().toISOString(),
      ...message,
    };
    messages.push(stored);
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.updatedAt = stored.timestamp;
      if (chat.title === "New Chat" && message.role === "user")
        chat.title = `${message.content.slice(0, 50)}${message.content.length > 50 ? "..." : ""}`;
    }
    this.persist();
    return stored;
  }
  getMessages(chatId: string) {
    return this.messages.get(chatId) || [];
  }
}

export const chatStore = new ChatStore();
