// Story state machine shared by the local server (WebSocket) and the Vercel
// functions (Redis + polling). State is plain JSON so it can live in either place.

export const MAX_PORTALS = Number(process.env.MAX_PORTALS || 3);
const DEFAULT_SEED =
  "A lantern-lit fishing village on a misty mountain lake at dusk, wooden boats, paper lanterns glowing amber";

export function initialState() {
  return {
    story: { seed: DEFAULT_SEED, bible: `Setting: ${DEFAULT_SEED}. Time: dusk. Mood: calm, magical.`, beats: [] },
    portals: [], // [{ id, prompt, status }]
    focusId: null,
    log: [],
  };
}

function pushLog(s, kind, text) {
  s.log.push({ at: Date.now(), kind, text });
  if (s.log.length > 60) s.log.shift();
}
const find = (s, id) => s.portals.find((p) => p.id === id);

/**
 * Applies one client message to `s` (mutates it).
 * Returns { events, director } where `events` go to every client and
 * `director` (if set) is an event the story director must handle afterwards.
 */
export function reduce(s, m) {
  const events = [];
  let director = null;
  switch (m.t) {
    case "hello":
      // The headset owns the streams: when it (re)connects, its portals are the truth.
      if (m.role === "renderer") (s.portals = []), (s.focusId = null);
      break;
    case "portal_sync":
      if (!find(s, m.id) && s.portals.length < MAX_PORTALS) {
        s.portals.push({ id: m.id, prompt: String(m.prompt || ""), status: m.status || "streaming" });
        s.focusId = s.focusId ?? m.id;
      }
      break;
    case "portal_added":
      if (find(s, m.id) || s.portals.length >= MAX_PORTALS) break;
      s.portals.push({ id: m.id, prompt: "", status: "starting" });
      s.focusId = m.id;
      pushLog(s, "portal", `Portal ${m.id} opened`);
      director = { type: "portal_added", portal_id: m.id };
      break;
    case "portal_removed":
      s.portals = s.portals.filter((p) => p.id !== m.id);
      if (s.focusId === m.id) s.focusId = s.portals[0]?.id ?? null;
      pushLog(s, "portal", `Portal ${m.id} closed`);
      break;
    case "portal_status": {
      const p = find(s, m.id);
      if (p) p.status = String(m.status);
      break;
    }
    case "focus":
      if (find(s, m.id)) s.focusId = m.id;
      break;
    case "close_portal":
      events.push({ t: "close_portal", id: m.id });
      break;
    case "utterance": {
      const text = String(m.text || "").trim().slice(0, 500);
      if (!text) break;
      s.story.beats.push(text);
      if (s.story.beats.length > 40) s.story.beats.shift();
      pushLog(s, "voice", text);
      director = { type: "utterance", text };
      break;
    }
    case "manual_prompt": {
      const p = find(s, m.id);
      if (!p || !m.prompt) break;
      p.prompt = String(m.prompt).slice(0, 1200);
      pushLog(s, "manual", `Portal ${m.id}: ${p.prompt.slice(0, 80)}...`);
      events.push({ t: "direction", narration: "", updates: [{ portal_id: m.id, prompt: p.prompt }] });
      break;
    }
    case "set_seed": {
      const seed = String(m.seed || "").trim().slice(0, 400);
      if (!seed) break;
      s.story = { seed, bible: `Setting: ${seed}.`, beats: [] };
      pushLog(s, "story", `New story seed: ${seed}`);
      break;
    }
  }
  return { events, director };
}

/** Asks the director (slow, async). Reads a snapshot; does not mutate. */
export function askDirector(director, s, event) {
  return director.direct({ event, story: s.story, portals: s.portals, focusId: s.focusId });
}

/** Applies the director's answer to the *current* state (re-read after the wait). */
export function applyDirection(s, out, ms) {
  s.story.bible = out.bible || s.story.bible;
  const updates = out.updates.filter((u) => find(s, u.portal_id));
  for (const u of updates) find(s, u.portal_id).prompt = u.prompt;
  pushLog(s, "director", `${out.narration} (${ms} ms, ${updates.length} portal updates)`);
  return [{ t: "direction", narration: out.narration, updates }];
}
