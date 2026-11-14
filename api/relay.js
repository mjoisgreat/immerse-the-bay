// Polling replacement for the WebSocket relay.
//   GET  /api/relay?since=N  -> { state, events (seq > N), seq }
//   POST /api/relay {msg}    -> applies the message; runs the story director if needed
import { createDirector } from "../server/director.js";
import { reduce, askDirector, applyDirection } from "../server/core.js";
import * as store from "./_lib/store.js";
const { loadState, saveState, pushEvents, poll, roomOf } = store;
import { fail, readJson } from "./_lib/http.js";

const director = createDirector();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!store.redis) return res.status(500).json({ error: "Redis is not configured (add Upstash in Vercel)" });
  try {
    if (req.method === "GET") {
      const since = Number(req.query.since || 0);
      const { state, events, seq } = await poll(roomOf(req.query.room));
      return res.json({
        state: { ...state, director: director.usingClaude ? "claude" : "template" },
        events: events.filter((e) => e.seq > since),
        seq,
      });
    }
    if (req.method !== "POST") return res.status(405).end();

    const msg = await readJson(req);
    const room = roomOf(msg.room);
    const s = await loadState(room);
    const { events, director: event } = reduce(s, msg);
    await saveState(room, s);
    await pushEvents(room, events);
    if (event) {
      const started = Date.now();
      const out = await askDirector(director, s, event);
      const fresh = await loadState(room); // others may have changed state while the director thought
      const more = applyDirection(fresh, out, Date.now() - started);
      await saveState(room, fresh);
      await pushEvents(room, more);
    }
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
}
