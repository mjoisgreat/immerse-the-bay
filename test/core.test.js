// Story state machine: permissions, rooms, choices, touch, reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, allowed, applyDirection, CROWD_ROUND_MS } from "../server/core.js";

const owner = { role: "owner" };
/** A room with the window open onto a lake world (pass `null` to leave it without a world yet). */
const start = (world = "A misty lake at dusk") => {
  const s = initialState();
  reduce(s, { t: "hello", rid: "r1" }, owner);
  reduce(s, { t: "window_opened", rid: "r1" }, owner);
  if (world) reduce(s, { t: "set_seed", seed: world }, { role: "console" });
  return s;
};

test("roles can only do what they're allowed", () => {
  assert.equal(allowed("viewer", "suggest"), true);
  assert.equal(allowed("viewer", "utterance"), false);
  assert.equal(allowed("co", "utterance"), true);
  assert.equal(allowed("co", "choose"), true);
  assert.equal(allowed("co", "reset_story"), false);
  assert.equal(allowed("console", "reset_story"), true);
  assert.equal(allowed("console", "touch"), false);
  assert.equal(allowed("owner", "touch"), true);
  assert.equal(allowed("none", "immerse"), false);
});

test("a stale headset tab can't change the window", () => {
  const s = initialState();
  reduce(s, { t: "hello", rid: "r1" }, owner);
  reduce(s, { t: "window_opened", rid: "old-tab" }, owner);
  assert.equal(s.window, null);
  reduce(s, { t: "window_opened", rid: "r1" }, owner);
  assert.equal(s.window.status, "asking");
});

test("there is only ever one window", () => {
  const s = start();
  reduce(s, { t: "window_opened", rid: "r1" }, owner);
  assert.equal(s.story.seed, "A misty lake at dusk"); // the second opening changed nothing
});

test("utterances ask the director; co-narrators are logged as guests", () => {
  const s = start();
  const { director } = reduce(s, { t: "utterance", text: "A fox appears" }, { role: "co" });
  assert.deepEqual(director, { type: "utterance", text: "A fox appears" });
  assert.equal(s.log.at(-1).kind, "guest");
});

test("choices come from the director and can be picked once", () => {
  const s = start();
  applyDirection(s, { narration: "n", bible: "b", prompt: null, choices: ["Go left", "Go right"] }, 10);
  assert.deepEqual(s.choices, ["Go left", "Go right"]);
  const { director } = reduce(s, { t: "choose", index: 1 }, owner);
  assert.equal(director.text, "Go right");
  assert.deepEqual(s.choices, []);
  assert.equal(reduce(s, { t: "choose", index: 0 }, owner).director, null);
});

test("a world asked for while one is showing is a transition: the story moves on, no restart", () => {
  const s = start();
  reduce(s, { t: "companion", id: "bunny", present: true, rid: "r1" }, owner);
  const [ev] = applyDirection(s, bunny("Fine.", { prompt: "The lake melts into desert dunes.", companion: { reply: "Fine.", gesture: "none", move: "none", world: "a desert at noon" } }), 10);
  assert.equal(s.story.seed, "a desert at noon");
  assert.equal(ev.prompt, "The lake melts into desert dunes.");
  assert.ok(!("world" in ev.companion)); // the headset keeps the window open
});

test("touch sends the frame to the director but never stores it", () => {
  const s = start();
  const image = "data:image/jpeg;base64," + "A".repeat(100);
  const { director } = reduce(s, { t: "touch", image, rid: "r1" }, owner);
  assert.equal(director.type, "touch");
  assert.equal(director.image, "A".repeat(100));
  assert.ok(!JSON.stringify(s).includes("AAAA"));
  assert.equal(reduce(initialState(), { t: "touch", image }, owner).director, null); // no window to touch
});

test("stepping inside asks the director to reframe the window", () => {
  const s = start();
  const { director } = reduce(s, { t: "immerse", inside: true, rid: "r1" }, owner);
  assert.deepEqual(director, { type: "step_inside" });
  assert.equal(s.immersed, true);
  reduce(s, { t: "immerse", inside: false, rid: "r1" }, owner);
  assert.equal(s.immersed, false);
});

