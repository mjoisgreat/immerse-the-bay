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
