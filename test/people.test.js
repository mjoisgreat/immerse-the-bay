// Presence (server) and the helpers pages use to show who is here and how to join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, allowed, livePeople, PRESENCE_TTL } from "../server/core.js";
import { deviceKind, peopleSummary, personLabel, joinedLine, joinUrl } from "../src/people.js";
import { joinCardHit } from "../src/joincard.js";
import { menuFor } from "../src/toolbar.js";

const owner = { role: "owner", voter: "owner-1" };
const viewer = (voter) => ({ role: "viewer", voter });
const hello = (s) => reduce(s, { t: "hello", rid: "r1" }, owner);
const here = (s, ctx, kind, name = "") => reduce(s, { t: "here", kind, name }, ctx);

test("anyone may say they are here, and it is not story activity", () => {
  assert.ok(["owner", "console", "co", "viewer"].every((r) => allowed(r, "here")));
  const s = initialState();
  hello(s);
  const before = s.lastActive = 123;
  here(s, viewer("v1"), "phone", "Ana");
  assert.equal(s.lastActive, before);
});

test("a new person is announced once; saying 'here' again only refreshes them", () => {
  const s = initialState();
  hello(s);
  const first = here(s, viewer("v1"), "phone", "Ana");
  assert.deepEqual(first.events.map((e) => [e.t, e.kind, e.role, e.name]), [["joined", "phone", "viewer", "Ana"]]);
  const again = here(s, viewer("v1"), "phone", "Ana");
  assert.deepEqual(again.events, []);
  assert.equal(s.people.length, 1);
});

test("one voter on a phone and a laptop is two devices; a name change updates the entry", () => {
  const s = initialState();
  hello(s);
  here(s, viewer("v1"), "phone", "Ana");
  here(s, viewer("v1"), "computer");
  assert.equal(s.people.length, 2);
  here(s, viewer("v1"), "phone", "  Ana   B  ");
  assert.equal(s.people.find((p) => p.kind === "phone").name, "Ana B");
  assert.equal(s.people.length, 2);
});

test("junk is cleaned: unknown kinds become a computer, long names are cut, no voter means no entry", () => {
  const s = initialState();
  hello(s);
  here(s, viewer("v1"), "toaster", "x".repeat(60));
  assert.equal(s.people[0].kind, "computer");
  assert.equal(s.people[0].name.length, 20);
  reduce(s, { t: "here", kind: "phone" }, { role: "viewer" });
  assert.equal(s.people.length, 1);
});

test("the list is capped so nobody can flood the room", () => {
  const s = initialState();
  hello(s);
  for (let i = 0; i < 40; i++) here(s, viewer(`v${i}`), "phone");
  assert.equal(s.people.length, 24);
});

test("people who went quiet disappear when read, and timestamps are never shown", () => {
  const now = 1_000_000;
  const people = [
    { id: "a", kind: "quest", role: "owner", name: "", at: now - 1000 },
    { id: "b", kind: "phone", role: "viewer", name: "Ana", at: now - PRESENCE_TTL - 1 },
  ];
  assert.deepEqual(livePeople(people, now), [{ id: "a", kind: "quest", role: "owner", name: "" }]);
  assert.deepEqual(livePeople(undefined, now), []);
});

test("device kinds", () => {
  assert.equal(deviceKind({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/35.0 Chrome/126 VR Quest 3" }), "quest");
  assert.equal(deviceKind({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148" }), "phone");
  assert.equal(deviceKind({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile" }), "phone");
  assert.equal(deviceKind({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126", maxTouchPoints: 0, width: 1600 }), "computer");
  assert.equal(deviceKind({ userAgent: "Mozilla/5.0 (Macintosh) Safari", maxTouchPoints: 5, width: 800 }), "phone"); // iPad-style
  assert.equal(deviceKind(), "computer");
});

test("how people are described", () => {
  const people = [{ kind: "quest" }, { kind: "phone" }, { kind: "phone" }, { kind: "computer" }, { kind: "screen" }];
  assert.equal(peopleSummary(people), "Quest · 2 phones · laptop · screen");
  assert.equal(peopleSummary([]), "");
  assert.equal(peopleSummary(undefined), "");
  assert.equal(personLabel({ name: "Ana", kind: "phone" }), "Ana (phone)");
  assert.equal(personLabel({ name: "", kind: "phone", role: "viewer" }), "Someone on a phone");
  assert.equal(joinedLine({ name: "Ana", kind: "phone", role: "viewer" }), "Ana joined on a phone");
  assert.equal(joinedLine({ name: "", kind: "computer", role: "co" }), "Someone joined on a computer");
  assert.equal(joinedLine({ name: "", kind: "quest", role: "owner" }), ""); // your own devices don't announce themselves
});

test("the join link is audience-only unless joiners may narrate", () => {
  const base = { origin: "https://x.app", room: "amber-fox-42", invite: "INV123" };
  assert.equal(joinUrl(base), "https://x.app/watch.html?room=amber-fox-42");
  assert.equal(joinUrl({ ...base, narrate: true }), "https://x.app/watch.html?room=amber-fox-42&invite=INV123");
  assert.equal(joinUrl({ ...base, invite: "", narrate: true }), "https://x.app/watch.html?room=amber-fox-42");
});

test("the invite card: the switch and the close strip are where they are drawn", () => {
  const v = (y) => 1 - y / 1080; // canvas y (from the top) to a uv v
  assert.equal(joinCardHit(0.5, v(850)), "toggle");
  assert.equal(joinCardHit(0.02, v(850)), null); // the card's edge, outside the switch
  assert.equal(joinCardHit(0.5, v(1000)), "close");
  assert.equal(joinCardHit(0.5, v(400)), null); // on the QR code
});

test("the headset menu offers Invite friends (not while inside a window)", () => {
  assert.ok(menuFor().some((e) => e.id === "invite"));
  assert.ok(!menuFor({ inside: true }).some((e) => e.id === "invite"));
});
