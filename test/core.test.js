// Story state machine: permissions, rooms, choices, touch, reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, allowed, applyDirection } from "../server/core.js";

const owner = { role: "owner" };
const start = () => {
  const s = initialState();
  reduce(s, { t: "hello", rid: "r1" }, owner);
  reduce(s, { t: "portal_added", id: "A", rid: "r1" }, owner);
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

test("a stale headset tab can't change portals", () => {
  const s = start();
  reduce(s, { t: "portal_added", id: "B", rid: "old-tab" }, owner);
  assert.deepEqual(s.portals.map((p) => p.id), ["A"]);
});

test("utterances ask the director; co-narrators are logged as guests", () => {
  const s = start();
  const { director } = reduce(s, { t: "utterance", text: "A fox appears" }, { role: "co" });
  assert.deepEqual(director, { type: "utterance", text: "A fox appears" });
  assert.equal(s.log.at(-1).kind, "guest");
});

test("choices come from the director and can be picked once", () => {
  const s = start();
  applyDirection(s, { narration: "n", bible: "b", updates: [], choices: ["Go left", "Go right"], speech: null }, 10);
  assert.deepEqual(s.choices, ["Go left", "Go right"]);
  const { director } = reduce(s, { t: "choose", index: 1 }, owner);
  assert.equal(director.text, "Go right");
  assert.deepEqual(s.choices, []);
  assert.equal(reduce(s, { t: "choose", index: 0 }, owner).director, null);
});

test("character speech is logged and sent to the headset", () => {
  const s = start();
  const [ev] = applyDirection(
    s,
    { narration: "n", bible: "b", updates: [], choices: [], speech: { speaker: "Mei", portal_id: "A", line: "Hello", voice: "warm" } },
    10,
  );
  assert.equal(ev.speech.line, "Hello");
  assert.equal(s.log.at(-1).text, "Mei: Hello");
});

test("touch sends the frame to the director but never stores it", () => {
  const s = start();
  const image = "data:image/jpeg;base64," + "A".repeat(100);
  const { director } = reduce(s, { t: "touch", id: "A", image, rid: "r1" }, owner);
  assert.equal(director.type, "touch");
  assert.equal(director.image, "A".repeat(100));
  assert.ok(!JSON.stringify(s).includes("AAAA"));
  assert.equal(reduce(s, { t: "touch", id: "Z", image, rid: "r1" }, owner).director, null);
});

test("stepping inside asks the director to reframe that portal", () => {
  const s = start();
  const { director } = reduce(s, { t: "immerse", id: "A", rid: "r1" }, owner);
  assert.deepEqual(director, { type: "step_inside", portal_id: "A" });
  assert.equal(s.immersedId, "A");
  reduce(s, { t: "immerse", id: null, rid: "r1" }, owner);
  assert.equal(s.immersedId, null);
});

test("reset clears the story, ideas and choices and closes windows", () => {
  const s = start();
  reduce(s, { t: "utterance", text: "A fox appears" }, owner);
  reduce(s, { t: "suggest", text: "A whale" }, { role: "viewer", voter: "v1" });
  s.choices = ["x"];
  const { events } = reduce(s, { t: "reset_story" }, { role: "console" });
  assert.deepEqual(events, [{ t: "reset" }]);
  assert.equal(s.story.beats.length, 0);
  assert.equal(s.suggestions.length, 0);
  assert.equal(s.choices.length, 0);
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

test("companion chats are logged for watchers and broadcast", () => {
  const s = start();
  const { events } = reduce(s, { t: "pip_said", name: "Bunny", you: "Hi Bunny", pip: "Hello!", rid: "r1" }, owner);
  assert.deepEqual(events, [{ t: "pip", name: "Bunny", line: "Hello!" }]);
  assert.deepEqual(s.log.slice(-2).map((l) => [l.kind, l.text]), [["pip_you", "Hi Bunny"], ["speech", "Bunny: Hello!"]]);
  assert.equal(allowed("console", "pip_said"), false);
});

test("a slow director reply can't overwrite a newer one", () => {
  const s = start();
  const dir = (prompt) => ({ narration: "n", bible: "b", updates: [{ portal_id: "A", prompt }], choices: [], speech: null });
  applyDirection(s, dir("newer scene"), 10, 2); // request 2 answered first
  const [ev] = applyDirection(s, dir("older scene"), 10, 1); // request 1 answered late
  assert.equal(s.portals[0].prompt, "newer scene");
  assert.deepEqual(ev.updates, []);
});
