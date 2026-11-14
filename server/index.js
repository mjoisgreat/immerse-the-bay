// Living Window server: Orbis token minting, story director, speech-to-text proxy,
// and a WebSocket relay between the headset and the laptop director console.
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createDirector } from "./director.js";

const PORT = Number(process.env.PORT || 8787);
const REACTOR_API_URL = "https://api.reactor.inc";
const MODEL_NAME = "reactor/visko-orbis-stable";
const SESSION_SECONDS = Number(process.env.ORBIS_SESSION_SECONDS || 1800);
const MAX_PORTALS = Number(process.env.MAX_PORTALS || 3);
const STT_URL = process.env.STT_URL || "http://127.0.0.1:8790";

const app = express();
const director = createDirector();

// ---------- Story state (the server is the single source of truth) ----------
const DEFAULT_SEED =
  "A lantern-lit fishing village on a misty mountain lake at dusk, wooden boats, paper lanterns glowing amber";
const story = {
  seed: DEFAULT_SEED,
  bible: `Setting: ${DEFAULT_SEED}. Time: dusk. Mood: calm, magical.`,
  beats: [],
};
const portals = new Map(); // id -> { id, prompt, status }
let focusId = null;
const log = []; // recent events for the console

function pushLog(kind, text) {
  log.push({ at: Date.now(), kind, text });
  if (log.length > 60) log.shift();
}

// ---------- HTTP API ----------
app.get("/api/config", (_req, res) => {
  res.json({ maxPortals: MAX_PORTALS, director: director.usingClaude ? "claude" : "template" });
});

app.post("/api/token", async (_req, res) => {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey || apiKey === "replace_me") {
    return res.status(500).json({ error: "REACTOR_API_KEY is not set in .env" });
  }
  try {
    const r = await fetch(`${REACTOR_API_URL}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Reactor-API-Key": apiKey },
      body: JSON.stringify({
        expires_after: SESSION_SECONDS + 600,
        authorization_details: [
          {
            type: "session",
            resources: { models: { match: [MODEL_NAME] } },
            constraints: { max_sessions: 1, max_session_duration_seconds: SESSION_SECONDS },
          },
        ],
      }),
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Reactor token request failed (${r.status}): ${text}` });
    const { jwt } = JSON.parse(text);
    if (!jwt) return res.status(502).json({ error: "Reactor returned no JWT" });
    res.set("Cache-Control", "no-store").json({ jwt });
  } catch (e) {
    res.status(502).json({ error: `Could not reach Reactor: ${e.message}` });
  }
});

// Ends one Orbis session (called when a portal closes or the page unloads).
app.post("/api/session-cleanup", express.json({ limit: "32kb" }), async (req, res) => {
  const { sessionId, jwt } = req.body || {};
  if (typeof sessionId !== "string" || typeof jwt !== "string") return res.status(400).end();
  try {
    const r = await fetch(`${REACTOR_API_URL}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    res.status(r.ok || r.status === 404 ? 204 : r.status).end();
  } catch {
    res.status(502).end();
  }
});

// Raw 16 kHz mono Int16 PCM in, { text } out. Forwards to the local Whisper sidecar.
app.post("/api/transcribe", express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
  try {
    const r = await fetch(`${STT_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: req.body,
    });
    if (!r.ok) return res.status(502).json({ error: `speech-to-text failed (${r.status})` });
    res.json(await r.json());
  } catch {
    res.status(502).json({ error: "speech-to-text sidecar is not running (npm run stt)" });
  }
});

// Production: serve the built front end.
app.use(express.static("dist"));

// ---------- WebSocket relay ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}
function snapshot() {
  return { t: "state", story, portals: [...portals.values()], focusId, log, director: director.usingClaude ? "claude" : "template" };
}

let directing = Promise.resolve();
function runDirector(event) {
  // Serialize director calls so updates apply in order.
  directing = directing.then(async () => {
    const started = Date.now();
    const out = await director.direct({ event, story, portals: [...portals.values()], focusId });
    story.bible = out.bible || story.bible;
    for (const u of out.updates) {
      const p = portals.get(u.portal_id);
      if (p) p.prompt = u.prompt;
    }
    pushLog("director", `${out.narration} (${Date.now() - started} ms, ${out.updates.length} portal updates)`);
    broadcast({ t: "direction", narration: out.narration, updates: out.updates });
    broadcast(snapshot());
  });
  return directing;
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(snapshot()));
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.t) {
      case "hello":
        // The headset owns the streams: when it (re)connects, its portals are the truth.
        if (m.role === "renderer") {
          portals.clear();
          focusId = null;
          broadcast(snapshot());
        }
        break;
      case "portal_sync": {
        // A portal that already has a running world (after a reconnect): no director call.
        if (portals.size >= MAX_PORTALS && !portals.has(m.id)) return;
        portals.set(m.id, { id: m.id, prompt: String(m.prompt || ""), status: m.status || "streaming" });
        focusId = focusId ?? m.id;
        broadcast(snapshot());
        break;
      }
      case "close_portal":
        broadcast({ t: "close_portal", id: m.id });
        break;
      case "portal_added": {
        if (!portals.has(m.id) && portals.size >= MAX_PORTALS) return;
        portals.set(m.id, { id: m.id, prompt: "", status: "starting" });
        focusId = m.id;
        pushLog("portal", `Portal ${m.id} opened`);
        runDirector({ type: "portal_added", portal_id: m.id });
        break;
      }
      case "portal_removed":
        portals.delete(m.id);
        if (focusId === m.id) focusId = portals.keys().next().value ?? null;
        pushLog("portal", `Portal ${m.id} closed`);
        broadcast(snapshot());
        break;
      case "portal_status": {
        const p = portals.get(m.id);
        if (p) {
          p.status = m.status;
          broadcast(snapshot());
        }
        break;
      }
      case "focus":
        if (portals.has(m.id)) {
          focusId = m.id;
          broadcast(snapshot());
        }
        break;
      case "utterance": {
        const text = String(m.text || "").trim().slice(0, 500);
        if (!text) return;
        story.beats.push(text);
        pushLog("voice", text);
        broadcast(snapshot());
        runDirector({ type: "utterance", text });
        break;
      }
      case "manual_prompt": {
        const p = portals.get(m.id);
        if (!p || !m.prompt) return;
        p.prompt = String(m.prompt).slice(0, 1200);
        pushLog("manual", `Portal ${m.id}: ${p.prompt.slice(0, 80)}...`);
        broadcast({ t: "direction", narration: "", updates: [{ portal_id: m.id, prompt: p.prompt }] });
        broadcast(snapshot());
        break;
      }
      case "set_seed": {
        const seed = String(m.seed || "").trim().slice(0, 400);
        if (!seed) return;
        story.seed = seed;
        story.bible = `Setting: ${seed}.`;
        story.beats = [];
        pushLog("story", `New story seed: ${seed}`);
        broadcast(snapshot());
        break;
      }
      case "narrate_ui":
        broadcast({ t: "direction", narration: String(m.text || ""), updates: [] });
        break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`[living-window] API on http://localhost:${PORT}  director=${director.usingClaude ? "Claude" : "template fallback"}`);
});