test("reset clears everything: the window, the story, ideas, choices and the seed", () => {
  const s = start();
  reduce(s, { t: "utterance", text: "A fox appears" }, owner);
  reduce(s, { t: "suggest", text: "A whale" }, { role: "viewer", voter: "v1" });
  s.choices = ["x"];
  const { events } = reduce(s, { t: "reset_story" }, { role: "console" });
  assert.deepEqual(events, [{ t: "reset", seed: "" }]);
  assert.equal(s.window, null);
  assert.deepEqual(s.story, { seed: "", bible: "", beats: [] });
  assert.equal(s.nextSeed, "");
  assert.equal(s.suggestions.length, 0);
  assert.equal(s.choices.length, 0);
  // The next window does not get the old world back: it has none until someone names one.
  const { director } = reduce(s, { t: "window_opened", rid: "r1" }, owner);
  assert.equal(director, null);
  assert.equal(s.story.seed, "");
  assert.equal(s.window.status, "asking");
  assert.ok(!JSON.stringify(s.story).includes("lake"));
});

test("a new story can name its world up front", () => {
  const s = start();
  let { events } = reduce(s, { t: "reset_story" }, owner);
  assert.deepEqual(events, [{ t: "reset", seed: "" }]);
  ({ events } = reduce(s, { t: "reset_story", seed: "A coral city" }, owner));
  assert.deepEqual(events, [{ t: "reset", seed: "A coral city" }]);
  const { director } = reduce(s, { t: "window_opened", rid: "r1" }, owner);
  assert.deepEqual(director, { type: "world", world: "A coral city" });
  assert.equal(s.nextSeed, ""); // used once, never again
});

test("a new window has no world until Bonnie makes one: the owner's words go to her", () => {
  const s = start(null);
  assert.equal(s.story.seed, "");
  const { director } = reduce(s, { t: "utterance", text: "A tin-can moon base" }, owner);
  assert.deepEqual(director, { type: "utterance", text: "A tin-can moon base", addressed: true });
  assert.equal(s.story.seed, ""); // the world comes from her answer, not from the words
  // With no window open the owner's words go to her too, and nothing is stored for later.
  const empty = initialState();
  assert.equal(reduce(empty, { t: "utterance", text: "A coral city" }, owner).director.addressed, true);
  assert.equal(empty.nextSeed, "");
});

test("closing the window forgets its story", () => {
  const s = start();
  s.chat = [{ you: "hi", reply: "old" }];
  reduce(s, { t: "window_closed", rid: "r1" }, owner);
  assert.equal(s.window, null);
  assert.deepEqual(s.chat, []); // Bonnie forgets the old exchanges too
  assert.equal(s.story.seed, "");
  assert.deepEqual(s.choices, []);
});

test("an audience idea steers the window's story", () => {
  const s = start();
  reduce(s, { t: "suggest", text: "A full moon rises", name: "Maya" }, { role: "viewer", voter: "v1" });
  const { director } = reduce(s, { t: "use_suggestion", id: s.suggestions[0].id }, owner);
  assert.deepEqual(director, { type: "utterance", text: "A full moon rises" });
  assert.deepEqual(s.story.beats, ["A full moon rises"]);
  // With no window open the idea is kept for later.
  const empty = initialState();
  reduce(empty, { t: "suggest", text: "A whale" }, { role: "viewer", voter: "v1" });
  assert.equal(reduce(empty, { t: "use_suggestion", id: "top" }, owner).director, null);
  assert.equal(empty.suggestions.length, 1);
});

test("setting a seed restarts the window's story, or waits for the window", () => {
  const s = start();
  reduce(s, { t: "utterance", text: "A fox appears" }, owner);
  const { director } = reduce(s, { t: "set_seed", seed: "A coral city" }, { role: "console" });
  assert.deepEqual(director, { type: "world", world: "A coral city" });
  assert.deepEqual(s.story.beats, []);
  const empty = initialState();
  assert.equal(reduce(empty, { t: "set_seed", seed: "A coral city" }, { role: "console" }).director, null);
  assert.equal(empty.nextSeed, "A coral city");
});

