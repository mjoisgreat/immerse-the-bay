// Local server (laptop): Orbis tokens, speech-to-text, and a WebSocket relay
// between the headset and the director console. Story logic lives in core.js.
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createDirector } from "./director.js";
import { initialState, reduce, askDirector, applyDirection, MAX_PORTALS } from "./core.js";
import { mintOrbisToken, endOrbisSession, transcribe } from "./services.js";

const PORT = Number(process.env.PORT || 8787);
const app = express();
const director = createDirector();
const state = initialState();

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

app.get("/api/config", (_req, res) => {
  res.json({ maxPortals: MAX_PORTALS, director: director.usingClaude ? "claude" : "template", transport: "ws" });
});
app.post("/api/token", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store").json({ jwt: await mintOrbisToken() });
  } catch (e) {
    fail(res, e);
  }
});
app.post("/api/session-cleanup", express.json({ limit: "32kb" }), async (req, res) => {
  try {
    await endOrbisSession(req.body?.sessionId, req.body?.jwt);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});
app.post("/api/transcribe", express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
  try {
    res.json({ text: await transcribe(req.body) });
  } catch (e) {
    fail(res, e);
  }
});
app.use(express.static("dist"));

// ---------- WebSocket relay ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}
const snapshot = () => ({ t: "state", ...state, director: director.usingClaude ? "claude" : "template" });

let queue = Promise.resolve(); // director calls run one at a time so updates apply in order
function handle(m) {
  const { events, director: event } = reduce(state, m);
  events.forEach(broadcast);
  broadcast(snapshot());
  if (!event) return;
  queue = queue.then(async () => {
    const started = Date.now();
    const out = await askDirector(director, state, event);
    applyDirection(state, out, Date.now() - started).forEach(broadcast);
    broadcast(snapshot());
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(snapshot()));
  ws.on("message", (raw) => {
    try {
      handle(JSON.parse(raw));
    } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`[living-window] API on http://localhost:${PORT}  director=${director.usingClaude ? "Claude" : "template fallback"}`);
});
