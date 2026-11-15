// The backup director (used when Claude is unavailable) must keep scenes continuous.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirector, sceneOf } from "../server/director.js";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const director = createDirector();
const story = { seed: "A lantern-lit fishing village on a misty lake at dusk", bible: "b", beats: [] };
const portal = (prompt) => [{ id: "A", prompt }];

test("speaking steers the current scene instead of resetting to the seed", async () => {
  const p1 = "A wooden pier at night under a full moon, an old ferrywoman in a straw hat waits by her boat.";
  const out = await director.direct({ event: { type: "utterance", text: "A fox appears" }, story, portals: portal(p1), focusId: "A" });
  const prompt = out.updates[0].prompt;
  assert.ok(prompt.startsWith("A wooden pier at night"), prompt);
  assert.ok(prompt.includes("A fox appears"));
  assert.ok(!prompt.includes("fishing village"));
});

test("recent events stay in the scene, older ones fade out, nothing piles up", async () => {
  let prompt = "A wooden pier at night.";
  for (const text of ["A boat drifts by", "A fox appears", "It starts to snow", "Fireworks light the sky"]) {
    prompt = (await director.direct({ event: { type: "utterance", text }, story, portals: portal(prompt), focusId: "A" })).updates[0].prompt;
  }
  assert.ok(prompt.startsWith("A wooden pier at night."), prompt);
  assert.ok(prompt.includes("Fireworks") && prompt.includes("fox") && prompt.includes("snow"), prompt);
  assert.ok(!prompt.includes("boat"), prompt);
  assert.equal(prompt.split("Cinematic, one continuous").length, 2);
  assert.equal(prompt.split("Now, in the same continuous shot").length, 2);
});

test("touching and stepping in repeatedly never stacks text", async () => {
  let prompt = "A wooden pier at night.";
  for (let i = 0; i < 4; i++) {
    prompt = (await director.direct({ event: { type: "touch", portal_id: "A" }, story, portals: portal(prompt), focusId: "A" })).updates[0].prompt;
    prompt = (await director.direct({ event: { type: "step_inside", portal_id: "A" }, story, portals: portal(prompt), focusId: "A", immersedId: "A" })).updates[0].prompt;
  }
  assert.equal(prompt.split("ripple of golden light").length, 1);
  assert.equal(prompt.split("20 mm wide-angle").length, 2);
  assert.ok(prompt.length < 800, `${prompt.length}`);
});

test("the backup still offers choices", async () => {
  const out = await director.direct({ event: { type: "utterance", text: "hello" }, story, portals: portal("x."), focusId: "A" });
  assert.equal(out.choices.length, 3);
});

test("sceneOf keeps long Claude prompts to a few sentences", () => {
  const long = "Sentence one is here. ".repeat(40);
  assert.ok(sceneOf(long, "seed").length <= 420);
  assert.equal(sceneOf("", "the seed"), "the seed.");
});

const here = { id: "bunny", present: true };
const say = (text, more = {}) => director.direct({ event: { type: "utterance", text, ...more }, story, portals: portal("A wooden pier at night."), focusId: "A", companion: here, ...more.input });

test("small talk with the companion changes nothing in the story", async () => {
  const out = await say("Hi Bonnie!");
  assert.deepEqual(out.updates, []);
  assert.equal(out.narration, "");
  assert.ok(out.companion.reply);
  const called = await say("bonnie");
  assert.deepEqual(called.updates, []);
  assert.ok(called.companion.reply);
  const follow = await say("follow me", { addressed: true });
  assert.equal(follow.companion.move, "follow");
  assert.deepEqual(follow.updates, []);
});

test("asking the companion for a story change steers the scene without putting its name in it", async () => {
  const out = await say("Bonnie, make it snow");
  assert.ok(out.companion.reply);
  assert.ok(out.updates[0].prompt.includes("make it snow"), out.updates[0].prompt);
  assert.ok(!/bonnie/i.test(out.updates[0].prompt), out.updates[0].prompt);
});

test("the companion stays quiet when narrating, and when it isn't in the room", async () => {
  assert.equal((await say("A fox appears")).companion, null);
  const away = await director.direct({ event: { type: "utterance", text: "Hi Bonnie!" }, story, portals: portal("x."), focusId: "A", companion: { id: "bunny", present: false } });
  assert.equal(away.companion, null);
  assert.ok(away.updates.length);
});
