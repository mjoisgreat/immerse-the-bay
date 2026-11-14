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
