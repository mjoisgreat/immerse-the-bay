// Story state machine shared by the local server and the Vercel functions.
// State is plain JSON so it can live in memory or in Redis.

const MAX_SUGGESTIONS = 50;
const IDEAS_EACH = 10; // open ideas per person at once
export const CROWD_ROUND_MS = 10_000; // Crowd Mode: the top-voted idea plays this often
const MAX_BEATS = 20;
const MAX_PROMPTS = 12;

// There is one window and one story. The window starts with no world: the storyteller is asked
// "what world is behind this window?" and their answer (or simply the first line they say) becomes
// the story's seed. Nothing is inherited from an earlier window, and there is no default seed.
const newStory = (seed = "") => ({ seed, bible: seed ? `Setting: ${seed}.` : "", beats: [] });
const cleanSeed = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 400);

export function initialState() {
  return {
    window: null, // the one window, once the headset has opened it: { prompt, status }
    story: newStory(), // its world (seed), bible and beats
    prompts: [], // the prompts the window has been given, oldest first
    choices: [], // what could happen next, offered by the director
    nextSeed: "", // a world chosen ahead of time (New story, console) for the window to open onto
    immersed: false, // the storyteller has stepped inside the window
    companion: { id: "bunny", present: false }, // the director's body in the room (Bonnie or Pip), if summoned
    chat: [], // recent exchanges with the companion: [{ you, reply }]
    rendererId: null, // the owner's headset page that currently drives the stream
    meta: { title: "", shared: false, crowd: false },
    suggestions: [], // [{ id, text, voters: [voterId], at, by? }] (by = the author's display name, optional)
    people: [], // who is here right now: [{ id, kind, role, name, at }], see "here" (clients get livePeople())
    lastActive: Date.now(),
    log: [],
  };
}

/** Who may send which message. Roles come from the room's credentials (see api.js). */
const OWNER_ONLY = new Set(["prepare_suggestion", "hello", "window_sync", "window_opened", "window_closed", "window_status", "heartbeat", "immerse", "touch", "companion"]);
const CONSOLE = new Set(["close_window", "manual_prompt", "set_seed", "set_meta", "use_suggestion", "dismiss_suggestion", "reset_story"]);
const NARRATE = new Set(["utterance", "choose"]);
const ANYONE = new Set(["whoami", "suggest", "vote", "delete_suggestion", "here", "rtc"]);

// Presence: every page says "here" every ~10 s with what kind of device it is. Someone who has been quiet for
// PRESENCE_TTL is gone. Stale people are dropped when reading (livePeople), so a leave doesn't need a write.
export const RTC_KINDS = ["join", "offer", "answer", "bye", "full"];
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

function pushLog(s, kind, text) {
  s.log.push({ at: Date.now(), kind, text });
  if (s.log.length > 60) s.log.shift();
}
const rid = () => Math.random().toString(36).slice(2, 9);

/**
 * Applies one message to `s` (mutates it). `ctx` = { role, voter }.
 * Returns { events, director } where `events` go to every client and
 * `director` (if set) is an event the story director must handle afterwards.
 */
export function reduce(s, m, ctx = {}) {
  upgrade(s);
  return step(s, m, ctx);
}

/** Upgrades state saved by older versions (several windows, a story each) to the single window. */
function upgrade(s) {
  s.meta ??= { title: "", shared: false, crowd: false };
  s.suggestions ??= [];
  s.people ??= [];
  if (!("portals" in s) && !("threads" in s)) return;
  const p = (s.portals || []).find((x) => x.id === s.focusId) ?? s.portals?.[0] ?? null;
  const th = (p && s.threads?.[p.id]) || null;
  s.window = p ? { prompt: p.prompt || "", status: p.status || "streaming" } : null;
  s.story = th ? { seed: th.seed, bible: th.bible, beats: th.beats } : newStory();
  s.prompts = th?.prompts || [];
  s.choices = th?.choices || [];
  s.immersed = Boolean(s.immersedId);
  for (const k of ["portals", "threads", "focusId", "immersedId", "portalSeq"]) delete s[k];
}

