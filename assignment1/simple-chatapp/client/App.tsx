import { useCallback, useEffect, useState } from "react";
import websocketModule, { ReadyState } from "react-use-websocket";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { TraceViewer } from "./components/TraceViewer";
import type { AgentEvent, Chat } from "./types";

const API_BASE = "/api";
const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const useWebSocket =
  typeof websocketModule === "function"
    ? websocketModule
    : (websocketModule as unknown as { default: typeof websocketModule })
        .default;

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState(".");
  const [view, setView] = useState<"chat" | "trace">("chat");
  const [traceRefreshKey, setTraceRefreshKey] = useState(0);

  const fetchChats = useCallback(async () => {
    const response = await fetch(`${API_BASE}/chats`);
    if (!response.ok)
      throw new Error(`Failed to load chats (${response.status})`);
    setChats(await response.json());
  }, []);

  const handleWSMessage = useCallback(
    (message: any) => {
      if (message.type === "history") {
        if (message.chatId !== selectedChatId) return;
        const history = (message.messages || []).map(
          (item: any, index: number): AgentEvent => ({
            schemaVersion: 1,
            eventId: item.id,
            runId: "history",
            chatId: item.chatId,
            sequence: index - message.messages.length,
            timestamp: item.timestamp,
            eventType:
              item.role === "user" ? "user_message" : "assistant_message",
            content: item.content,
          }),
        );
        setEvents(history);
        return;
      }
      if (message.type === "agent_event") {
        const event = message.event as AgentEvent;
        if (event.chatId !== selectedChatId) return;
        setEvents((previous) =>
          previous.some((item) => item.eventId === event.eventId)
            ? previous
            : [...previous, event],
        );
        setChats((previous) =>
          previous.map((chat) =>
            chat.id !== event.chatId
              ? chat
              : {
                  ...chat,
                  status:
                    event.eventType === "permission_request"
                      ? "waiting_permission"
                      : event.eventType === "user_message"
                        ? "running"
                        : event.eventType === "run_result"
                          ? event.status === "success"
                            ? "completed"
                            : event.status
                          : chat.status,
                },
          ),
        );
        if (event.eventType === "run_result") {
          setIsLoading(false);
          setTraceRefreshKey((previous) => previous + 1);
          void fetchChats();
        }
        return;
      }
      if (message.type === "error") {
        setError(message.error?.message || String(message.error));
        setIsLoading(false);
      }
    },
    [fetchChats, selectedChatId],
  );

  const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(
    WS_URL,
    {
      shouldReconnect: () => true,
      reconnectAttempts: 10,
      reconnectInterval: 3000,
    },
  );
  const isConnected = readyState === ReadyState.OPEN;

  useEffect(() => {
    if (lastJsonMessage) handleWSMessage(lastJsonMessage);
  }, [lastJsonMessage, handleWSMessage]);

  useEffect(() => {
    void fetchChats().catch((caught) => setError(caught.message));
  }, [fetchChats, selectedChatId]);

  const createChat = async () => {
    const response = await fetch(`${API_BASE}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspacePath }),
    });
    if (!response.ok)
      throw new Error(`Failed to create chat (${response.status})`);
    const chat = await response.json();
    setChats((previous) => [chat, ...previous]);
    setSelectedChatId(chat.id);
    setEvents([]);
    sendJsonMessage({ type: "subscribe", chatId: chat.id });
  };

  const deleteChat = async (chatId: string) => {
    const response = await fetch(`${API_BASE}/chats/${chatId}`, {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error(`Failed to delete chat (${response.status})`);
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

  const stopRun = async () => {
    if (!selectedChatId) return;
    const response = await fetch(`${API_BASE}/chats/${selectedChatId}/stop`, {
      method: "POST",
    });
    if (!response.ok)
      throw new Error(`Failed to stop run (${response.status})`);
  };

  const resolvePermission = (
    requestId: string,
    decision: "allow" | "deny",
    alwaysAllow = false,
  ) => {
    if (!selectedChatId) return;
    sendJsonMessage({
      type: "permission_result",
      chatId: selectedChatId,
      requestId,
      decision,
      alwaysAllow,
    });
  };

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) || null;

  return (
    <div className="flex h-screen flex-col bg-slate-100 md:flex-row">
      <aside className="h-64 w-full shrink-0 md:h-auto md:w-64">
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          onNewChat={() =>
            void createChat().catch((caught) => setError(caught.message))
          }
          onDeleteChat={(id) =>
            void deleteChat(id).catch((caught) => setError(caught.message))
          }
          workspacePath={workspacePath}
          onWorkspacePathChange={setWorkspacePath}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-2">
          <button
            onClick={() => setView("chat")}
            className={`rounded-t px-4 py-2 text-sm ${view === "chat" ? "bg-slate-100 font-medium" : "text-slate-500"}`}
          >
            Chat
          </button>
          <button
            onClick={() => setView("trace")}
            className={`rounded-t px-4 py-2 text-sm ${view === "trace" ? "bg-slate-100 font-medium" : "text-slate-500"}`}
          >
            Trace Viewer
          </button>
        </nav>
        <div className={view === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ChatWindow
            chatId={selectedChatId}
            events={events}
            isConnected={isConnected}
            isLoading={isLoading}
            error={error}
            onSendMessage={sendMessage}
            chat={selectedChat}
            onStop={() =>
              void stopRun().catch((caught) => setError(caught.message))
            }
            onResolvePermission={resolvePermission}
          />
        </div>
        <div className={view === "trace" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TraceViewer
            chatId={selectedChatId}
            active={view === "trace"}
            refreshKey={traceRefreshKey}
          />
        </div>
      </div>
    </div>
  );
}
