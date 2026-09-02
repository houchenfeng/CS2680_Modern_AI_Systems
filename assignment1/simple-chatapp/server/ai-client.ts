import {
  query,
  type CanUseTool,
  type HookCallback,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = `You are a helpful coding assistant operating only inside the configured working directory.
Use tools when the task requires evidence. Never expose credentials or hidden reasoning. Be concise but complete.`;

type UserMessage = {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
};

class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: ((message: UserMessage) => void) | null = null;
  private closed = false;

  constructor(private readonly sessionId = "") {}

  push(content: string) {
    const message: UserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    };
    if (this.waiting) {
      this.waiting(message);
      this.waiting = null;
    } else this.messages.push(message);
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length) yield this.messages.shift()!;
      else
        yield await new Promise<UserMessage>((resolve) => {
          this.waiting = resolve;
        });
    }
  }

  close() {
    this.closed = true;
  }
}

export interface AgentSessionOptions {
  cwd: string;
  resume?: string;
  canUseTool: CanUseTool;
  preToolUse: HookCallback;
}

export class AgentSession {
  private readonly queue: MessageQueue;
  private readonly queryHandle: Query;
  private readonly outputIterator: AsyncIterator<any>;

  constructor(options: AgentSessionOptions) {
    this.queue = new MessageQueue(options.resume);
    this.queryHandle = query({
      prompt: this.queue as any,
      options: {
        cwd: options.cwd,
        resume: options.resume,
        persistSession: true,
        maxTurns: 100,
        model: process.env.ANTHROPIC_MODEL || "opus",
        env: { ...process.env },
        tools: [
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "Bash",
          "WebSearch",
          "WebFetch",
        ],
        allowedTools: ["Read", "Glob", "Grep"],
        permissionMode: "default",
        canUseTool: options.canUseTool,
        hooks: { PreToolUse: [{ hooks: [options.preToolUse] }] },
        systemPrompt: SYSTEM_PROMPT,
      },
    });
    this.outputIterator = this.queryHandle[Symbol.asyncIterator]();
  }

  sendMessage(content: string) {
    this.queue.push(content);
  }
  async *getOutputStream() {
    while (true) {
      const next = await this.outputIterator.next();
      if (next.done) break;
      yield next.value;
    }
  }
  async interrupt() {
    await this.queryHandle.interrupt();
  }
  close() {
    this.queue.close();
  }
}