/**
 * A story line (spoken, typed, a picked choice or an audience idea). If the window has no world yet,
 * the line defines its world instead. With no window open it is kept as the world of the one to come.
 * Returns the event for the director, or null.
 */
function tell(s, text, kind, addressed = false) {
  const open = Boolean(s.window);
  if (addressed && (!open || !s.story.seed)) return { type: "utterance", text }; // talking to the companion
  if (!open) {
    s.nextSeed = cleanSeed(text);
    pushLog(s, "world", `The window opens onto: ${s.nextSeed}`);
    return null;
  }
  if (!s.story.seed) return openWorld(s, text);
  s.story.beats.push(text);
  if (s.story.beats.length > MAX_BEATS) s.story.beats.shift();
  if (kind === "choice" || kind === "crowd") s.choices = []; // picked or overtaken: the old options are stale
  pushLog(s, kind, text);
  return { type: "utterance", text };
}

/** Starts (or restarts) the window's story in the world `seed`. */
function openWorld(s, seed) {
  seed = cleanSeed(seed);
  s.story = newStory(seed);
  s.prompts = [];
  s.choices = [];
  if (s.window.status === "asking") s.window.status = "starting";
  pushLog(s, "world", `The window shows: ${seed}`);
  return { type: "world", world: seed };
}

