import { test } from "node:test";
import assert from "node:assert/strict";
import { menuFor } from "../src/toolbar.js";

const ids = (list) => list.map((e) => e.id);
const entry = (list, id) => list.find((e) => e.id === id);

test("in your room the menu offers reset, Stanford, Moon, the cheat sheet and exit VR", () => {
  const list = menuFor();
  assert.deepEqual(ids(list), ["reset", "stanford", "moon", "wide", "share", "invite", "cheat", "exitvr"]);
  assert.equal(entry(list, "stanford").label, "Stanford");
  assert.equal(entry(list, "moon").label, "Moon");
});

test("in Stanford the menu says exit Stanford and can still go to the Moon", () => {
  const list = menuFor({ world: "stanford" });
  assert.deepEqual(ids(list), ["reset", "exit-stanford", "moon", "wide", "share", "invite", "cheat", "exitvr"]);
  assert.equal(entry(list, "exit-stanford").label, "Exit Stanford");
});

test("on the Moon the menu says exit Moon and can still go to Stanford", () => {
  const list = menuFor({ world: "moon" });
  assert.deepEqual(ids(list), ["reset", "stanford", "exit-moon", "wide", "share", "invite", "cheat", "exitvr"]);
  assert.equal(entry(list, "exit-moon").label, "Exit Moon");
});

test("inside a window the menu offers exit window, reset, the cheat sheet and exit VR", () => {
  assert.deepEqual(ids(menuFor({ inside: true })), ["exitwin", "reset", "cheat", "exitvr"]);
  assert.deepEqual(ids(menuFor({ inside: true, world: "stanford" })), ["exitwin", "reset", "cheat", "exitvr"]);
});

test("reset asks for a second tap, and says so", () => {
  const armed = entry(menuFor({ armed: "reset" }), "reset");
  assert.equal(armed.label, "Tap to confirm");
  assert.equal(armed.state, "warn");
  assert.equal(entry(menuFor(), "reset").label, "Reset");
});

test("a world entry glows while a world loads", () => {
  assert.equal(entry(menuFor({ loading: true }), "stanford").state, "active");
  assert.equal(entry(menuFor({ loading: true }), "moon").state, "active");
});

test("share to community: an entry that says whether the story is shared", () => {
  assert.equal(entry(menuFor(), "share").label, "Share story");
  const on = entry(menuFor({ shared: true }), "share");
  assert.equal(on.label, "Shared: on");
  assert.equal(on.state, "active");
});
