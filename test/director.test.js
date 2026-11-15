// The backup director (used when Claude is unavailable) must keep scenes continuous.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirector, sceneOf } from "../server/director.js";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const director = createDirector();
const story = { seed: "A lantern-lit fishing village on a misty lake at dusk", bible: "b", beats: [] };

const win = (prompt) => ({ prompt });

test("speaking steers the current scene instead of resetting to the seed", async () => {
  const p1 = "A wooden pier at night under a full moon, an old ferrywoman in a straw hat waits by her boat.";
  const out = await director.direct({ event: { type: "utterance", text: "A fox appears" }, story, window: win(p1) });
  const prompt = out.prompt;
  assert.ok(prompt.startsWith("A wooden pier at night"), prompt);
  assert.ok(prompt.includes("A fox appears"));
  assert.ok(!prompt.includes("fishing village"));
});

// The backup companion understands "change the world" too (the world comes from her words).
const ask = (text) =>
  director.direct({ event: { type: "utterance", text, addressed: true }, story, window: win("A pier."), companion: { id: "bunny", present: true } });
test("asking Bonnie for a window onto a world", async () => {
  const c = (await ask("Bonnie, go over there and open a window onto a misty pine forest")).companion;
  assert.equal(c.world, "a misty pine forest");
  assert.equal(c.move, "none");
});
test("asking for a new world without saying which leaves the world to be asked", async () => {
  assert.equal((await ask("Bonnie, open a window on my left")).companion.world, "");
  assert.equal((await ask("Bonnie, I want a new landscape")).companion.world, "");
});
test("proposing a story to Bonnie changes the world, without saying 'window'", async () => {
  const c = (await ask("Bonnie, let's go with Santa Claus")).companion;
  assert.equal(c.world, "Santa Claus");
  assert.match(c.reply, /Santa Claus/);
  assert.equal((await ask("Bonnie lets go to the moon")).companion.world, "the moon");
  assert.equal((await ask("Bonnie, I want to meet a friendly dragon")).companion.world, "a friendly dragon");
});
test("chatter and changes to the current world do not change the world", async () => {
  for (const text of ["Bonnie, let's go with me", "Bonnie, can we dance?", "Bonnie, follow me", "Bonnie, let's go", "Bonnie, take me home"]) {
    assert.equal((await ask(text)).companion?.world, undefined, text);
  }
});
test("ordinary small talk changes nothing", async () => {
  assert.equal((await ask("Hi Bonnie")).companion.world, undefined);
});

test("recent events stay in the scene, older ones fade out, nothing piles up", async () => {
  let prompt = "A wooden pier at night.";
  for (const text of ["A boat drifts by", "A fox appears", "It starts to snow", "Fireworks light the sky"]) {
    prompt = (await director.direct({ event: { type: "utterance", text }, story, window: win(prompt) })).prompt;
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
    prompt = (await director.direct({ event: { type: "touch" }, story, window: win(prompt) })).prompt;
    prompt = (await director.direct({ event: { type: "step_inside" }, story, window: win(prompt), immersed: true })).prompt;
  }
  assert.equal(prompt.split("ripple of golden light").length, 1);
  assert.equal(prompt.split("20 mm wide-angle").length, 2);
  assert.ok(prompt.length < 800, `${prompt.length}`);
});

test("the backup still offers choices", async () => {
  const out = await director.direct({ event: { type: "utterance", text: "hello" }, story, window: win("x.") });
  assert.equal(out.choices.length, 3);
});

test("sceneOf keeps long Claude prompts to a few sentences", () => {
  const long = "Sentence one is here. ".repeat(40);
  assert.ok(sceneOf(long, "seed").length <= 420);
  assert.equal(sceneOf("", "the seed"), "the seed.");
});

const here = { id: "bunny", present: true };
const say = (text, more = {}) => director.direct({ event: { type: "utterance", text, ...more }, story, window: win("A wooden pier at night."), companion: here });

test("small talk with the companion changes nothing in the story", async () => {
  const out = await say("Hi Bonnie!");
  assert.equal(out.prompt, null);
  assert.equal(out.narration, "");
  assert.ok(out.companion.reply);
  const called = await say("bonnie");
  assert.equal(called.prompt, null);
  assert.ok(called.companion.reply);
  const follow = await say("follow me", { addressed: true });
  assert.equal(follow.companion.move, "follow");
  assert.equal(follow.prompt, null);
});

test("asking the companion for a story change steers the scene without putting its name in it", async () => {
  const out = await say("Bonnie, make it snow");
  assert.ok(out.companion.reply);
  assert.ok(out.prompt.includes("make it snow"), out.prompt);
  assert.ok(!/bonnie/i.test(out.prompt), out.prompt);
});

test("the companion stays quiet when narrating, and when it isn't in the room", async () => {
  assert.equal((await say("A fox appears")).companion, null);
  const away = await director.direct({ event: { type: "utterance", text: "Hi Bonnie!" }, story, window: win("x."), companion: { id: "bunny", present: false } });
  assert.equal(away.companion, null);
  assert.ok(away.prompt);
});

test("a new world is exactly the world it was given, nothing else", async () => {
  const blank = { seed: "", bible: "", beats: [] };
  const out = await director.direct({ event: { type: "world", world: "A tin-can moon base" }, story: blank, window: win("") });
  assert.ok(out.prompt.startsWith("A tin-can moon base."), out.prompt);
  assert.ok(!out.prompt.includes("fishing village"));
});

test("backup: a new world needs her name; looking at her while telling the story keeps steering", async () => {
  // Looking at Bonnie (addressed) but not naming her: the world stays.
  assert.equal((await ask("I want to see the dragon fly over the lake")).companion?.world ?? null, null);
  assert.equal((await ask("Let's go to the lighthouse")).companion?.world ?? null, null);
});

test("backup: where to put the window is not part of its world", async () => {
  assert.equal((await ask("Bonnie, take us to a candy kingdom on the left")).companion.world, "a candy kingdom");
  assert.equal((await ask("Bonnie, let's go to the moon over there")).companion.world, "the moon");
  assert.equal((await ask("Bonnie, open a window onto a snowy village behind me")).companion.world, "a snowy village");
});

test("asking Bonnie for a trick: the one asked for, or any when asked to show off", async () => {
  assert.equal((await ask("Bonnie, do a backflip!")).companion.gesture, "flip");
  assert.equal((await ask("Bonnie can you moonwalk?")).companion.gesture, "moonwalk");
  assert.equal((await ask("Bonnie, do a cartwheel")).companion.gesture, "cartwheel");
  assert.equal((await ask("Bonnie, spin around")).companion.gesture, "spin");
  assert.ok(["flip", "cartwheel", "spin", "moonwalk"].includes((await ask("Bonnie, show me something cool")).companion.gesture));
  assert.equal((await ask("Bonnie, let's dance")).companion.gesture, "dance");
});
