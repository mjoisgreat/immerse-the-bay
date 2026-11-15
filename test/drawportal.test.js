// Drawing a window in the air (a circle, at least two rounds): which strokes count, and where the window goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeStroke, DISTANCE, MIN_ROUNDS } from "../src/drawportal.js";

const eye = [0, 1.6, 0];
// A circle of the given radius drawn at arm's length (z = -0.5) at height y, `rounds` turns, `steps` points per turn.
function circle(r, { rounds = 2, y = 1.5, z = -0.5, steps = 24, jitter = 0, clockwise = true, drift = 0 } = {}) {
  const pts = [];
  const total = Math.round(rounds * steps);
  for (let i = 0; i <= total; i++) {
    const a = (i / steps) * 2 * Math.PI * (clockwise ? -1 : 1);
    const rr = r * (1 + drift * (i / total)), j = () => (Math.random() - 0.5) * jitter;
    pts.push([rr * Math.cos(a) + j(), y + rr * Math.sin(a) + j(), z + j()]);
  }
  return pts;
}

test("two rounds of a circle open a window projected onto the wall, same apparent size", () => {
  const r = analyzeStroke(circle(0.15), eye);
  assert.equal(r.ok, true);
  const d = Math.hypot(r.position[0] - eye[0], r.position[1] - eye[1], r.position[2] - eye[2]);
  assert.ok(Math.abs(d - DISTANCE) < 1e-6);
  assert.ok(r.position[2] < -1.5); // pushed out in front of you
  assert.ok(r.scale > 0.4 && r.scale < 1.5, `${r.scale}`);
  assert.ok(r.rounds >= MIN_ROUNDS - 0.01);
});

test("one round is not enough; it must be two", () => {
  assert.equal(analyzeStroke(circle(0.15, { rounds: 1 }), eye).reason, "rounds");
  assert.equal(analyzeStroke(circle(0.15, { rounds: 1.5 }), eye).reason, "rounds");
  assert.equal(analyzeStroke(circle(0.15, { rounds: 2 }), eye).ok, true);
  assert.equal(analyzeStroke(circle(0.15, { rounds: 3 }), eye).ok, true);
});

test("either direction, and a wobbly spiral-ish hand-drawn circle still count", () => {
  assert.equal(analyzeStroke(circle(0.15, { clockwise: false }), eye).ok, true);
  assert.equal(analyzeStroke(circle(0.15, { jitter: 0.015, drift: 0.2 }), eye).ok, true);
});

test("bigger circles make bigger windows", () => {
  assert.ok(analyzeStroke(circle(0.25), eye).scale > analyzeStroke(circle(0.12), eye).scale);
});

test("tiny doodles, squares, straight swipes and throwing swings don't open windows", () => {
  assert.equal(analyzeStroke(circle(0.04), eye).reason, "small");
  // A square traced twice is not round enough.
  const sq = [];
  for (let k = 0; k < 2; k++) for (const [x, y] of [[-0.15, 0.15], [0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) for (let s = 0; s < 6; s++) sq.push([x, 1.5 + y, -0.5]);
  assert.equal(analyzeStroke(sq, eye).ok, false);
  const swipe = Array.from({ length: 30 }, (_, i) => [-0.4 + i * 0.03, 1.4 + i * 0.01, -0.5]);
  assert.equal(analyzeStroke(swipe, eye).ok, false);
  const throwArc = Array.from({ length: 30 }, (_, i) => [0.2, 1.0 + i * 0.04, -0.2 - i * 0.04]);
  assert.equal(analyzeStroke(throwArc, eye).ok, false);
  assert.equal(analyzeStroke([[0, 1.5, -0.5]], eye).reason, "short");
});

test("it works facing any direction", () => {
  // The same circle drawn to your right (x = +0.5), facing you.
  const pts = circle(0.15).map(([x, y, z]) => [0.5 + (z + 0.5), y, x]);
  const r = analyzeStroke(pts, eye);
  assert.equal(r.ok, true);
  assert.ok(r.position[0] > 1.5, `${r.position}`);
});
