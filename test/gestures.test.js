// Hand gesture detection on simulated joint positions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestureDetector } from "../src/gestures.js";

const head = { pos: [0, 1.6, 0], up: [0, 1, 0], fwd: [0, 0, -1] };
const down = [0, -1, 0];
const rest = { left: { palm: [-0.25, 1.0, -0.2], palmNormal: down }, right: { palm: [0.25, 1.0, -0.2], palmNormal: down } };

function run(steps) {
  const d = new GestureDetector();
  let t = 0;
  const out = [];
  for (const [n, hands] of steps) for (let i = 0; i < n; i++) out.push(...d.update({ now: (t += 16), head, hands }));
  return out;
}
const atMouth = { ...rest, right: { palm: [0.02, 1.53, -0.05], palmNormal: [-1, 0, 0] } };
const lHand = (x) => ({ palm: [-x, 1.2, -0.35], palmNormal: [1, 0, 0] });
const rHand = (x) => ({ palm: [x, 1.2, -0.35], palmNormal: [-1, 0, 0] });
const leftPalmUp = { left: { palm: [-0.05, 1.45, -0.35], palmNormal: [0.05, 0.4, 0.9] } };

test("hand to mouth talks, lowering it sends", () => {
  assert.deepEqual(run([[10, rest], [30, atMouth], [10, rest]]), ["talk-start", "talk-end"]);
});
test("a quick brush past the mouth is ignored", () => {
  assert.deepEqual(run([[5, rest], [6, atMouth], [5, rest]]), []);
});
// Two-hand motions, frame by frame: sep(t) is the gap between the palms, shift(t) moves both sideways.
const both = (sep, shift = 0) => ({ left: lHand(sep / 2 - shift), right: rHand(sep / 2 + shift) });
const motion = (frames, f) => Array.from({ length: frames }, (_, i) => [1, f(i * 0.016)]);
const ramp = (from, to, frames) => motion(frames, (t) => both(from + ((to - from) * t) / (frames * 0.016)));
const wave = (t) => 0.1 * Math.sin(2 * Math.PI * 3 * t); // 3 Hz, 10 cm either way