test("older saved rooms (several windows) upgrade to the single window", () => {
  const old = {
    portals: [{ id: "A", prompt: "lake shot", status: "streaming" }, { id: "B", prompt: "moon", status: "streaming" }],
    threads: { A: { seed: "A lake", bible: "Lake bible", beats: ["x"], choices: ["Row"], prompts: ["lake shot"] }, B: { seed: "Moon", bible: "", beats: [], choices: [], prompts: [] } },
    focusId: "A",
    immersedId: "A",
    suggestions: [],
    log: [],
    meta: {},
  };
  reduce(old, { t: "heartbeat" }, owner);
  assert.deepEqual(old.window, { prompt: "lake shot", status: "streaming" });
  assert.equal(old.story.seed, "A lake");
  assert.deepEqual(old.choices, ["Row"]);
  assert.equal(old.immersed, true);
  assert.ok(!("threads" in old) && !("portals" in old));
});

test("suggestions and votes", () => {
  const s = start();
  reduce(s, { t: "suggest", text: "A whale rises" }, { role: "viewer", voter: "v1" });
  reduce(s, { t: "suggest", text: "a whale rises" }, { role: "viewer", voter: "v2" }); // duplicate
  assert.equal(s.suggestions.length, 1);
  const id = s.suggestions[0].id;
  reduce(s, { t: "vote", id }, { role: "viewer", voter: "v2" });
  assert.equal(s.suggestions[0].voters.length, 2);
  reduce(s, { t: "vote", id }, { role: "viewer", voter: "v2" }); // toggles off
  assert.equal(s.suggestions[0].voters.length, 1);
});

test("ideas keep their author's name, cleaned and optional", () => {
  const s = start();
  reduce(s, { t: "suggest", text: "A full moon rises", name: "  Maya <b>Ö'Neil</b>  the second " }, { role: "viewer", voter: "v1" });
  reduce(s, { t: "suggest", text: "Lanterns float up" }, { role: "viewer", voter: "v2" });
  assert.equal(s.suggestions[0].by, "Maya bÖ'Neilb the se"); // tags stripped, 20 characters max
  assert.equal("by" in s.suggestions[1], false);
});

test("using a crowd idea moves the story on and clears the director's old options", () => {
  const s = start();
  applyDirection(s, { narration: "n", bible: "b", prompt: null, choices: ["Go left"] }, 10);
  reduce(s, { t: "suggest", text: "A full moon rises", name: "Maya" }, { role: "viewer", voter: "v1" });
  const { director } = reduce(s, { t: "use_suggestion", id: s.suggestions[0].id }, owner);
  assert.equal(director.text, "A full moon rises");
  assert.deepEqual(s.choices, []);
  assert.equal(s.suggestions.length, 0);
  assert.equal(s.log.at(-1).kind, "crowd");
});

const bunny = (reply, more = {}) => ({ narration: "", bible: "b", prompt: null, choices: [], companion: { reply, gesture: "wave", move: "none" }, ...more });

test("asked for a new landscape, the companion's reply carries the world; other replies carry none", () => {
  const s = start();
  reduce(s, { t: "companion", id: "bunny", present: true, rid: "r1" }, owner);
  const [ev] = applyDirection(s, bunny("On it!", { companion: { reply: "On it!", gesture: "thumbs_up", move: "none", world: "  a snowy   village " } }), 10);
  assert.equal(ev.companion.world, "a snowy village");
  assert.equal(ev.prompt, null); // the new world gets its own opening shot
  const [ask] = applyDirection(s, bunny("Sure!", { companion: { reply: "Sure!", gesture: "none", move: "none", world: "" } }), 10);
  assert.equal(ask.companion.world, "");
  const [plain] = applyDirection(s, bunny("Hello!"), 10);
  assert.ok(!("world" in plain.companion));
});

test("small talk with the companion is spoken and logged but leaves the story alone", () => {
  const s = start();
  reduce(s, { t: "companion", id: "bunny", present: true, rid: "r1" }, owner);
  applyDirection(s, { narration: "n", bible: "b", prompt: null, choices: ["Go left", "Go right"], companion: null }, 10);
  const { director } = reduce(s, { t: "utterance", text: "Hi Bonnie", addressed: true }, owner);
  assert.deepEqual(director, { type: "utterance", text: "Hi Bonnie", addressed: true });
  const [ev] = applyDirection(s, bunny("Hello!"), 10, 0, director);
  assert.deepEqual(ev.companion, { name: "Bonnie", reply: "Hello!", gesture: "wave", move: "none" });
  assert.deepEqual(s.story.beats, []);
  assert.deepEqual(s.choices, ["Go left", "Go right"]);
  assert.equal(s.log.at(-1).text, "Bonnie: Hello!");
  assert.equal(s.log.filter((l) => l.kind === "director").length, 1);
  assert.deepEqual(s.chat, [{ you: "Hi Bonnie", reply: "Hello!" }]);
});

