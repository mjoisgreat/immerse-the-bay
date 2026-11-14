// Story state machine shared by the local server and the Vercel functions.
// State is plain JSON so it can live in memory or in Redis.

export const MAX_PORTALS = Number(process.env.MAX_PORTALS || 3);
const MAX_SUGGESTIONS = 25;
const DEFAULT_SEED =
  "A lantern-lit fishing village on a misty mountain lake at dusk, wooden boats, paper lanterns glowing amber";

export function initialState() {
  return {
    story: { seed: DEFAULT_SEED, bible: `Setting: ${DEFAULT_SEED}. Time: dusk. Mood: calm, magical.`, beats: [] },
    portals: [], // [{ id, prompt, status }]
    focusId: null,
    immersedId: null, // the portal the storyteller has stepped inside, if any
    choices: [], // what could happen next, offered by the director
    rendererId: null, // the owner's headset page that currently drives the streams
    meta: { title: "", shared: false, crowd: false },
    suggestions: [], // [{ id, text, voters: [voterId], at }]
    lastActive: Date.now(),
    log: [],
  };
}

/** Who may send which message. Roles come from the room's credentials (see api.js). */
const OWNER_ONLY = new Set(["hello", "portal_sync", "portal_added", "portal_removed", "portal_status", "heartbeat", "immerse", "touch", "pip_said"]);
const CONSOLE = new Set(["focus", "close_portal", "manual_prompt", "set_seed", "set_meta", "use_suggestion", "dismiss_suggestion", "reset_story"]);
const NARRATE = new Set(["utterance", "choose"]);
const ANYONE = new Set(["whoami", "suggest", "vote"]);

export function allowed(role, t) {
  if (ANYONE.has(t)) return true;
  if (role === "owner") return OWNER_ONLY.has(t) || CONSOLE.has(t) || NARRATE.has(t);
  if (role === "console") return CONSOLE.has(t) || NARRATE.has(t);
  if (role === "co") return NARRATE.has(t);
  return false;
}

function pushLog(s, kind, text) {
  s.log.push({ at: Date.now(), kind, text });
  if (s.log.length > 60) s.log.shift();
}
const find = (s, id) => s.portals.find((p) => p.id === id);
const rid = () => Math.random().toString(36).slice(2, 9);

/**
 * Applies one message to `s` (mutates it). `ctx` = { role, voter }.
 * Returns { events, director } where `events` go to every client and
 * `director` (if set) is an event the story director must handle afterwards.
 */