function step(s, m, ctx) {
  const events = [];
  let director = null;

  // Only the current headset page may change the window; a stale tab of the owner is ignored.
  if (OWNER_ONLY.has(m.t) && m.t !== "hello" && s.rendererId && m.rid !== s.rendererId) return { events, director };
  if (OWNER_ONLY.has(m.t)) s.lastActive = Date.now();

  switch (m.t) {
    case "rtc": {
      // Live viewing: a viewer and the storyteller's device set up a peer-to-peer link (WebRTC offer/answer)
      // through the room. Nothing is stored; the event reaches the page it's addressed to (`to`).
      const kind = RTC_KINDS.includes(m.kind) ? m.kind : null;
      const id = (v) => (typeof v === "string" && /^[a-z0-9-]{1,40}$/i.test(v) ? v : null);
      const to = id(m.to), from = id(m.from);
      if (!kind || !to || !from || to === from) break;
      // Only the storyteller's device speaks as "host"; anyone may ask it for a live view.
      if (from === "host" && ctx.role !== "owner") break;
      const sdp = typeof m.sdp === "string" && m.sdp.length <= 20_000 ? m.sdp : undefined;
      if ((kind === "offer" || kind === "answer") && !sdp) break;
      events.push({ t: "rtc", kind, to, from, ...(sdp && { sdp }) });
      break;
    }
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
      // The owner's newest headset page takes over; the same page reconnecting re-sends its window.
      if (m.rid !== s.rendererId) {
        events.push({ t: "takeover", rid: m.rid });
        s.story = newStory(); // a new page has no window yet; the same page reconnecting keeps its story
        s.prompts = [];
        s.choices = [];
      }
      s.rendererId = m.rid ?? null;
      s.window = null;
      s.immersed = false;
      break;
    case "window_sync":
      if (!s.window) {
        const prompt = String(m.prompt || "");
        s.window = { prompt, status: m.status || "streaming" };
        // The server lost the story (restart): the running scene stands in as its world.
        if (!s.story.seed) {
          s.story = newStory(cleanSeed(prompt));
          s.prompts = prompt ? [prompt] : [];
        }
      }
      break;
    case "window_opened":
      if (s.window) break;
      // Its world: one chosen ahead of time, or none yet (the headset asks what is behind it).
      s.window = { prompt: "", status: s.nextSeed ? "starting" : "asking" };
      s.story = newStory();
      s.prompts = [];
      s.choices = [];
      pushLog(s, "window", "Window opened");
      if (s.nextSeed) director = openWorld(s, s.nextSeed);
      s.nextSeed = "";
      break;
    case "window_closed":
      s.window = null;
      s.story = newStory();
      s.prompts = [];
      s.choices = [];
      s.immersed = false;
      pushLog(s, "window", "Window closed");
      break;
    case "window_status":
      if (s.window) s.window.status = String(m.status).slice(0, 20);
      break;
    case "choose": {
      // Someone picked one of the director's "what happens next" options.
      const text = s.choices[Number(m.index)];
      if (!text) break;
      director = tell(s, text, "choice");
      break;
    }
    case "touch": {
      // The storyteller reached into the world; the frame (with the spot marked) goes to the director only.
      const image = String(m.image || "");
      if (!s.window || !image.startsWith("data:image/jpeg;base64,") || image.length > 150_000) break;
      pushLog(s, "touch", "Reached into the window");
      director = { type: "touch", image: image.slice("data:image/jpeg;base64,".length) };
      break;
    }
    case "companion":
      // The headset says which companion it has and whether it is in the room right now.
      s.companion = { id: m.id === "pip" ? "pip" : "bunny", present: Boolean(m.present) };
      break;
    case "immerse": {
      // The storyteller stepped inside the window (or back out into the room).
      const inside = Boolean(m.inside) && Boolean(s.window);
      if (inside === s.immersed) break;
      s.immersed = inside;
      if (inside) {
        pushLog(s, "window", "Stepped inside the window");
        director = { type: "step_inside" };
      } else pushLog(s, "window", "Stepped back into the room");
      break;
    }
    case "close_window":
      events.push({ t: "close_window" });
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
      if (!s.window || !m.prompt) break;
      s.window.prompt = String(m.prompt).slice(0, 1200);
      if (!s.story.seed) s.story = newStory(cleanSeed(s.window.prompt));
      remember(s, s.window.prompt);
      if (s.window.status === "asking") s.window.status = "starting";
      pushLog(s, "manual", `Window: ${s.window.prompt.slice(0, 80)}...`);
      events.push({ t: "direction", narration: "", prompt: s.window.prompt });
      break;
    }
    case "reset_story": {
      // Start over with nothing: the window closes and the story is forgotten, seed included.
      // `seed` (optional) is the world of the NEXT window, chosen by whoever asked for the reset;
      // `ask` has the headset ask "what world is this story set in?"; `open` has it open the window.
      s.window = null;
      s.story = newStory();
      s.prompts = [];
      s.choices = [];
      s.immersed = false;
      s.nextSeed = cleanSeed(m.seed);
      s.suggestions = [];
      s.chat = [];
      s.log = [];
      pushLog(s, "story", s.nextSeed ? `New story: ${s.nextSeed}` : "The story was reset");
      events.push({ t: "reset", ask: Boolean(m.ask) && !s.nextSeed, seed: s.nextSeed });
      break;
    }
    case "set_seed": {
      // The world behind the window: the story starts over there. With no window yet, it waits for one.
      const seed = cleanSeed(m.seed);
      if (!seed) break;
      if (s.window) director = openWorld(s, seed);
      else {
        s.nextSeed = seed;
        pushLog(s, "world", `The window opens onto: ${seed}`);
      }
      break;
    }
    case "set_meta":
      if (typeof m.title === "string") s.meta.title = m.title.trim().slice(0, 60);
      if (typeof m.shared === "boolean") s.meta.shared = m.shared;
      if (typeof m.crowd === "boolean" && m.crowd !== s.meta.crowd) {
        s.meta.crowd = m.crowd;
        armCrowd(s, true);
      }
      break;

    // ---- community ----
    case "suggest": {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (!text || !ctx.voter) break;
      if (s.suggestions.filter((x) => x.voters[0] === ctx.voter).length >= IDEAS_EACH) break; // a few open ideas each
      if (s.suggestions.some((x) => x.text.toLowerCase() === text.toLowerCase())) break;
      const by = cleanName(m.name);
      s.suggestions.push({ id: rid(), text, voters: [ctx.voter], at: Date.now(), ...(by && { by }) });
      armCrowd(s); // the first idea starts the countdown (one already running keeps going)
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
    case "delete_suggestion":
      // Anyone can take back their own idea (its first voter is its author); the storyteller dismisses others'.
      if (ctx.voter) s.suggestions = s.suggestions.filter((x) => !(x.id === m.id && x.voters[0] === ctx.voter));
      break;
    case "use_suggestion": {
      // An idea steers the window's story (pinched on a card, "Use" in the console, or Crowd Mode).
      const x = m.id === "top" ? topSuggestion(s) : s.suggestions.find((y) => y.id === m.id);
      if (!x || !s.window) break; // no window to steer: the idea stays on the list
      // Crowd Mode's head start: the director already answered for this idea, on this exact story.
      const ready = s.prepared?.id === x.id && s.prepared.base === storyKey(s) ? s.prepared.out : null;
      s.prepared = null;
      s.suggestions = s.suggestions.filter((y) => y.id !== x.id);
      director = tell(s, x.text, "crowd");
      if (director && ready) director.ready = ready; // the API applies it at once instead of asking again
      armCrowd(s, true); // a fresh round for the next idea
      break;
    }
  }
  return { events, director };
}