test("a companion reply that comes with a story change keeps the beat", () => {
  const s = start();
  const { director } = reduce(s, { t: "utterance", text: "Bonnie, make it snow" }, owner);
  const out = bunny("Snow coming up!", { narration: "Snow begins to fall.", prompt: "snowy pier" });
  const [ev] = applyDirection(s, out, 10, 0, director);
  assert.deepEqual(s.story.beats, ["Bonnie, make it snow"]);
  assert.equal(s.window.prompt, "snowy pier");
  assert.equal(ev.companion.reply, "Snow coming up!");
});

test("only the headset can say where the companion is or that it was addressed", () => {
  const s = start();
  assert.equal(allowed("console", "companion"), false);
  reduce(s, { t: "companion", id: "pip", present: true, rid: "r1" }, owner);
  assert.deepEqual(s.companion, { id: "pip", present: true });
  assert.equal(reduce(s, { t: "utterance", text: "Hi", addressed: true }, { role: "co" }).director.addressed, undefined);
});

test("a slow director reply can't overwrite a newer one", () => {
  const s = start();
  const dir = (prompt) => ({ narration: "n", bible: "b", prompt, choices: [] });
  applyDirection(s, dir("newer scene"), 10, 2); // request 2 answered first
  const late = applyDirection(s, { ...dir("older scene"), companion: { reply: "Old news.", gesture: "none", move: "none" } }, 10, 1); // request 1 answered late
  assert.equal(s.window.prompt, "newer scene");
  assert.deepEqual(late, []); // dropped whole: neither its scene nor Bonnie's old answer reaches the headset
  assert.ok(!s.log.some((l) => l.text.includes("Old news")));
});

import { autoTitle, summary } from "../server/core.js";
test("a shared story without a title is named after the window's world", () => {
  const s = initialState();
  assert.equal(summary("abc", s).title, "A new story");
  s.story.seed = "a misty pine forest at dawn.";
  assert.equal(autoTitle(s), "A misty pine forest at dawn");
  assert.equal(summary("abc", s).title, "A misty pine forest at dawn");
  s.meta.title = "My forest";
  assert.equal(summary("abc", s).title, "My forest");
  s.story.seed = "an enormous sprawling underwater city of glass domes and coral towers lit by lanterns";
  assert.ok(autoTitle(s).length <= 60 && autoTitle(s).endsWith("…"));
});

test("live viewing: offers and answers pass through the room, addressed and checked", () => {
  const s = initialState();
  const viewer = { role: "audience", voter: "v1" }, owner = { role: "owner", voter: "o1" };
  const ev = (m, ctx) => reduce(s, { ...m }, ctx).events.filter((e) => e.t === "rtc");
  assert.deepEqual(ev({ t: "rtc", kind: "join", to: "host", from: "abc123" }, viewer), [{ t: "rtc", kind: "join", to: "host", from: "abc123" }]);
  const offer = ev({ t: "rtc", kind: "offer", to: "abc123", from: "host", sdp: "v=0..." }, owner);
  assert.equal(offer.length, 1);
  assert.equal(offer[0].sdp, "v=0...");
  // A viewer can't pretend to be the storyteller's device; offers need an SDP; junk is dropped.
  assert.deepEqual(ev({ t: "rtc", kind: "offer", to: "x1", from: "host", sdp: "v=0" }, viewer), []);
  assert.deepEqual(ev({ t: "rtc", kind: "answer", to: "host", from: "abc123" }, viewer), []);
  assert.deepEqual(ev({ t: "rtc", kind: "nope", to: "host", from: "abc123" }, viewer), []);
  assert.deepEqual(ev({ t: "rtc", kind: "join", to: "host", from: "bad id!" }, viewer), []);
  assert.deepEqual(ev({ t: "rtc", kind: "answer", to: "host", from: "abc123", sdp: "x".repeat(20001) }, viewer), []);
});

