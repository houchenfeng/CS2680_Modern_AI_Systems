import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import type { WSClient, IncomingWSMessage } from "./types.js";
import { chatStore } from "./chat-store.js";
import { Session } from "./session.js";
import { trajectoryStore } from "./trajectory.js";
import { normalizeError, redact } from "./redaction.js";
import {
  resolveWorkspace,
  validatePersistedWorkspace,
  workspaceRoot,
} from "./workspace.js";
import {
  contextCsv,
  contextSummary,
  filterAndSortEvents,
  tokenLedger,
} from "./trace-analysis.js";
import { evidenceStore } from "./evidence-store.js";
import { createReplayBundle, replayTool } from "./tool-replay.js";
import {
  buildDesignedTranscript,
  compareDesignedVsSent,
  sentMessagesToBlocks,
} from "./context-diff.js";
import {
  freezeSpec,
  getSpecVersions,
  reviseSpec,
  diagnoseSpecificationClarity,
} from "./task-spec.js";
import {
  createDiagnosis,
  persistDiagnosis,
  reviseDiagnosis,
  listDiagnoses,
  classifyReadMaxTurnsLoop,
} from "./failure-diagnosis.js";
import { FAILURE_FIXTURES } from "./failure-fixtures.js";
import { readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from client directory
app.use("/client", express.static(path.join(__dirname, "../client")));

// Serve index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Session management
const sessions: Map<string, Session> = new Map();
const sessionCreations = new Map<string, Promise<Session>>();

function subscribeExclusively(session: Session, client: WSClient) {
  for (const existing of sessions.values()) {
    if (existing !== session) existing.unsubscribe(client);
  }
  session.subscribe(client);
}

async function getOrCreateSession(chatId: string): Promise<Session> {
  const existing = sessions.get(chatId);
  if (existing) return existing;
  const pending = sessionCreations.get(chatId);
  if (pending) return pending;
  const creation = (async () => {
    const chat = chatStore.getChat(chatId);
    if (!chat) throw new Error("Chat not found");
    if (!chat.cwd) throw new Error("Chat has no saved workspace");
    const workspace = await validatePersistedWorkspace(
      chat.cwd,
      chat.workspacePath || ".",
    );
    chat.cwd = workspace.cwd;
    const session = await Session.create(chat);
    sessions.set(chatId, session);
    return session;
  })();
  sessionCreations.set(chatId, creation);
  try {
    return await creation;
  } finally {
    sessionCreations.delete(chatId);
  }
}

// REST API: Get all chats
app.get("/api/chats", (req, res) => {
  const chats = chatStore.getAllChats();
  res.json(chats);
});

// REST API: Create new chat
app.post("/api/chats", async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req.body?.workspacePath || ".");
    const chat = chatStore.createChat({
      title: req.body?.title,
      cwd: workspace.cwd,
      workspacePath: workspace.relativePath,
    });
    res.status(201).json(chat);
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.get("/api/workspace", async (_req, res) => {
  try {
    res.json({ root: await workspaceRoot() });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, "validation") });
  }
});

// REST API: Get single chat
app.get("/api/chats/:id", (req, res) => {
  const chat = chatStore.getChat(req.params.id);
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }
  res.json(chat);
});

// REST API: Delete chat
app.delete("/api/chats/:id", (req, res) => {
  const deleted = chatStore.deleteChat(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Chat not found" });
  }
  const session = sessions.get(req.params.id);
  if (session) {
    session.close();
    sessions.delete(req.params.id);
  }
  res.json({ success: true });
});

app.post("/api/chats/:id/stop", async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    res.json({ stopped: session ? await session.stop() : false });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, "sdk") });
  }
});

// REST API: Get chat messages
app.get("/api/chats/:id/messages", (req, res) => {
  const messages = chatStore.getMessages(req.params.id);
  res.json(messages);
});

app.get("/api/chats/:id/traces", async (req, res) => {
  res.json(await trajectoryStore.list(req.params.id));
});

