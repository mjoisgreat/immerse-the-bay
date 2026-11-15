// Story state machine shared by the local server and the Vercel functions.
// State is plain JSON so it can live in memory or in Redis.

export const MAX_PORTALS = Number(process.env.MAX_PORTALS || 3);
const MAX_SUGGESTIONS = 25;
const MAX_BEATS = 20;
const MAX_PROMPTS = 12;
/** Where the companion can go to open a window, relative to where the storyteller is looking. */
const PLACES = ["here", "ahead", "left", "right", "behind"];

// Every portal is its own story: its own world (seed), story bible, beats, choice chips and prompt
// history, kept in `threads[portal id]`. Steering only ever touches the focused portal's thread.
// A new portal starts with no world: the storyteller is asked "what world is behind this window?"
// and their answer (or simply the first line they say) becomes its seed. Nothing is inherited from
// other portals, and there is no default seed.
const newThread = (seed = "") => ({ seed, bible: seed ? `Setting: ${seed}.` : "", beats: [], choices: [], prompts: [] });
const cleanSeed = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 400);
const thread = (s, id) => (id && s.threads[id]) || null;

export function initialState() {
  return {
    threads: {}, // portal id -> { seed, bible, beats, choices, prompts }
    nextSeed: "", // a world chosen ahead of time (New story, Prepare demo, console) for the next portal opened
    // `story` and `choices` always show the FOCUSED portal's thread (see mirror); pages read these.
    story: { seed: "", bible: "", beats: [] },
    portals: [], // [{ id, prompt, status }]
    focusId: null,
    immersedId: null, // the portal the storyteller has stepped inside, if any
    choices: [], // what could happen next, offered by the director
    companion: { id: "bunny", present: false }, // the director's body in the room (Bonnie or Pip), if summoned
    chat: [], // recent exchanges with the companion: [{ you, reply }]
    rendererId: null, // the owner's headset page that currently drives the streams
    meta: { title: "", shared: false, crowd: false },
    suggestions: [], // [{ id, text, voters: [voterId], at, by? }] (by = the author's display name, optional)
    people: [], // who is here right now: [{ id, kind, role, name, at }], see "here" (clients get livePeople())
    lastActive: Date.now(),
    log: [],
  };
}

/** Who may send which message. Roles come from the room's credentials (see api.js). */
const OWNER_ONLY = new Set(["hello", "portal_sync", "portal_added", "portal_removed", "portal_status", "heartbeat", "immerse", "touch", "companion"]);
const CONSOLE = new Set(["focus", "close_portal", "manual_prompt", "set_seed", "set_meta", "use_suggestion", "dismiss_suggestion", "reset_story"]);
const NARRATE = new Set(["utterance", "choose"]);
const ANYONE = new Set(["whoami", "suggest", "vote", "here"]);