import { iceServers } from "../server/api.js";
test("live viewing: STUN always, TURN only when it's fully configured", () => {
  assert.equal(iceServers({}).length, 1);
  assert.equal(iceServers({ TURN_URL: "turn:x:3478" }).length, 1); // no credentials: not used
  const both = iceServers({ TURN_URL: "turn:x:3478, turns:x:5349", TURN_USERNAME: "u", TURN_CREDENTIAL: "p" });
  assert.deepEqual(both[1], { urls: ["turn:x:3478", "turns:x:5349"], username: "u", credential: "p" });
});

test("Crowd Mode counts down to the next idea, and a used idea starts a fresh round", () => {
  const s = start();
  const viewer = { role: "viewer", voter: "v1" };
  reduce(s, { t: "suggest", text: "A whale" }, viewer);
  assert.ok(!s.crowdAt, "no countdown while Crowd Mode is off");
  const before = Date.now();
  reduce(s, { t: "set_meta", crowd: true }, owner);
  assert.ok(s.crowdAt >= before + CROWD_ROUND_MS && s.crowdAt - s.crowdFrom === CROWD_ROUND_MS);
  const due = s.crowdAt;
  reduce(s, { t: "suggest", text: "A storm" }, viewer);
  assert.equal(s.crowdAt, due, "a new idea doesn't restart a running round");
  s.crowdAt = s.crowdFrom = 1; // the round ran out...
  reduce(s, { t: "use_suggestion", id: "top" }, owner);
  assert.ok(s.crowdAt > Date.now(), "...and using the idea starts the next one");
  reduce(s, { t: "set_meta", crowd: false }, owner);
  assert.equal(s.crowdAt, 0);
});

test("people can delete their own ideas, and have up to 10 open at once", () => {
  const s = start();
  const ana = { role: "viewer", voter: "ana" }, bo = { role: "viewer", voter: "bo" };
  for (let i = 0; i < 12; i++) reduce(s, { t: "suggest", text: `Idea ${i}` }, ana);
  assert.equal(s.suggestions.length, 10);
  const id = s.suggestions[0].id;
  reduce(s, { t: "delete_suggestion", id }, bo);
  assert.equal(s.suggestions.length, 10, "not someone else's");
  reduce(s, { t: "delete_suggestion", id }, ana);
  assert.equal(s.suggestions.length, 9);
  assert.equal(allowed("viewer", "delete_suggestion"), true);
  assert.equal(allowed("viewer", "prepare_suggestion"), false);
});

test("Crowd Mode's head start: a prepared answer is used only if the story hasn't moved on", async () => {
  const { prepareSuggestion } = await import("../server/core.js");
  const s = start();
  reduce(s, { t: "suggest", text: "A whale rises" }, { role: "viewer", voter: "v1" });
  const id = s.suggestions[0].id;
  const job = prepareSuggestion(s, id);
  assert.equal(job.event.text, "A whale rises");
  assert.equal(s.story.beats.includes("A whale rises"), false, "preparing changes nothing yet");
  const out = { narration: "A whale rises.", bible: "b", prompt: "A whale breaches the lake", choices: [], speech: null, companion: null };
  s.prepared = { id, base: job.base, out };
  const used = reduce(s, { t: "use_suggestion", id }, owner);
  assert.deepEqual(used.director.ready, out);
  // The story moved on (someone spoke) after preparing: the director is asked again instead.
  reduce(s, { t: "suggest", text: "A storm" }, { role: "viewer", voter: "v1" });
  const id2 = s.suggestions[0].id;
  s.prepared = { id: id2, base: prepareSuggestion(s, id2).base, out };
  reduce(s, { t: "utterance", text: "Then the moon goes out" }, owner);
  assert.equal(reduce(s, { t: "use_suggestion", id: id2 }, owner).director.ready, undefined);
});

test("community cards carry the story so far, newest first, without system lines", async () => {
  const { summary } = await import("../server/core.js");
  const s = initialState();
  s.log = [
    { kind: "window", text: "Window opened", at: 1 },
    { kind: "voice", text: "A misty lake", at: 2 },
    { kind: "director", text: "Mist rolls in. (812 ms, new prompt)", at: 3 },
    { kind: "speech", text: "Mei: Hello", at: 4 },
  ];
  assert.deepEqual(summary("abc", s).story.map((l) => l.kind), ["speech", "director", "voice"]);
});
