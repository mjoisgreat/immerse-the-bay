// Phone touch gestures: tap vs double tap, hold, flick, pinch, two-finger tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TouchGestureRecognizer, HOLD_MS, DOUBLE_MS } from "../src/touchgestures.js";

function rig(extra = {}) {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const log = [];
  const rec = (name) => (...a) => (log.push([name, ...a]), extra[name]?.(...a));
  const handlers = Object.fromEntries(
    ["onTap", "onDoubleTap", "onHoldStart", "onHoldMove", "onHoldEnd", "onFlick", "onPinchStart", "onPinch", "onPinchEnd", "onTwoFingerTap"].map((n) => [n, rec(n)]),
  );
  if (extra.claims) handlers.claims = extra.claims;
  const g = new TouchGestureRecognizer(handlers, {
    now: () => now,
    setTimer: (fn, ms) => (timers.set(nextId, { fn, at: now + ms }), nextId++),
    clearTimer: (id) => timers.delete(id),
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) (timers.delete(id), t.fn());
  };
  const ev = (type, id, x, y) => ({ type, pointerId: id, clientX: x, clientY: y, pointerType: "touch" });
  return {
    g, log, advance,
    down: (id, x, y) => g.down(ev("pointerdown", id, x, y)),
    move: (id, x, y) => g.move(ev("pointermove", id, x, y)),
    up: (id, x, y) => g.up(ev("pointerup", id, x, y)),
    names: () => log.map((l) => l[0]),
  };
}

test("a single tap fires after the double-tap window, not before", () => {
  const r = rig();
  r.down(1, 100, 100);
  r.advance(80);
  r.up(1, 101, 100);
  assert.deepEqual(r.names(), []);
  r.advance(DOUBLE_MS);
  assert.deepEqual(r.names(), ["onTap"]);
});

test("two quick taps are one double tap and no single taps", () => {
  const r = rig();
  r.down(1, 100, 100), r.advance(60), r.up(1, 100, 100);
  r.advance(120);
  r.down(2, 104, 102), r.advance(60), r.up(2, 104, 102);
  r.advance(DOUBLE_MS * 2);
  assert.deepEqual(r.names(), ["onDoubleTap"]);
});

test("press and hold starts a hold; moving then reports moves and the end", () => {
  const r = rig();
  r.down(1, 50, 50);
  r.advance(HOLD_MS + 10);
  assert.ok(r.g.busy);
  r.move(1, 80, 60);
  r.up(1, 80, 60);
  assert.deepEqual(r.names(), ["onHoldStart", "onHoldMove", "onHoldEnd"]);
  assert.ok(!r.g.busy);
});

test("a hold the page declines stays an ordinary drag", () => {
  const r = rig({ onHoldStart: () => false });
  r.down(1, 50, 50);
  r.advance(HOLD_MS + 10);
  assert.ok(!r.g.busy);
  r.move(1, 200, 50);
  r.up(1, 200, 50);
  r.advance(DOUBLE_MS * 2);
  assert.deepEqual(r.names(), ["onHoldStart"]); // no hold moves, no tap (it moved)
});

test("moving before the hold time is a look-around drag: no hold, no tap", () => {
  const r = rig();
  r.down(1, 50, 50);
  r.advance(100);
  r.move(1, 120, 50);
  r.advance(HOLD_MS);
  r.up(1, 120, 50);
  r.advance(DOUBLE_MS * 2);
  assert.deepEqual(r.names(), []);
});

test("a fast flick up is a flick", () => {
  const r = rig();
  r.down(1, 100, 400);
  r.advance(150);
  r.up(1, 110, 250);
  assert.deepEqual(r.log[0], ["onFlick", "up", 100, 400]);
});

test("two fingers apart is a pinch with a growing ratio", () => {
  const r = rig();
  r.down(1, 100, 100), r.down(2, 200, 100);
  r.move(2, 300, 100);
  r.up(1, 100, 100), r.up(2, 300, 100);
  assert.deepEqual(r.names(), ["onPinchStart", "onPinch", "onPinchEnd"]);
  assert.equal(r.log.at(-1)[1], 2);
});

test("two fingers down and up without moving is a two-finger tap", () => {
  const r = rig();
  r.down(1, 100, 100), r.down(2, 200, 100);
  r.advance(120);
  r.up(1, 100, 100), r.up(2, 200, 100);
  r.advance(DOUBLE_MS * 2);
  assert.deepEqual(r.names(), ["onPinchStart", "onTwoFingerTap"]);
});

test("a finger the page claims (Bonnie) is left alone", () => {
  const r = rig({ claims: () => true });
  r.down(1, 100, 100);
  r.advance(HOLD_MS * 2);
  r.up(1, 100, 100);
  r.advance(DOUBLE_MS * 2);
  assert.deepEqual(r.names(), []);
});

test("mouse input is ignored", () => {
  const r = rig();
  r.g.down({ type: "pointerdown", pointerId: 9, clientX: 1, clientY: 1, pointerType: "mouse" });
  r.advance(HOLD_MS * 2);
  assert.deepEqual(r.names(), []);
});
