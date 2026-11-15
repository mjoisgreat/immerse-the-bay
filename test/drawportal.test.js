// Drawing a window in the air: which strokes count, and where the window goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeStroke, DISTANCE } from "../src/drawportal.js";

const eye = [0, 1.6, 0];
// A rectangle drawn at arm's length (z = -0.5), w x h metres, centred at height y, starting top-left.
function rect(w, h, { y = 1.5, z = -0.5, steps = 15, jitter = 0, close = 0 } = {}) {
  const corners = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2], [-w / 2, h / 2 - close]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, j = () => (Math.random() - 0.5) * jitter;
      pts.push([a[0] + (b[0] - a[0]) * t + j(), y + a[1] + (b[1] - a[1]) * t + j(), z + j()]);
    }
  }
  return pts;
}

test("a drawn square opens a window projected onto the wall, same apparent size", () => {
  const r = analyzeStroke(rect(0.3, 0.3), eye);
  assert.equal(r.ok, true);
  const d = Math.hypot(r.position[0] - eye[0], r.position[1] - eye[1], r.position[2] - eye[2]);
  assert.ok(Math.abs(d - DISTANCE) < 1e-6);
  assert.ok(r.position[2] < -1.5); // pushed out in front of you
  assert.ok(r.scale > 0.4 && r.scale < 1.5, `${r.scale}`);
});

test("a wobbly hand-drawn rectangle still counts", () => {
  assert.equal(analyzeStroke(rect(0.45, 0.28, { jitter: 0.03 }), eye).ok, true);
});

test("an almost-closed square counts; a U shape doesn't", () => {
  assert.equal(analyzeStroke(rect(0.3, 0.3, { close: 0.06 }), eye).ok, true);
  const u = rect(0.3, 0.3).slice(0, 45); // three sides only
  assert.equal(analyzeStroke(u, eye).ok, false);
});

test("bigger drawings make bigger windows", () => {
  assert.ok(analyzeStroke(rect(0.5, 0.3), eye).scale > analyzeStroke(rect(0.25, 0.15), eye).scale);
});

test("tiny doodles, straight swipes and throwing swings don't open windows", () => {
  assert.equal(analyzeStroke(rect(0.06, 0.06), eye).reason, "small");
  const swipe = Array.from({ length: 30 }, (_, i) => [-0.4 + i * 0.03, 1.4 + i * 0.01, -0.5]);
  assert.equal(analyzeStroke(swipe, eye).ok, false);
  const throwArc = Array.from({ length: 20 }, (_, i) => [0.2, 1.0 + i * 0.04, -0.2 - i * 0.04]);
  assert.equal(analyzeStroke(throwArc, eye).ok, false);
  assert.equal(analyzeStroke([[0, 1.5, -0.5]], eye).reason, "short");
});

test("it works facing any direction", () => {
  // Same square drawn to your right (x = +0.5), facing you.
  const pts = rect(0.3, 0.3).map(([x, y, z]) => [0.5 + (z + 0.5), y, x]);
  const r = analyzeStroke(pts, eye);
  assert.equal(r.ok, true);
  assert.ok(r.position[0] > 1.5, `${r.position}`);
});