test("parting the hands like curtains opens, once", () => {
  assert.deepEqual(run([[10, both(0.12)], ...ramp(0.12, 0.6, 15), [60, both(0.6)]]), ["open"]);
});
test("bringing the hands back together closes", () => {
  assert.deepEqual(run([[10, both(0.6)], ...ramp(0.6, 0.12, 15), [60, both(0.12)]]), ["close"]);
});
test("the return stroke right after opening is swallowed by the cooldown", () => {
  assert.deepEqual(run([[10, both(0.12)], ...ramp(0.12, 0.6, 15), [25, both(0.6)], ...ramp(0.6, 0.12, 15), [30, both(0.12)]]), ["open"]);
});
test("slowly drifting apart is not an opening motion", () => {
  assert.deepEqual(run([[10, both(0.12)], ...ramp(0.12, 0.6, 120), [60, both(0.6)]]), []);
});
test("hands held still, together or apart, do nothing", () => {
  assert.deepEqual(run([[120, both(0.05)]]), []);
  assert.deepEqual(run([[120, both(0.6)]]), []);
});
test("shaking both hands side by side fires one shake", () => {
  assert.deepEqual(run(motion(80, (t) => both(0.3, wave(t)))), ["shake"]);
});
test("a mirrored wipe (hands swinging in and out) is a shake, never an open or close", () => {
  assert.deepEqual(run(motion(80, (t) => both(0.33 + 2 * wave(t)))), ["shake"]);
});
test("shaking your head with your hands held up is not a shake", () => {
  const d = new GestureDetector();
  const out = [];
  for (let i = 0; i < 150; i++) {
    const yaw = 0.35 * Math.sin(2 * Math.PI * 2 * i * 0.016);
    out.push(...d.update({ now: i * 16, head: { ...head, fwd: [Math.sin(yaw), 0, -Math.cos(yaw)] }, hands: both(0.3) }));
  }
  assert.deepEqual(out, []);
});
test("one hand pulling away from a still one (dragging a window) is not an opening motion", () => {
  assert.deepEqual(run([[10, both(0.12)], ...motion(15, (t) => ({ left: lHand(0.06), right: rHand(0.06 + 2 * t) })), [60, { left: lHand(0.06), right: rHand(0.54) }]]), []);
});
// Snap: thumb and middle fingertip touch, then spring apart. gap(t) = distance between the fingertips.
const fingers = (gap) => ({ ...rest, right: { ...rest.right, thumb: [0.25, 1.0, -0.2], middle: [0.25 + gap, 1.0, -0.2] } });
test("a snap (fingertips touch, then flick apart fast) calls once", () => {
  assert.deepEqual(run([[10, fingers(0.08)], [4, fingers(0.01)], [1, fingers(0.06)], [20, fingers(0.09)]]), ["snap"]);
});
test("works with the left hand too", () => {
  const l = (gap) => ({ ...rest, left: { ...rest.left, thumb: [-0.25, 1.0, -0.2], middle: [-0.25 - gap, 1.0, -0.2] } });
  assert.deepEqual(run([[10, l(0.08)], [4, l(0.01)], [1, l(0.06)], [20, l(0.09)]]), ["snap"]);
});
test("letting go of a pinch slowly is not a snap", () => {
  const slow = Array.from({ length: 40 }, (_, i) => [1, fingers(0.01 + i * 0.002)]); // ~0.6 s to open
  assert.deepEqual(run([[10, fingers(0.08)], [4, fingers(0.01)], ...slow]), []);
});
test("fingers that never touch, or touch for a single frame, do not snap", () => {
  assert.deepEqual(run([[10, fingers(0.08)], [10, fingers(0.04)], [10, fingers(0.09)]]), []);
  assert.deepEqual(run([[10, fingers(0.08)], [1, fingers(0.01)], [1, fingers(0.07)], [10, fingers(0.09)]]), []);
});
test("snapping twice in a row is one call (cooldown); a later snap works again", () => {
  const one = [[4, fingers(0.01)], [1, fingers(0.06)], [8, fingers(0.09)]];
  assert.deepEqual(run([[5, fingers(0.08)], ...one, ...one]), ["snap"]);
  assert.deepEqual(run([[5, fingers(0.08)], ...one, [120, fingers(0.09)], ...one]), ["snap", "snap"]);
});
test("hands without fingertip data never snap", () => {
  assert.deepEqual(run([[40, rest]]), []);
});

test("losing the talking hand keeps listening, then sends; a half-made motion is dropped after a gap", () => {
  assert.deepEqual(run([[30, atMouth], [60, { left: rest.left }], [30, atMouth], [200, {}]]), ["talk-start", "talk-end"]);
  const d = new GestureDetector();
  const out = [];
  let t = 0;
  for (const [, hands] of [[10, both(0.12)], ...ramp(0.12, 0.6, 15)]) out.push(...d.update({ now: (t += 16), head, hands }));
  out.push(...d.update({ now: t + 10000, head, hands: both(0.6) }), ...d.update({ now: t + 10400, head, hands: both(0.6) }));
  assert.deepEqual(out, []);
});
test("shaking only one hand is ignored", () => {
  assert.deepEqual(run(motion(120, (t) => ({ left: lHand(0.15), right: rHand(0.15 + wave(t)) }))), []);
});
test("two-hand gestures are off while talking", () => {
  assert.deepEqual(run([[30, atMouth], ...motion(80, (t) => ({ left: lHand(0.15 + wave(t)), right: atMouth.right }))]), ["talk-start"]);
});
test("left palm toggles once per raise", () => {
  assert.deepEqual(run([[5, rest], [80, leftPalmUp], [5, rest], [50, leftPalmUp]]), ["palm", "palm"]);
});
test("right palm is ignored", () => {
  assert.deepEqual(run([[60, { right: { palm: [0.05, 1.45, -0.35], palmNormal: [-0.05, 0.4, 0.9] } }]]), []);
});