function remember(s, prompt) {
  s.prompts.push(prompt);
  if (s.prompts.length > MAX_PROMPTS) s.prompts.shift();
}

/** A display name for an idea's author: letters, digits, spaces and . ' - only, up to 20 characters. */
const cleanName = (v) =>
  String(v || "")
    .replace(/[^\p{L}\p{N} .'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();

/**
 * What a prepared answer depends on: the story so far, the window's scene and every director request
 * since. If any of it changes before the idea is used, the prepared answer is thrown away.
 */
export function storyKey(s) {
  return JSON.stringify([s.directorSeq || 0, s.story?.seed, s.story?.beats, s.window?.prompt, s.chat?.length || 0]);
}

/**
 * Crowd Mode's head start: what the director would be asked if idea `id` were used now, worked out on
 * a copy so nothing changes yet. Returns { event, snapshot, base } or null (no such idea, no story).
 */
export function prepareSuggestion(s, id) {
  const x = s.suggestions?.find((y) => y.id === id);
  if (!x || !s.window || !s.story?.seed) return null;
  const copy = structuredClone(s);
  const event = tell(copy, x.text, "crowd");
  return event ? { event, snapshot: copy, base: storyKey(s) } : null;
}

/**
 * Crowd Mode's shared countdown: the next idea plays at s.crowdAt (the round began at s.crowdFrom), so
 * every screen counts down to the same moment and the headset plays the idea when it arrives. Starts
 * a round when none is running, or a fresh one when `restart`; off when Crowd Mode is off.
 */
function armCrowd(s, restart = false, now = Date.now()) {
  if (!s.meta?.crowd) return void (s.crowdAt = s.crowdFrom = 0);
  if (!restart && s.crowdAt > now) return;
  s.crowdFrom = now;
  s.crowdAt = now + CROWD_ROUND_MS;
}

const byVotes = (a, b) => b.voters.length - a.voters.length || a.at - b.at;
function topSuggestion(s) {
  return [...(s.suggestions || [])].sort(byVotes)[0] || null;
}

/** Asks the director (slow, async). Reads a snapshot; does not mutate. */
export function askDirector(director, s, event) {
  return director.direct({
    event,
    story: s.story,
    window: s.window ? { prompt: s.window.prompt, history: s.prompts.slice(-3) } : null,
    immersed: s.immersed,
    companion: s.companion ?? null,
    chat: s.chat ?? [],
  });
}

/**
 * Applies the director's answer to the *current* state (re-read after the wait).
 * `event` is what the director was asked about.
 */
export function applyDirection(s, out, ms, seq = 0, event = null) {
  upgrade(s);
  const companion = out.companion?.reply
    ? {
        name: s.companion?.id === "pip" ? "Pip" : "Bonnie",
        reply: String(out.companion.reply).slice(0, 300),
        gesture: out.companion.gesture || "none",
        move: out.companion.move || "none",
        // Asked for a new landscape: `world` is the world to show ("" = ask the storyteller). Only present
        // when she was asked, so ordinary replies are unchanged.
        ...(typeof out.companion.world === "string" && { world: cleanSeed(out.companion.world) }),
      }
    : null;
  // Small talk with the companion: the story, its choices and its subtitle stay as they were.
  const chatOnly = Boolean(companion && !out.prompt && !String(out.narration || "").trim());
  if (chatOnly && event?.type === "utterance") {
    const i = s.story.beats.lastIndexOf(event.text);
    if (i !== -1) s.story.beats.splice(i, 1);
  }
  // A reply to an older request than one already applied: its prompt is out of date (applying it
  // would make the scene jump back), so drop it.
  const stale = seq && seq < (s.appliedSeq || 0);
  if (seq && !stale) s.appliedSeq = seq;
  const prompt = s.window && !stale && out.prompt ? out.prompt : null;
  if (prompt) {
    s.window.prompt = prompt;
    remember(s, prompt);
    // A world that began from a line said to the companion: that scene is its seed.
    if (!s.story.seed) s.story = newStory(cleanSeed(event?.text || prompt));
  }
  if (s.window && !chatOnly) {
    s.story.bible = out.bible || s.story.bible;
    s.choices = (out.choices || []).map((c) => String(c).slice(0, 80)).filter(Boolean).slice(0, 3);
    pushLog(s, "director", `${out.narration} (${ms} ms${prompt ? ", new prompt" : ""})`);
  }
  const speech = out.speech?.line && s.window ? { speaker: out.speech.speaker, line: out.speech.line, voice: out.speech.voice } : null;
  if (speech) pushLog(s, "speech", `${speech.speaker}: ${speech.line}`);
  if (companion) {
    pushLog(s, "speech", `${companion.name}: ${companion.reply}`);
    s.chat = [...(s.chat || []), { you: event?.type === "utterance" ? event.text : null, reply: companion.reply }].slice(-8);
  }
  return [{ t: "direction", narration: s.window ? out.narration : "", prompt, choices: s.choices, speech, companion }];
}

/** A story's title when nobody named it: the window's world ("A misty pine forest at dawn"). */
export function autoTitle(s) {
  const seed = s.story?.seed || "";
  const t = seed.replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
  if (!t) return "";
  const short = t.length > 60 ? `${t.slice(0, 57).replace(/\s+\S*$/, "")}…` : t;
  return short[0].toUpperCase() + short.slice(1);
}

/** What the gallery shows for a room. */
const STORY_KINDS = new Set(["director", "speech", "voice", "guest", "crowd", "choice", "touch"]);
export function summary(room, s, snap) {
  const lastLine = [...(s.log || [])].reverse().find((l) => l.kind === "director");
  return {
    room,
    title: s.meta?.title || autoTitle(s) || "A new story",
    line: lastLine ? lastLine.text.replace(/\s*\(\d+ ms.*\)$/, "") : "",
    crowd: Boolean(s.meta?.crowd),
    live: Date.now() - (s.lastActive || 0) < 60_000,
    lastActive: s.lastActive || 0,
    thumb: snap || null,
    watching: livePeople(s.people).length,
    ideas: (s.suggestions || []).length,
    // The newest ideas, shown on the card like the last lines of a stream chat.
    chat: [...(s.suggestions || [])]
      .sort((a, b) => b.at - a.at) // newest first
      .slice(0, 2)
      .map((x) => ({ by: x.by || "", text: x.text, votes: x.voters.length })),
    // The story so far: its newest lines (the narrator, the storyteller, the crowd, the characters), newest first.
    story: (s.log || [])
      .filter((l) => STORY_KINDS.has(l.kind))
      .slice(-3)
      .reverse()
      .map(({ kind, text, at }) => ({ kind, text: String(text).slice(0, 240), at })),
  };
}
