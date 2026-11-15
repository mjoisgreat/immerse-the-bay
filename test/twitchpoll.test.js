// Twitch chat poll: parsing chat, the two stages, the server's poll messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChat, weightedSample, TwitchPoll } from "../src/twitchpoll.js";
import { channelOf, parseIrc } from "../src/twitch.js";
import { initialState, reduce } from "../server/core.js";

test("chat commands", () => {
  assert.deepEqual(parseChat("!idea  a dragon   lands"), { idea: "a dragon lands" });
  assert.deepEqual(parseChat("!i cats"), { idea: "cats" });
  assert.deepEqual(parseChat("!vote 3"), { vote: 3 });
  assert.deepEqual(parseChat("2"), { vote: 2 });
  assert.equal(parseChat("lol 2"), null);
  assert.equal(parseChat("!idea"), null);
});

test("channel names and IRC lines", () => {
  assert.equal(channelOf("https://www.twitch.tv/mini_sonrixs"), "mini_sonrixs");
  assert.equal(channelOf("#Mini_Sonrixs"), "mini_sonrixs");
  const m = parseIrc("@display-name=Foo;color=#FF0000 :foo!foo@foo.tmi.twitch.tv PRIVMSG #ch :!idea a big fish");
  assert.equal(m.command, "PRIVMSG");
  assert.equal(m.tags["display-name"], "Foo");
  assert.equal(m.trailing, "!idea a big fish");
});

test("weighted sample never repeats and favours heavy items", () => {
  const items = [{ w: 100 }, { w: 1 }, { w: 1 }];
  const out = weightedSample(items, 3, (x) => x.w, () => 0.5);
  assert.equal(new Set(out).size, 3);
  assert.equal(out[0].w, 100);
});

test("a round: collect, draw 5, vote, winner", async () => {
  let winner = null;
  const p = new TwitchPoll({ shorten: async (t) => t.map((x) => x.slice(0, 5)), onWinner: (w) => (winner = w), rand: () => 0.3 });
  p.start(0);
  for (let i = 0; i < 1000; i++) p.handle({ user: `u${i}`, text: `!idea idea number ${i}` }, 0);
  p.handle({ user: "x", text: "!idea Idea number 7!" }, 0); // the same idea counts as support
  assert.equal(p.pool.size, 1000);
  assert.equal(p.handle({ user: "u1", text: "1" }), null); // no voting while collecting
  await p.tick(45_000);
  assert.equal(p.stage, "vote");
  assert.equal(p.options.length, 5);
  assert.equal(p.pool.size, 0); // the next round starts fresh
  assert.equal(p.options[0].short.length <= 5, true);
  p.handle({ user: "a", text: "!vote 2" });
  p.handle({ user: "b", text: "2" });
  p.handle({ user: "c", text: "4" });
  p.handle({ user: "c", text: "2" }); // changed their mind: still one vote
  assert.deepEqual(p.tally(), [0, 3, 0, 0, 0]);
  p.handle({ user: "d", text: "!idea next round idea" }); // goes into the next round
  p.endVote(100_000);
  assert.equal(winner.text, p.lastWinner.text);
  assert.equal(winner.votes, 3);
  assert.equal(p.stage, "collect");
  assert.equal(p.pool.size, 1);
});

test("a person can add at most 3 ideas per round", () => {
  const p = new TwitchPoll();
  p.start(0);
  for (let i = 0; i < 5; i++) p.handle({ user: "spam", text: `!idea thing ${i}` });
  assert.equal(p.pool.size, 3);
});

test("server: only the console runs the poll; the winner becomes a story line", () => {
  const s = initialState();
  reduce(s, { t: "hello", rid: "r1" }, { role: "owner" });
  reduce(s, { t: "portal_added", id: "A", rid: "r1" }, { role: "owner" });
  reduce(s, { t: "utterance", text: "A misty lake" }, { role: "owner" });
  const poll = { stage: "vote", ends: 5, channel: "ch", pool: 0, ideas: Array.from({ length: 7 }, (_, i) => ({ text: `idea ${i}`, short: `i${i}`, by: "Foo<b>", votes: 2 })) };
  reduce(s, { t: "poll", poll }, { role: "console" });
  assert.equal(s.poll.ideas.length, 5);
  assert.equal(s.poll.ideas[0].by, "Foob");
  assert.equal(s.poll.ideas[4].n, 5);
  const { director } = reduce(s, { t: "poll_win", text: "A whale sings", by: "Foo" }, { role: "console" });
  assert.equal(director.text, "A whale sings");
  assert.equal(s.threads.A.beats.at(-1), "A whale sings");
  reduce(s, { t: "poll", poll: null }, { role: "console" });
  assert.equal(s.poll, null);
});

test("server: calling the vote reaches the console only while ideas are collected", () => {
  const s = initialState();
  reduce(s, { t: "hello", rid: "r1" }, { role: "owner" });
  assert.deepEqual(reduce(s, { t: "poll_call" }, { role: "owner" }).events, []);
  reduce(s, { t: "poll", poll: { stage: "collect", ends: 1, ideas: [] } }, { role: "console" });
  assert.deepEqual(reduce(s, { t: "poll_call" }, { role: "owner" }).events, [{ t: "poll_call" }]);
});
