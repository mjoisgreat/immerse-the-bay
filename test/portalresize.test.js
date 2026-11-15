import { test } from "node:test";
import assert from "node:assert/strict";
import { resizedScale, carriedPosition, MIN_SCALE, MAX_SCALE } from "../src/portalresize.js";

test("a window held with both hands moves with the midpoint of the hands", () => {
  const near = (got, want) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${got} vs ${want}`));
  near(carriedPosition([1, 1.5, -2], [0, 1.2, -0.5], [0.3, 1.0, -0.8]), [1.3, 1.3, -2.3]);
  near(carriedPosition([1, 1.5, -2], [0, 1.2, -0.5], [0, 1.2, -0.5]), [1, 1.5, -2]);
});

test("hands twice as far apart make the window twice as big", () => {
  assert.equal(resizedScale(1, 0.3, 0.6), 2);
  assert.equal(resizedScale(1.5, 0.4, 0.2), 0.75);
});
test("hands unchanged leave the size alone", () => {
  assert.equal(resizedScale(1.2, 0.35, 0.35), 1.2);
});
test("size is clamped", () => {
  assert.equal(resizedScale(1, 0.3, 3), MAX_SCALE);
  assert.equal(resizedScale(1, 0.3, 0.01), MIN_SCALE);
});
test("a degenerate start distance or lost tracking keeps the current size", () => {
  assert.equal(resizedScale(1.3, 0, 0.5), 1.3);
  assert.equal(resizedScale(1.3, 0.3, NaN), 1.3);
});
