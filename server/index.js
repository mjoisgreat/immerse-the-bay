// Local server (laptop). Same API as the Vercel deployment, with an in-memory store.
import "dotenv/config";
import express from "express";
import * as api from "./api.js";
import { memoryStore } from "./stores.js";

const PORT = Number(process.env.PORT || 8787);
const app = express();
const store = memoryStore();

const send = (res, r) => (r.body === null ? res.status(r.status).end() : res.status(r.status).json(r.body));
const wrap = (fn) => async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    send(res, await fn(req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
const json = express.json({ limit: "200kb" });

app.get("/api/config", wrap(() => api.config()));
app.get("/api/relay", wrap((req) => api.relayGet(store, req.query)));
app.post("/api/relay", json, wrap((req) => api.relayPost(store, req.body || {})));
app.post("/api/token", json, wrap((req) => api.token(store, req.body || {})));
app.post("/api/session-cleanup", json, wrap((req) => api.sessionCleanup(req.body)));
app.post(
  "/api/transcribe",
  express.raw({ type: "application/octet-stream", limit: "8mb" }),
  wrap((req) => api.speech(store, req.headers, req.body)),
);
app.get("/api/snapshot", wrap((req) => api.snapshotGet(store, req.query)));
app.post("/api/snapshot", json, wrap((req) => api.snapshotPost(store, req.body || {})));
app.get("/api/community", wrap(() => api.community(store)));
app.use(express.static("dist"));

app.listen(PORT, () => {
  console.log(`[living-window] API on http://localhost:${PORT}  director=${api.config().body.director}`);
});
