import type { Chat } from "../types";

interface Props {
  chats: Chat[];
  selectedChatId: string | null;
  workspacePath: string;
  onWorkspacePathChange: (path: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
}

export function ChatList({
  chats,
  selectedChatId,
  workspacePath,
  onWorkspacePathChange,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: Props) {
  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="space-y-3 border-b border-slate-800 p-4">
        <label className="block text-xs text-slate-400">
          Workspace path
          <input
            value={workspacePath}
            onChange={(event) => onWorkspacePathChange(event.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
            placeholder="relative/project/path"
          />
        </label>
        <button
          onClick={onNewChat}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
        >
          + New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {chats.length ? (
          chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className={`group mb-1 cursor-pointer rounded-lg p-3 ${selectedChatId === chat.id ? "bg-slate-800" : "hover:bg-slate-900"}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {chat.title}
                </span>
                <button
                  aria-label={`Delete ${chat.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteChat(chat.id);
                  }}
                  className="text-slate-500 opacity-0 hover:text-red-300 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="truncate">{chat.workspacePath || "."}</span>
                <span>{chat.status || "new"}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="p-4 text-center text-xs text-slate-500">
            No sessions yet
          </p>
        )}
      </div>
      <div className="border-t border-slate-800 p-3 text-center text-xs text-slate-500">
        Claude Agent SDK Lab
      </div>
    </div>
  );
}
