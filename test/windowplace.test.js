// The window is solid: off the floor, under the ceiling, not in your face.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWindow, heightRange, minDistance, MAX_TOP } from "../src/windowplace.js";

const eye = [0, 1.6, 0];

test("a good spot is left exactly where it was", () => {
  assert.deepEqual(resolveWindow([0, 1.5, -1.8], 1, eye), [0, 1.5, -1.8]);
});

test("a window too low is lifted so it does not sit in the floor", () => {
  const p = resolveWindow([0, 0.1, -2], 1, eye);
  assert.ok(p[1] >= heightRange(1)[0] - 1e-9);
});

test("a window too high is lowered under the ceiling", () => {
  const p = resolveWindow([0, 5, -2], 1, eye);
  assert.ok(p[1] + 0.45 <= MAX_TOP + 1e-9);
});

test("a window too close to the viewer is pushed away, along the line from you", () => {
  const p = resolveWindow([0.2, 1.5, -0.3], 1, eye);
  assert.ok(Math.hypot(p[0], p[2]) >= minDistance(1) - 1e-9);
  assert.ok(p[0] > 0 && p[2] < 0); // same direction as before
});

test("bigger windows keep further back", () => {
  assert.ok(minDistance(2) > minDistance(1));
});

test("a window dead on top of you goes straight ahead", () => {
  const p = resolveWindow([0, 1.5, 0], 1, eye);
  assert.ok(p[2] < 0 && Math.abs(p[0]) < 1e-9);
});