app.get("/api/traces/:chatId/:runId", async (req, res) => {
  try {
    const events = await trajectoryStore.events(
      req.params.chatId,
      req.params.runId,
    );
    res.json(
      filterAndSortEvents(events, {
        eventType: req.query.eventType as string | undefined,
        toolName: req.query.toolName as string | undefined,
        errorsOnly: req.query.errorsOnly === "true",
      }),
    );
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/traces/:chatId/:runId/summary", async (req, res) => {
  try {
    const events = await trajectoryStore.events(
      req.params.chatId,
      req.params.runId,
    );
    res.json({ ledger: tokenLedger(events), context: contextSummary(events) });
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/traces/:chatId/:runId/context.csv", async (req, res) => {
  try {
    const events = await trajectoryStore.events(
      req.params.chatId,
      req.params.runId,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.runId}-context.csv"`,
    );
    res.type("text/csv; charset=utf-8").send(`\uFEFF${contextCsv(events)}`);
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/traces/:chatId/:runId/raw", async (req, res) => {
  try {
    const raw = await trajectoryStore.read(req.params.chatId, req.params.runId);
    res.type("application/x-ndjson").send(raw);
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/evidence/:chatId/:runId", async (req, res) => {
  try {
    res.json(await evidenceStore.list(req.params.chatId, req.params.runId));
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/evidence/:chatId/:runId/:sha256", async (req, res) => {
  try {
    const meta = await evidenceStore.readMeta(
      req.params.chatId,
      req.params.runId,
      req.params.sha256,
    );
    const body = await evidenceStore.read(
      req.params.chatId,
      req.params.runId,
      req.params.sha256,
    );
    res.json({
      meta,
      content:
        meta.mimeType === "application/json"
          ? JSON.parse(body.toString("utf8"))
          : body.toString("utf8"),
    });
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.post("/api/tools/replay", async (req, res) => {
  try {
    const {
      toolName,
      input,
      toolInput,
      cwd,
      chatId,
      runId,
      toolUseId,
      eventId,
      originalResult,
      attemptDir,
    } = req.body || {};
    if (!toolName || !cwd || !chatId || !runId) {
      return res.status(400).json({
        error: normalizeError(
          new Error("toolName, cwd, chatId, and runId are required"),
          "validation",
        ),
      });
    }
    const resolvedInput = toolInput ?? input ?? {};
    const bundle = await createReplayBundle({
      toolName,
      toolInput: resolvedInput,
      cwd,
      chatId,
      runId,
      toolUseId,
      eventId,
      originalResult: originalResult ?? null,
    });
    const result = await replayTool(bundle, {
      evidenceStore,
      originalResult: originalResult ?? null,
      attemptDir,
    });
    res.json({ bundle, result });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, "validation") });
  }
});

app.post("/api/context/diff", async (req, res) => {
  try {
    const { chatId, runId, sent } = req.body || {};
    const events = await trajectoryStore.events(chatId, runId);
    const designed = buildDesignedTranscript(events as any);
    const sentInput = sent || {};
    const sentBlocks = sentMessagesToBlocks(sentInput);
    const diff = compareDesignedVsSent(designed, sentBlocks);
    res.json({ designed, sentBlocks, diff });
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.post("/api/task-specs", (req, res) => {
  try {
    const spec = freezeSpec(req.body || {});
    res.status(201).json(spec);
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.post("/api/task-specs/:taskId/revise", (req, res) => {
  try {
    const versions = getSpecVersions(req.params.taskId);
    const previous = versions[versions.length - 1];
    if (!previous) {
      return res.status(404).json({
        error: normalizeError(new Error("Task spec not found"), "validation"),
      });
    }
    const spec = reviseSpec(previous, req.body || {});
    res.status(201).json(spec);
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.get("/api/task-specs/:taskId", (req, res) => {
  res.json(getSpecVersions(req.params.taskId));
});

app.post("/api/task-specs/diagnose", (req, res) => {
  try {
    const spec = req.body?.spec || req.body;
    res.json(
      diagnoseSpecificationClarity(spec, {
        analystNotes: req.body?.analystNotes,
      }),
    );
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.get("/api/failure-diagnoses/fixtures", (_req, res) => {
  res.json(FAILURE_FIXTURES);
});

app.get("/api/failure-diagnoses/read-max-turns", (_req, res) => {
  res.json(classifyReadMaxTurnsLoop());
});

app.get("/api/failure-diagnoses/:taskId", async (req, res) => {
  try {
    res.json(await listDiagnoses(req.params.taskId));
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, "storage") });
  }
});

app.post("/api/failure-diagnoses", async (req, res) => {
  try {
    const diagnosis = createDiagnosis(req.body || {});
    await persistDiagnosis(diagnosis);
    res.status(201).json(diagnosis);
  } catch (error) {
    res.status(400).json({ error: normalizeError(error, "validation") });
  }
});

app.post(
  "/api/failure-diagnoses/:taskId/:diagnosisId/revise",
  async (req, res) => {
    try {
      const records = await listDiagnoses(req.params.taskId);
      const previous = [...records]
        .reverse()
        .find(
          (item) =>
            item &&
            typeof item === "object" &&
            "diagnosisId" in item &&
            (item as { diagnosisId: string }).diagnosisId ===
              req.params.diagnosisId &&
            "classification" in item,
        ) as import("./failure-diagnosis.js").FailureDiagnosis | undefined;
      if (!previous) {
        return res.status(404).json({
          error: normalizeError(new Error("Diagnosis not found"), "validation"),
        });
      }
      const revision = await reviseDiagnosis(previous, req.body || {});
      res.status(201).json(revision);
    } catch (error) {
      res.status(400).json({ error: normalizeError(error, "validation") });
    }
  },
);

app.get("/api/evaluation/:phase/aggregate", async (req, res) => {
  try {
    const phase = req.params.phase;
    if (phase !== "pilot" && phase !== "final") {
      return res.status(400).json({
        error: normalizeError(new Error("phase must be pilot|final"), "validation"),
      });
    }
    const file = path.join(
      process.cwd(),
      "evaluation",
      "results",
      `${phase}-aggregate.json`,
    );
    const raw = await readFile(file, "utf8");
    res.type("application/json").send(raw);
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

app.get("/api/evaluation/:phase/index", async (req, res) => {
  try {
    const phase = req.params.phase;
    if (phase !== "pilot" && phase !== "final") {
      return res.status(400).json({
        error: normalizeError(new Error("phase must be pilot|final"), "validation"),
      });
    }
    const file = path.join(
      process.cwd(),
      "evaluation",
      "results",
      `${phase}-index.json`,
    );
    const raw = await readFile(file, "utf8");
    res.type("application/json").send(raw);
  } catch (error) {
    res.status(404).json({ error: normalizeError(error, "storage") });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WSClient) => {
  console.log("WebSocket client connected");
  ws.isAlive = true;

  ws.send(
    JSON.stringify({ type: "connected", message: "Connected to chat server" }),
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const message: IncomingWSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe": {
          void getOrCreateSession(message.chatId)
            .then((session) => {
              subscribeExclusively(session, ws);
              console.log(`Client subscribed to chat ${message.chatId}`);

              // Send existing messages
              const messages = chatStore.getMessages(message.chatId);
              ws.send(
                JSON.stringify({
                  type: "history",
                  messages,
                  chatId: message.chatId,
                }),
              );
            })
            .catch((error) =>
              ws.send(
                JSON.stringify(
                  redact({
                    type: "error",
                    error: normalizeError(error, "validation"),
                  }),
                ),
              ),
            );
          break;
        }

        case "chat": {
          void getOrCreateSession(message.chatId)
            .then((session) => {
              subscribeExclusively(session, ws);
              return session.sendMessage(message.content);
            })
            .catch((error) => {
              ws.send(
                JSON.stringify(
                  redact({
                    type: "error",
                    error: normalizeError(error, "websocket"),
                  }),
                ),
              );
            });
          break;
        }

        case "stop": {
          const session = sessions.get(message.chatId);
          if (session) void session.stop();
          break;
        }

        case "permission_result": {
          const session = sessions.get(message.chatId);
          if (session)
            void session.resolvePermission(
              message.requestId,
              message.decision,
              message.alwaysAllow,
              message.reason,
            );
          break;
        }

        default:
          console.warn("Unknown message type:", (message as any).type);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      ws.send(
        JSON.stringify({ type: "error", error: "Invalid message format" }),
      );
    }
  });

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    // Unsubscribe from all sessions
    for (const session of sessions.values()) {
      session.unsubscribe(ws);
    }
  });
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (client.isAlive === false) {
      return client.terminate();
    }
    client.isAlive = false;
    client.ping();
  });
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
  console.log(`Visit http://localhost:${PORT} to view the chat interface`);
});
