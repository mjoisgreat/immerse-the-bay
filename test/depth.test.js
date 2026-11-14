// Depth post-processing: percentiles, range smoothing, encoding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { percentileRange, RangeTracker, encodeDepth } from "../src/depthmath.js";

test("percentile range ignores outliers", () => {
  const v = new Float32Array(1000).map((_, i) => i / 999);
  v[0] = -1000; v[999] = 1000;
  const { min, max } = percentileRange(v);
  assert.ok(min > 0 && min < 0.05);
  assert.ok(max < 1 && max > 0.95);
});
test("percentile range of constant data is that value", () => {
  assert.deepEqual(percentileRange(new Float32Array(50).fill(3)), { min: 3, max: 3 });
});
test("range tracker snaps first, then smooths, then resets", () => {
  const t = new RangeTracker();
  assert.deepEqual(t.update(0, 10), { min: 0, max: 10 });
  const r = t.update(10, 20, 0.5);
  assert.deepEqual(r, { min: 5, max: 15 });
  t.reset();
  assert.deepEqual(t.update(2, 4), { min: 2, max: 4 });
});
test("encode normalises, clamps and treats larger as nearer", () => {
  const out = encodeDepth(new Float32Array([-5, 0, 5, 10, 99]), 5, 1, { min: 0, max: 10 }, null, new Uint8Array(5));
  assert.deepEqual([...out], [0, 0, 128, 255, 255]);
});
test("encode flips rows vertically", () => {
  const raw = new Float32Array([0, 0, 10, 10]); // top row far, bottom row near
  const out = encodeDepth(raw, 2, 2, { min: 0, max: 10 }, null, new Uint8Array(4));
  assert.deepEqual([...out], [255, 255, 0, 0]);
});
test("encode blends with the previous frame", () => {
  const out = encodeDepth(new Float32Array([10]), 1, 1, { min: 0, max: 10 }, new Uint8Array([0]), new Uint8Array(1), 0.5);
  assert.equal(out[0], 128);
});
test("encode survives a degenerate range", () => {
  const out = encodeDepth(new Float32Array([3, 3]), 2, 1, { min: 3, max: 3 }, null, new Uint8Array(2));
  assert.deepEqual([...out], [0, 0]);
});
