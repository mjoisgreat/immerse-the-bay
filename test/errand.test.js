import { test } from "node:test";
import assert from "node:assert/strict";
import { spotFor, windowSpot } from "../src/errand.js";

const eye = { x: 1, z: 2 };
const fwd = { x: 0, z: -1 }; // looking down -z, like the default headset pose
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("ahead / behind / left / right are relative to where you look", () => {
  const ahead = spotFor("ahead", eye, fwd, 2);
  near(ahead.x, 1), near(ahead.z, 0);
  const behind = spotFor("behind", eye, fwd, 2);
  near(behind.x, 1), near(behind.z, 4);
  const left = spotFor("left", eye, fwd, 2); // looking down -z, left is -x
  near(left.x, -1), near(left.z, 2);
  const right = spotFor("right", eye, fwd, 2);
  near(right.x, 3), near(right.z, 2);
});
test("turning your head turns the places with it", () => {
  const east = { x: 1, z: 0 };
  const ahead = spotFor("ahead", eye, east, 2);
  near(ahead.x, 3), near(ahead.z, 2);
  const left = spotFor("left", eye, east, 2); // facing +x, left is -z
  near(left.x, 1), near(left.z, 0);
});
test("'here' is close, ahead and to the left", () => {
  const s = spotFor("here", eye, fwd);
  assert.ok(Math.hypot(s.x - eye.x, s.z - eye.z) <= 1.5 + 1e-9);
  assert.ok(s.z < eye.z && s.x < eye.x);
  assert.deepEqual(spotFor("nonsense", eye, fwd), s);
});
test("the window stands just behind her, away from you, at the height given", () => {
  const spot = { x: 1, z: 0 }; // straight ahead of `eye`
  const w = windowSpot(spot, eye, 1.3, 0.7);
  near(w.x, 1), near(w.z, -0.7), assert.equal(w.y, 1.3);
  assert.deepEqual(windowSpot(eye, eye, 1.4), { x: eye.x, y: 1.4, z: eye.z }); // standing on you: no division by zero
});

import { windowSlot } from "../src/errand.js";
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
test("windowSlot: the first window goes where asked, straight ahead for 'here'", () => {
  const s = windowSlot("here", eye, fwd, [], { r: 2.2 });
  near(s.angle, 0);
  near(s.window.x, 1), near(s.window.z, 2 - 2.2);
});
test("windowSlot: more windows line up side by side, never on top of each other", () => {
  const placed = [];
  for (let i = 0; i < 3; i++) placed.push(windowSlot("here", eye, fwd, placed, { r: 2.2, gapDeg: 46 }).window);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) assert.ok(dist(placed[i], placed[j]) > 1.6, "windows overlap");
  // The second and third are either side of the first.
  assert.ok(placed[1].x !== placed[2].x);
});
test("windowSlot: a side request goes to that side, and the next one on that side moves toward the front", () => {
  const a = windowSlot("left", eye, fwd, [], { r: 2.2 });
  assert.ok(a.window.x < eye.x); // looking down -z, left is -x
  const b = windowSlot("left", eye, fwd, [a.window], { r: 2.2, gapDeg: 46 });
  assert.ok(b.angle < a.angle && b.angle > -1, `${b.angle}`);
});
test("windowSlot: Bonnie stands beside the window, not in front of it", () => {
  const s = windowSlot("here", eye, fwd, [], { r: 2.2, halfWidth: 0.8 });
  // Off to the side of the window's centre by more than half its width, and nearer to you than the window.
  const toWin = { x: s.window.x - eye.x, z: s.window.z - eye.z };
  const l = Math.hypot(toWin.x, toWin.z);
  const sideways = Math.abs(((s.stand.x - s.window.x) * -toWin.z + (s.stand.z - s.window.z) * toWin.x) / l);
  assert.ok(sideways > 0.8, `sideways ${sideways}`);
  assert.ok(dist(s.stand, eye) < dist(s.window, eye));
});
