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
test("a fast clap fires once", () => {
  assert.deepEqual(run([[5, { left: lHand(0.2), right: rHand(0.2) }], [3, { left: lHand(0.08), right: rHand(0.08) }], [5, { left: lHand(0.03), right: rHand(0.03) }]]), ["clap"]);
});
test("hands resting together don't clap", () => {
  assert.deepEqual(run([[60, { left: lHand(0.03), right: rHand(0.03) }]]), []);
});
test("left palm toggles once per raise", () => {
  assert.deepEqual(run([[5, rest], [80, leftPalmUp], [5, rest], [50, leftPalmUp]]), ["palm", "palm"]);
});
test("right palm is ignored", () => {
  assert.deepEqual(run([[60, { right: { palm: [0.05, 1.45, -0.35], palmNormal: [-0.05, 0.4, 0.9] } }]]), []);
});
