import {
  query,
  type CanUseTool,
  type HookCallback,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_TOOLS,
  ALLOWED_TOOLS,
  SETTING_SOURCES,
  SYSTEM_PROMPT,
  buildObservableRequestSnapshot,
  composeSystemPrompt,
  loadProjectInstructions,
  resolveModel,
  type ObservableRequestSnapshot,
  type ProjectInstructions,
} from "./agent-config.js";
import {
  ObservationProxy,
  proxyEnv,
  type ObservedRequestArtifact,
  type ObservationListener,
} from "./observation-proxy.js";

export {
  AGENT_TOOLS,
  ALLOWED_TOOLS,
  SETTING_SOURCES,
  SYSTEM_PROMPT,
  buildObservableRequestSnapshot,
  composeSystemPrompt,
  loadProjectInstructions,
  resolveModel,
};

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
  projectInstructions?: ProjectInstructions;
  systemPrompt?: string;
  onObservation?: ObservationListener;
  chatId?: string;
  runId?: string;
  /** Disable proxy (unit tests). Default false when upstream URL is set. */
  disableObservationProxy?: boolean;
  /** Pre-started proxy (createAgentSession). */
  observationProxy?: ObservationProxy | null;
  env?: NodeJS.ProcessEnv;
}

export class AgentSession {
  private readonly queue: MessageQueue;
  private readonly queryHandle: Query;
  private readonly outputIterator: AsyncIterator<any>;
  private readonly observableRequest: ObservableRequestSnapshot;
  private readonly proxy: ObservationProxy | null;

  constructor(options: AgentSessionOptions) {
    const projectInstructions =
      options.projectInstructions ||
      ({
        text: "unavailable",
        source: "unavailable",
        status: "unavailable",
      } satisfies ProjectInstructions);
    const systemPrompt =
      options.systemPrompt || composeSystemPrompt(projectInstructions);
    const model = resolveModel();
    this.observableRequest = buildObservableRequestSnapshot({
      cwd: options.cwd,
      projectInstructions,
      systemPrompt,
      model,
      tools: AGENT_TOOLS,
    });
    this.proxy = options.observationProxy ?? null;

    this.queue = new MessageQueue(options.resume);
    this.queryHandle = query({
      prompt: this.queue as any,
      options: {
        cwd: options.cwd,
        resume: options.resume,
        persistSession: true,
        maxTurns: 100,
        model,
        env: options.env ? { ...options.env } : { ...process.env },
        tools: [...AGENT_TOOLS],
        allowedTools: [...ALLOWED_TOOLS],
        permissionMode: "default",
        canUseTool: options.canUseTool,
        hooks: { PreToolUse: [{ hooks: [options.preToolUse] }] },
        systemPrompt,
        settingSources: [...SETTING_SOURCES],
      },
    });
    this.outputIterator = this.queryHandle[Symbol.asyncIterator]();
  }

  setObservationContext(context: {
    chatId?: string;
    runId?: string;
    sdkSessionId?: string;
  }) {
    this.proxy?.setContext(context);
  }

  getObservableRequest(): ObservableRequestSnapshot {
    return this.observableRequest;
  }

  getObservationProxy(): ObservationProxy | null {
    return this.proxy;
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
    void this.proxy?.stop();
  }
}

/** Async factory: starts localhost observation proxy then constructs the SDK query. */
export async function createAgentSession(options: AgentSessionOptions) {
  const projectInstructions =
    options.projectInstructions || (await loadProjectInstructions(options.cwd));
  const systemPrompt =
    options.systemPrompt || composeSystemPrompt(projectInstructions);

  let proxy: ObservationProxy | null = null;
  let env: NodeJS.ProcessEnv = { ...process.env };
  const upstream = process.env.ANTHROPIC_BASE_URL;
  const enableProxy =
    !options.disableObservationProxy &&
    Boolean(upstream) &&
    options.observationProxy !== null;

  if (enableProxy && upstream) {
    proxy = new ObservationProxy({
      upstreamBaseUrl: upstream,
      failClosed: process.env.OBSERVABILITY_FAIL_CLOSED === "1",
      context: {
        chatId: options.chatId,
        runId: options.runId,
        sdkSessionId: options.resume,
      },
      onObservation: options.onObservation,
    });
    const proxyBaseUrl = await proxy.start();
    env = proxyEnv(env, proxyBaseUrl);
  }

  return new AgentSession({
    ...options,
    projectInstructions,
    systemPrompt,
    observationProxy: proxy,
    env,
  });
}

export type { ObservedRequestArtifact, ObservationListener };