export function reduce(s, m, ctx = {}) {
  const events = [];
  let director = null;
  // Upgrade state saved by older versions.
  s.meta ??= { title: "", shared: false, crowd: false };
  s.suggestions ??= [];

  // Only the current headset page may change portals; a stale tab of the owner is ignored.
  if (OWNER_ONLY.has(m.t) && m.t !== "hello" && s.rendererId && m.rid !== s.rendererId) return { events, director };
  if (OWNER_ONLY.has(m.t)) s.lastActive = Date.now();

  switch (m.t) {
    case "hello":
      // The owner's newest headset page takes over; the same page reconnecting re-sends its portals.
      if (m.rid !== s.rendererId) events.push({ t: "takeover", rid: m.rid });
      s.rendererId = m.rid ?? null;
      s.portals = [];
      s.focusId = null;
      s.immersedId = null;
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
      if (s.immersedId === m.id) s.immersedId = null;
      pushLog(s, "portal", `Portal ${m.id} closed`);
      break;
    case "portal_status": {
      const p = find(s, m.id);
      if (p) p.status = String(m.status).slice(0, 20);
      break;
    }
    case "choose": {
      // Someone picked one of the director's "what happens next" options.
      const text = (s.choices || [])[Number(m.index)];
      if (!text) break;
      s.choices = [];
      director = narrate(s, text, "choice");
      break;
    }
    case "touch": {
      // The storyteller reached into a world; the frame (with the spot marked) goes to the director only.
      const image = String(m.image || "");
      if (!find(s, m.id) || !image.startsWith("data:image/jpeg;base64,") || image.length > 150_000) break;
      s.focusId = m.id;
      pushLog(s, "touch", `Reached into window ${m.id}`);
      director = { type: "touch", portal_id: m.id, image: image.slice("data:image/jpeg;base64,".length) };
      break;
    }
    case "pip_said": {
      // A chat with Pip, kept in the story log so watchers and the theater can follow it.
      const you = String(m.you || "").trim().slice(0, 300), said = String(m.pip || "").trim().slice(0, 300);
      if (!said) break;
      if (you) pushLog(s, "pip_you", you);
      pushLog(s, "speech", `Pip: ${said}`);
      events.push({ t: "pip", line: said });
      break;
    }
    case "immerse": {
      // The storyteller stepped inside a portal (or back out into the room).
      const id = m.id && find(s, m.id) ? m.id : null;
      if (id === (s.immersedId ?? null)) break;
      s.immersedId = id;
      if (id) {
        s.focusId = id;
        pushLog(s, "portal", `Stepped inside portal ${id}`);
        director = { type: "step_inside", portal_id: id };
      } else pushLog(s, "portal", "Stepped back into the room");
      break;
    }
    case "focus":
      if (find(s, m.id)) s.focusId = m.id;
      break;
    case "close_portal":
      events.push({ t: "close_portal", id: m.id });
      break;
    case "utterance": {
      const text = String(m.text || "").trim().slice(0, 300);
      if (!text) break;
      director = narrate(s, text, ctx.role === "co" ? "guest" : "voice");
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
    case "reset_story": {
      // Start the story over from its seed: clears what happened, the ideas, and the open windows.
      const seed = s.story.seed;
      s.story = { seed, bible: `Setting: ${seed}.`, beats: [] };
      s.suggestions = [];
      s.choices = [];
      s.log = [];
      s.immersedId = null;
      pushLog(s, "story", "The story was reset");
      events.push({ t: "reset" });
      break;
    }
    case "set_seed": {
      const seed = String(m.seed || "").trim().slice(0, 400);
      if (!seed) break;
      s.story = { seed, bible: `Setting: ${seed}.`, beats: [] };
      pushLog(s, "story", `New story seed: ${seed}`);
      break;
    }
    case "set_meta":
      if (typeof m.title === "string") s.meta.title = m.title.trim().slice(0, 60);
      if (typeof m.shared === "boolean") s.meta.shared = m.shared;
      if (typeof m.crowd === "boolean") s.meta.crowd = m.crowd;
      break;

    // ---- community ----
    case "suggest": {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (!text || !ctx.voter) break;
      if (s.suggestions.filter((x) => x.voters[0] === ctx.voter).length >= 3) break; // 3 open ideas each
      if (s.suggestions.some((x) => x.text.toLowerCase() === text.toLowerCase())) break;
      s.suggestions.push({ id: rid(), text, voters: [ctx.voter], at: Date.now() });
      if (s.suggestions.length > MAX_SUGGESTIONS) {
        // Drop the least-voted, oldest idea.
        s.suggestions.sort(byVotes);
        s.suggestions.pop();
      }
      break;
    }
    case "vote": {
      const x = s.suggestions.find((y) => y.id === m.id);
      if (!x || !ctx.voter) break;
      const i = x.voters.indexOf(ctx.voter);
      if (i === -1) x.voters.push(ctx.voter);
      else if (i > 0) x.voters.splice(i, 1); // the author's own vote stays
      break;
    }
    case "dismiss_suggestion":
      s.suggestions = s.suggestions.filter((x) => x.id !== m.id);
      break;
    case "use_suggestion": {
      const x = m.id === "top" ? topSuggestion(s) : s.suggestions.find((y) => y.id === m.id);
      if (!x) break;
      s.suggestions = s.suggestions.filter((y) => y.id !== x.id);
      director = narrate(s, x.text, "crowd");
      break;
    }
  }
  return { events, director };
}

function narrate(s, text, kind) {
  s.story.beats.push(text);
  if (s.story.beats.length > 40) s.story.beats.shift();
  pushLog(s, kind, text);
  return { type: "utterance", text };
}

const byVotes = (a, b) => b.voters.length - a.voters.length || a.at - b.at;
export function topSuggestion(s) {
  return [...(s.suggestions || [])].sort(byVotes)[0] || null;
}

/** Asks the director (slow, async). Reads a snapshot; does not mutate. */
export function askDirector(director, s, event) {
  return director.direct({ event, story: s.story, portals: s.portals, focusId: s.focusId, immersedId: s.immersedId ?? null });
}

/** Applies the director's answer to the *current* state (re-read after the wait). */
export function applyDirection(s, out, ms) {
  s.story.bible = out.bible || s.story.bible;
  const updates = out.updates.filter((u) => find(s, u.portal_id));
  for (const u of updates) find(s, u.portal_id).prompt = u.prompt;
  pushLog(s, "director", `${out.narration} (${ms} ms, ${updates.length} portal updates)`);
  s.choices = (out.choices || []).map((c) => String(c).slice(0, 80)).filter(Boolean).slice(0, 3);
  const speech = out.speech?.line ? { ...out.speech, portal_id: find(s, out.speech.portal_id) ? out.speech.portal_id : s.focusId } : null;
  if (speech) pushLog(s, "speech", `${speech.speaker}: ${speech.line}`);
  return [{ t: "direction", narration: out.narration, updates, choices: s.choices, speech }];
}

/** What the gallery shows for a room. */
export function summary(room, s, snap) {
  const lastLine = [...(s.log || [])].reverse().find((l) => l.kind === "director");
  return {
    room,
    title: s.meta?.title || room,
    line: lastLine ? lastLine.text.replace(/\s*\(\d+ ms.*\)$/, "") : "",
    portals: (s.portals || []).length,
    crowd: Boolean(s.meta?.crowd),
    live: Date.now() - (s.lastActive || 0) < 60_000,
    lastActive: s.lastActive || 0,
    thumb: snap || null,
  };
}