// Presence: every page says "here" every ~10 s with what kind of device it is. Someone who has been quiet for
// PRESENCE_TTL is gone. Stale people are dropped when reading (livePeople), so a leave doesn't need a write.
export const KINDS = ["quest", "phone", "computer", "screen"]; // screen = the theater view on a TV
export const PRESENCE_TTL = 25_000;
const MAX_PEOPLE = 24;
/** A stable, public id for a device (voter ids stay private): a small FNV-1a hash. */
function presenceId(voter, kind) {
  let h = 0x811c9dc5;
  for (const c of `${voter}|${kind}`) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
/** The people to show: only those who were heard from recently, without their timestamps (so the state only changes when someone comes or goes). */
export function livePeople(people, now = Date.now()) {
  return (people || []).filter((p) => now - p.at < PRESENCE_TTL).map(({ at, ...p }) => p);
}

export function allowed(role, t) {
  if (ANYONE.has(t)) return true;
  if (role === "owner") return OWNER_ONLY.has(t) || CONSOLE.has(t) || NARRATE.has(t);
  if (role === "console") return CONSOLE.has(t) || NARRATE.has(t);
  if (role === "co") return NARRATE.has(t);
  return false;
}

function pushLog(s, kind, text, portal = null) {
  s.log.push({ at: Date.now(), kind, text, ...(portal && { portal }) });
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
  upgrade(s);
  const out = step(s, m, ctx);
  mirror(s);
  return out;
}

/** Upgrades state saved by older versions (one story for the whole room) to per-portal threads. */
function upgrade(s) {
  s.meta ??= { title: "", shared: false, crowd: false };
  s.suggestions ??= [];
  s.people ??= [];
  if (s.threads) return;
  s.threads = {};
  s.nextSeed = "";
  for (const p of s.portals || []) {
    s.threads[p.id] = { ...newThread(s.story?.seed || ""), bible: s.story?.bible || "", beats: (s.story?.beats || []).slice(-MAX_BEATS), prompts: p.prompt ? [p.prompt] : [] };
  }
  if (s.focusId && s.threads[s.focusId]) s.threads[s.focusId].choices = s.choices || [];
}

/** Points the room-level `story` and `choices` at the focused portal's thread. */
function mirror(s) {
  const th = thread(s, s.focusId);
  s.story = th ? { seed: th.seed, bible: th.bible, beats: th.beats } : { seed: s.nextSeed || "", bible: "", beats: [] };
  s.choices = th ? th.choices : [];
}

/**
 * A story line for the focused portal (spoken, typed, a picked choice or an audience idea).
 * If that portal has no world yet, the line defines its world instead. With no portal open it is
 * kept as the world of the next one. Returns the event for the director, or null.
 */
function tell(s, text, kind, addressed = false) {
  const id = s.focusId;
  const th = thread(s, id);
  if (addressed && (!th || !th.seed)) return { type: "utterance", text, portal_id: th ? id : null }; // talking to the companion
  if (!th) {
    s.nextSeed = cleanSeed(text);
    pushLog(s, "world", `The next window opens onto: ${s.nextSeed}`);
    return null;
  }
  if (!th.seed) return openWorld(s, id, text);
  th.beats.push(text);
  if (th.beats.length > MAX_BEATS) th.beats.shift();
  if (kind === "choice" || kind === "crowd") th.choices = []; // picked or overtaken: the old options are stale
  pushLog(s, kind, text, id);
  return { type: "utterance", text, portal_id: id };
}

/** Starts (or restarts) a portal's own story in the world `seed`. */
function openWorld(s, id, seed) {
  seed = cleanSeed(seed);
  s.threads[id] = newThread(seed);
  const p = find(s, id);
  if (p.status === "asking") p.status = "starting";
  pushLog(s, "world", `Window ${id}: ${seed}`, id);
  return { type: "portal_added", portal_id: id, world: seed };
}

function step(s, m, ctx) {
  const events = [];
  let director = null;

  // Only the current headset page may change portals; a stale tab of the owner is ignored.
  if (OWNER_ONLY.has(m.t) && m.t !== "hello" && s.rendererId && m.rid !== s.rendererId) return { events, director };
  if (OWNER_ONLY.has(m.t)) s.lastActive = Date.now();

  switch (m.t) {
    case "here": {
      // Presence: this device is in the room. Not story activity, so it never touches lastActive.
      if (!ctx.voter) break;
      const kind = KINDS.includes(m.kind) ? m.kind : "computer";
      const name = String(m.name || "").replace(/\s+/g, " ").trim().slice(0, 20);
      const now = Date.now();
      s.people = (s.people || []).filter((p) => now - p.at < PRESENCE_TTL);
      const id = presenceId(ctx.voter, kind);
      const known = s.people.find((p) => p.id === id);
      if (known) Object.assign(known, { role: ctx.role, name, at: now });
      else if (s.people.length < MAX_PEOPLE) {
        s.people.push({ id, kind, role: ctx.role, name, at: now });
        events.push({ t: "joined", id, kind, role: ctx.role, name });
      }
      break;
    }
    case "hello":
      // The owner's newest headset page takes over; the same page reconnecting re-sends its portals.
      if (m.rid !== s.rendererId) {
        events.push({ t: "takeover", rid: m.rid });
        s.threads = {}; // a new page has no windows yet; the same page reconnecting keeps its stories
      }
      s.rendererId = m.rid ?? null;
      s.portals = [];
      s.focusId = null;
      s.immersedId = null;
      break;
    case "portal_sync":
      if (!find(s, m.id) && s.portals.length < MAX_PORTALS) {
        const prompt = String(m.prompt || "");
        s.portals.push({ id: m.id, prompt, status: m.status || "streaming" });
        // The server lost this window's story (restart): its running scene stands in as its world.
        s.threads[m.id] ??= { ...newThread(cleanSeed(prompt)), prompts: prompt ? [prompt] : [] };
        s.focusId = s.focusId ?? m.id;
      }
      break;
    case "portal_added":
      if (find(s, m.id) || s.portals.length >= MAX_PORTALS) break;
      // Its world: one chosen ahead of time, or none yet (the headset asks what is behind it).
      s.portals.push({ id: m.id, prompt: "", status: s.nextSeed ? "starting" : "asking" });
      s.threads[m.id] = newThread();
      s.focusId = m.id;
      pushLog(s, "portal", `Portal ${m.id} opened`, m.id);
      if (s.nextSeed) director = openWorld(s, m.id, s.nextSeed);
      s.nextSeed = "";
      break;
    case "portal_removed":
      s.portals = s.portals.filter((p) => p.id !== m.id);
      delete s.threads[m.id];
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
      const text = (thread(s, s.focusId)?.choices || [])[Number(m.index)];
      if (!text) break;
      director = tell(s, text, "choice");
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
    case "companion":
      // The headset says which companion it has and whether it is in the room right now.
      s.companion = { id: m.id === "pip" ? "pip" : "bunny", present: Boolean(m.present) };
      break;
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
      // `addressed`: the storyteller was looking at the companion while they spoke.
      const addressed = Boolean(m.addressed && ctx.role === "owner");
      director = tell(s, text, ctx.role === "co" ? "guest" : "voice", addressed);
      if (director && addressed) director.addressed = true;
      break;
    }
    case "manual_prompt": {
      const p = find(s, m.id);
      if (!p || !m.prompt) break;
      p.prompt = String(m.prompt).slice(0, 1200);
      const th = (s.threads[m.id] ??= newThread());
      if (!th.seed) Object.assign(th, { seed: cleanSeed(p.prompt), bible: `Setting: ${cleanSeed(p.prompt)}.` });
      remember(th, p.prompt);
      if (p.status === "asking") p.status = "starting";
      pushLog(s, "manual", `Portal ${m.id}: ${p.prompt.slice(0, 80)}...`, m.id);
      events.push({ t: "direction", portal_id: m.id, narration: "", updates: [{ portal_id: m.id, prompt: p.prompt }] });
      break;
    }
    case "reset_story": {
      // Start over with nothing: every window closes and every story is forgotten, seeds included.
      // `seed` (optional) is the world of the NEXT window, chosen by whoever asked for the reset;
      // `ask` has the headset ask "what world is this story set in?"; `open` has it open a window.
      s.threads = {};
      s.portals = [];
      s.focusId = null;
      s.immersedId = null;
      s.nextSeed = cleanSeed(m.seed);
      s.suggestions = [];
      s.chat = [];
      s.log = [];
      pushLog(s, "story", s.nextSeed ? `New story: ${s.nextSeed}` : "The story was reset");
      events.push({ t: "reset", ask: Boolean(m.ask) && !s.nextSeed, open: Boolean(m.open), seed: s.nextSeed });
      break;
    }
    case "set_seed": {
      // The world of one window: the given one, else the focused one (its story starts over there),
      // else the next window to open.
      const seed = cleanSeed(m.seed);
      if (!seed) break;
      const id = find(s, m.id) ? m.id : s.focusId;
      if (find(s, id)) director = openWorld(s, id, seed);
      else {
        s.nextSeed = seed;
        pushLog(s, "world", `The next window opens onto: ${seed}`);
      }
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
      const by = cleanName(m.name);
      s.suggestions.push({ id: rid(), text, voters: [ctx.voter], at: Date.now(), ...(by && { by }) });
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
      // Audience ideas belong to the room, not to one window: an idea steers whichever window is
      // focused at the moment it is used (pinched on a card, "Use" in the console, or Crowd Mode).
      const x = m.id === "top" ? topSuggestion(s) : s.suggestions.find((y) => y.id === m.id);
      if (!x || !thread(s, s.focusId)) break; // no window to steer: the idea stays on the list
      s.suggestions = s.suggestions.filter((y) => y.id !== x.id);
      director = tell(s, x.text, "crowd");
      break;
    }
  }
  return { events, director };
}

