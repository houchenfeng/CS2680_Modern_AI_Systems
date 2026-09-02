import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "./events.js";
import { redact } from "./redaction.js";

export class TrajectoryStore {
  private writes = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  private runPath(chatId: string, runId: string) {
    return path.join(this.root, chatId, `${runId}.jsonl`);
  }

  async append(event: AgentEvent): Promise<AgentEvent> {
    const safeEvent = redact(event) as AgentEvent;
    const file = this.runPath(event.chatId, event.runId);
    const previous = this.writes.get(file) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(safeEvent)}\n`, "utf8");
    });
    this.writes.set(
      file,
      next.catch(() => undefined),
    );
    await next;
    return safeEvent;
  }

  async list(chatId: string) {
    const directory = path.join(this.root, chatId);
    try {
      return (await readdir(directory))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -6));
    } catch {
      return [];
    }
  }

  async read(chatId: string, runId: string): Promise<string> {
    return readFile(this.runPath(chatId, runId), "utf8");
  }

  async events(chatId: string, runId: string): Promise<AgentEvent[]> {
    const raw = await this.read(chatId, runId);
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async removeChat(chatId: string) {
    await rm(path.join(this.root, chatId), { recursive: true, force: true });
  }
}

export const trajectoryStore = new TrajectoryStore(
  path.resolve(process.env.TRACE_ROOT || path.join(process.cwd(), "traces")),
);
