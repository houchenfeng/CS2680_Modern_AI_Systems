import { useCallback, useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import type { AgentEvent, Chat } from "./types";

const API_BASE = "/api";
const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChats = useCallback(async () => {
    const response = await fetch(`${API_BASE}/chats`);
    if (!response.ok) throw new Error(`Failed to load chats (${response.status})`);
    setChats(await response.json());
  }, []);

  const handleWSMessage = useCallback((message: any) => {
    if (message.type === "history") {
      const history = (message.messages || []).map((item: any, index: number): AgentEvent => ({
        schemaVersion: 1,
        eventId: item.id,
        runId: "history",
        chatId: item.chatId,
        sequence: index - message.messages.length,
        timestamp: item.timestamp,
        eventType: item.role === "user" ? "user_message" : "assistant_message",
        content: item.content,
      }));
      setEvents(history);
      return;
    }
    if (message.type === "agent_event") {
      const event = message.event as AgentEvent;
      setEvents((previous) => previous.some((item) => item.eventId === event.eventId) ? previous : [...previous, event]);
      if (event.eventType === "run_result") {
        setIsLoading(false);
        void fetchChats();
      }
      return;
    }
    if (message.type === "error") {
      setError(message.error?.message || String(message.error));
      setIsLoading(false);
    }
  }, [fetchChats]);

  const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });
  const isConnected = readyState === ReadyState.OPEN;

  useEffect(() => {
    if (lastJsonMessage) handleWSMessage(lastJsonMessage);
  }, [lastJsonMessage, handleWSMessage]);

  useEffect(() => {
    void fetchChats().catch((caught) => setError(caught.message));
  }, [fetchChats]);

  const createChat = async () => {
    const response = await fetch(`${API_BASE}/chats`, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`Failed to create chat (${response.status})`);
    const chat = await response.json();
    setChats((previous) => [chat, ...previous]);
    setSelectedChatId(chat.id);
    setEvents([]);
    sendJsonMessage({ type: "subscribe", chatId: chat.id });
  };

  const deleteChat = async (chatId: string) => {
    const response = await fetch(`${API_BASE}/chats/${chatId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Failed to delete chat (${response.status})`);
    setChats((previous) => previous.filter((chat) => chat.id !== chatId));
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setEvents([]);
    }
  };

  const selectChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setEvents([]);
    setIsLoading(false);
    setError(null);
    sendJsonMessage({ type: "subscribe", chatId });
  };

  const sendMessage = (content: string) => {
    if (!selectedChatId || !isConnected) return;
    setIsLoading(true);
    setError(null);
    sendJsonMessage({ type: "chat", content, chatId: selectedChatId });
  };

  return (
    <div className="flex h-screen bg-slate-100">
      <aside className="w-64 shrink-0">
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          onNewChat={() => void createChat().catch((caught) => setError(caught.message))}
          onDeleteChat={(id) => void deleteChat(id).catch((caught) => setError(caught.message))}
        />
      </aside>
      <ChatWindow
        chatId={selectedChatId}
        events={events}
        isConnected={isConnected}
        isLoading={isLoading}
        error={error}
        onSendMessage={sendMessage}
      />
    </div>
  );
}