function remember(th, prompt) {
  th.prompts.push(prompt);
  if (th.prompts.length > MAX_PROMPTS) th.prompts.shift();
}

/** A display name for an idea's author: letters, digits, spaces and . ' - only, up to 20 characters. */
const cleanName = (v) =>
  String(v || "")
    .replace(/[^\p{L}\p{N} .'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();

const byVotes = (a, b) => b.voters.length - a.voters.length || a.at - b.at;
function topSuggestion(s) {
  return [...(s.suggestions || [])].sort(byVotes)[0] || null;
}

/**
 * Asks the director (slow, async). Reads a snapshot; does not mutate. The director is given one
 * portal's thread only (the event's `portal_id`) and can steer nothing else; the other windows
 * are listed read-only so the companion knows what is in them.
 */
export function askDirector(director, s, event) {
  const id = event.portal_id ?? null;
  const th = thread(s, id);
  return director.direct({
    event,
    story: th ? { seed: th.seed, bible: th.bible, beats: th.beats } : { seed: "", bible: "", beats: [] },
    portals: s.portals.filter((p) => p.id === id).map((p) => ({ ...p, history: (th?.prompts || []).slice(-3) })),
    others: s.portals.filter((p) => p.id !== id).map((p) => ({ id: p.id, world: s.threads[p.id]?.seed || "", prompt: p.prompt })),
    focusId: id,
    immersedId: s.immersedId === id ? id : null,
    companion: s.companion ?? null,
    chat: s.chat ?? [],
  });
}

/**
 * Applies the director's answer to the *current* state (re-read after the wait).
 * `event` is what the director was asked about: its `portal_id` names the one thread the answer
 * belongs to (bible, beats, choices, prompt), whatever is focused by now. Without an event the
 * focused portal is used.
 */
export function applyDirection(s, out, ms, seq = 0, event = null) {
  upgrade(s);
  const id = event ? (event.portal_id ?? null) : s.focusId;
  const th = find(s, id) ? thread(s, id) : null;
  const companion = out.companion?.reply
    ? {
        name: s.companion?.id === "pip" ? "Pip" : "Bonnie",
        reply: String(out.companion.reply).slice(0, 300),
        gesture: out.companion.gesture || "none",
        move: out.companion.move || "none",
        // Asked to open a window: `open_window` is the world behind it ("" = ask the storyteller), `place` where
        // she goes to do it. Only present when she was asked, so ordinary replies are unchanged.
        ...(typeof out.companion.open_window === "string" && {
          open_window: cleanSeed(out.companion.open_window),
          // Several at once: up to two more worlds ("" = ask which), opened side by side.
          more_windows: (Array.isArray(out.companion.more_windows) ? out.companion.more_windows : []).slice(0, 2).map(cleanSeed),
          place: PLACES.includes(out.companion.place) ? out.companion.place : "here",
        }),
      }
    : null;
  // Small talk with the companion: the story, its choices and its subtitle stay as they were.
  const chatOnly = Boolean(companion && !out.updates.length && !String(out.narration || "").trim());
  if (chatOnly && th && event?.type === "utterance") {
    const i = th.beats.lastIndexOf(event.text);
    if (i !== -1) th.beats.splice(i, 1);
  }
  // A reply to an older request than one already applied: its portal prompts are out of date
  // (applying them would make the scene jump back), so keep only the newer ones.
  const stale = seq && seq < (s.appliedSeq || 0);
  if (seq && !stale) s.appliedSeq = seq;
  if (stale) out = { ...out, updates: out.updates.filter((u) => !(s.portalSeq || {})[u.portal_id] || s.portalSeq[u.portal_id] < seq) };
  s.portalSeq ??= {};
  for (const u of out.updates) s.portalSeq[u.portal_id] = Math.max(seq, s.portalSeq[u.portal_id] || 0);
  // Only this thread's own portal can be steered.
  const updates = th ? out.updates.filter((u) => u.portal_id === id) : [];
  for (const u of updates) {
    find(s, id).prompt = u.prompt;
    remember(th, u.prompt);
    // A world that began from a line said to the companion: that scene is its seed.
    if (!th.seed) th.seed = cleanSeed(event?.text || u.prompt);
  }
  if (th && !chatOnly) {
    th.bible = out.bible || th.bible;
    th.choices = (out.choices || []).map((c) => String(c).slice(0, 80)).filter(Boolean).slice(0, 3);
    pushLog(s, "director", `${out.narration} (${ms} ms, ${updates.length} portal updates)`, id);
  }
  mirror(s);
  const speech = out.speech?.line && th ? { ...out.speech, portal_id: id } : null;
  if (speech) pushLog(s, "speech", `${speech.speaker}: ${speech.line}`, id);
  if (companion) {
    pushLog(s, "speech", `${companion.name}: ${companion.reply}`);
    s.chat = [...(s.chat || []), { you: event?.type === "utterance" ? event.text : null, reply: companion.reply }].slice(-8);
  }
  // `choices` are the focused window's, which may not be the one this answer was for.
  return [{ t: "direction", portal_id: id, narration: th ? out.narration : "", updates, choices: s.choices, speech, companion }];
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
