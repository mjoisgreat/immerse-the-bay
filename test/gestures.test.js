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
// There is no snap gesture any more: a thumb-and-middle-finger flick does nothing.
test("snapping your fingers does nothing", () => {
  const fingers = (gap) => ({ ...rest, right: { ...rest.right, thumb: [0.25, 1.0, -0.2], middle: [0.25 + gap, 1.0, -0.2] } });
  assert.deepEqual(run([[10, fingers(0.08)], [4, fingers(0.01)], [1, fingers(0.06)], [20, fingers(0.09)]]), []);
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

// Thumbs up: a hand-sized fist (wrist → middle knuckle 9 cm) with the thumb pointing up, or not.
const fist = (pose = "up", base = [0.25, 1.2, -0.35]) => {
  const [x, y, z] = base;
  const tipsCurled = [[x + 0.03, y + 0.04, z - 0.05], [x + 0.01, y + 0.04, z - 0.055], [x - 0.01, y + 0.035, z - 0.05], [x - 0.03, y + 0.03, z - 0.045]];
  const tipsOpen = [[x + 0.03, y + 0.17, z], [x + 0.01, y + 0.18, z], [x - 0.01, y + 0.17, z], [x - 0.03, y + 0.15, z]];
  const th = {
    up: { thumbBase: [x + 0.04, y + 0.05, z - 0.03], thumbTip: [x + 0.045, y + 0.12, z - 0.03] },
    side: { thumbBase: [x + 0.04, y + 0.05, z - 0.03], thumbTip: [x + 0.11, y + 0.055, z - 0.03] },
    down: { thumbBase: [x + 0.04, y + 0.03, z - 0.03], thumbTip: [x + 0.045, y - 0.04, z - 0.03] },
  }[pose === "open" ? "up" : pose];
  return { palm: [x, y + 0.03, z], palmNormal: [-1, 0, 0], fingers: { wrist: [x, y - 0.03, z], knuckle: [x, y + 0.06, z - 0.01], ...th, tips: pose === "open" ? tipsOpen : tipsCurled } };
};
const thumbsUp = { ...rest, right: fist("up") };
test("isThumbsUp: a fist with the thumb up, and not a thumb sideways, down or an open hand", async () => {
  const { isThumbsUp } = await import("../src/gestures.js");
  assert.equal(isThumbsUp(fist("up").fingers), true);
  assert.equal(isThumbsUp(fist("side").fingers), false);
  assert.equal(isThumbsUp(fist("down").fingers), false);
  assert.equal(isThumbsUp(fist("open").fingers), false);
  assert.equal(isThumbsUp(undefined), false);
});
test("thumbs up starts a hands-free talk; lowering the hand keeps it; thumbs up again sends", () => {
  assert.deepEqual(run([[10, rest], [30, thumbsUp], [60, rest], [30, thumbsUp], [10, rest]]), ["talk-start", "talk-end"]);
});
test("holding the thumbs up doesn't toggle it on and off", () => {
  assert.deepEqual(run([[10, rest], [200, thumbsUp]]), ["talk-start"]);
});
test("a thumbs up flashed for a moment is ignored", () => {
  assert.deepEqual(run([[10, rest], [8, thumbsUp], [30, rest]]), []);
});
test("a thumbs up while talking into your hand doesn't end that talk", () => {
  assert.deepEqual(run([[10, rest], [30, atMouth], [30, { ...atMouth, left: fist("up", [-0.25, 1.2, -0.35]) }]]), ["talk-start"]);
});
test("a hands-free talk sends by itself after a minute", () => {
  const out = run([[10, rest], [30, thumbsUp], [3900, rest]]); // ~63 s
  assert.deepEqual(out, ["talk-start", "talk-end"]);
});

// Holding your hand at your mouth like a microphone is a fist with the thumb up.
const micFist = { ...rest, right: fist("up", [0.02, 1.5, -0.05]) };
test("a thumb-up fist at the mouth is a normal talk: lowering it sends", () => {
  assert.deepEqual(run([[10, rest], [60, micFist], [10, rest]]), ["talk-start", "talk-end"]);
});
test("a thumbs up read on the way to the mouth still ends when the hand is lowered", () => {
  assert.deepEqual(run([[10, rest], [30, thumbsUp], [60, micFist], [10, rest]]), ["talk-start", "talk-mouth", "talk-end"]);
});
