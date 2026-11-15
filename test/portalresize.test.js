import { test } from "node:test";
import assert from "node:assert/strict";
import { resizedScale, MIN_SCALE, MAX_SCALE } from "../src/portalresize.js";

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
