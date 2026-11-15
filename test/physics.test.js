// Throwing the companion: the ball physics, the hand-velocity estimate and the tap test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepBody, VelocityTracker, isTap, PHYSICS } from "../src/physics.js";

const ball = (pos, vel = {}) => ({ pos: { x: 0, y: 1, z: 0, ...pos }, vel: { x: 0, y: 0, z: 0, ...vel }, radius: 0.18 });
function run(body, env, seconds, dt = 1 / 72) {
  const log = { bounces: 0, maxImpact: 0, resting: false, t: 0 };
  for (; log.t < seconds && !log.resting; log.t += dt) {
    const r = stepBody(body, dt, env);
    if (r.impact) log.bounces++, (log.maxImpact = Math.max(log.maxImpact, r.impact));
    log.resting = r.resting;
  }
  return log;
}

test("a dropped ball bounces lower each time and comes to rest on the floor", () => {
  const b = ball({ y: 1.5 });
  let peak = 0, peaks = [], prevVy = 0;
  for (let t = 0; t < 6; t += 1 / 72) {
    const r = stepBody(b, 1 / 72, {});
    if (prevVy > 0 && b.vel.y <= 0) peaks.push(peak), (peak = 0);
    peak = Math.max(peak, b.pos.y);
    prevVy = b.vel.y;
    assert.ok(b.pos.y >= b.radius - 1e-9, "never below the floor");
    if (r.resting) break;
  }
  assert.ok(peaks.length >= 2, "bounced at least twice");
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1], "each bounce is lower");
  assert.equal(b.pos.y, b.radius);
  assert.deepEqual(b.vel, { x: 0, y: 0, z: 0 });
});

test("a thrown ball follows a parabola before it lands", () => {
  const b = ball({ y: 1.2 }, { x: 2, y: 3 });
  stepBody(b, 0.3, {});
  assert.ok(Math.abs(b.pos.x - 0.6) < 1e-9);
  assert.ok(Math.abs(b.pos.y - (1.2 + 3 * 0.3 - 0.5 * PHYSICS.gravity * 0.09)) < 0.03); // semi-implicit Euler
});

test("a hard throw stays inside the room box and ends at rest", () => {
  const bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3, maxY: 3 };
  const b = ball({ y: 1.4 }, { x: 9, y: 6, z: -7 });
  const log = run(b, { bounds }, 30);
  assert.ok(log.resting, "came to rest");
  assert.ok(log.bounces >= 3);
  assert.ok(Math.abs(b.pos.x) <= 3 && Math.abs(b.pos.z) <= 3 && b.pos.y <= 3);
});

test("it bounces off a window but flies past its edge", () => {
  const rect = { center: { x: 0, y: 1.2, z: -2 }, normal: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, halfW: 0.6, halfH: 0.4 };
  const hit = ball({ y: 1.2 }, { y: 1, z: -6 });
  for (let i = 0; i < 40 && hit.vel.z < 0; i++) stepBody(hit, 1 / 72, { rects: [rect] });
  assert.ok(hit.vel.z > 0, "bounced back");
  assert.ok(hit.pos.z > -2, "stayed in front of the window");

  const miss = ball({ x: 2, y: 1.2 }, { y: 1, z: -6 });
  for (let i = 0; i < 40; i++) stepBody(miss, 1 / 72, { rects: [rect] });
  assert.ok(miss.pos.z < -2.5, "went past");
});

test("a long frame is split up, so a fast ball does not tunnel through the floor or a wall", () => {
  const b = ball({ y: 0.5 }, { x: 12, y: -12 });
  stepBody(b, 0.1, { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });
  assert.ok(b.pos.y >= b.radius && b.pos.x <= 1);
});

test("velocity tracker: the speed of the last few frames, not of the whole hold", () => {
  const v = new VelocityTracker(110);
  assert.deepEqual(v.velocity(), { x: 0, y: 0, z: 0 });
  let t = 0, x = 0;
  for (let i = 0; i < 60; i++) v.push({ x, y: 1, z: 0 }, (t += 14)); // holding still
  for (let i = 0; i < 12; i++) v.push({ x: (x += 0.042), y: 1, z: 0 }, (t += 14)); // then a 3 m/s swing
  const got = v.velocity();
  assert.ok(Math.abs(got.x - 3) < 0.4, `x speed ${got.x}`);
  assert.equal(got.y, 0);
  assert.ok(Math.abs(Math.hypot(...Object.values(v.velocity(2))) - 2) < 1e-9, "clamped");
});

test("tap vs grab", () => {
  assert.ok(isTap(150, 0.01));
  assert.ok(!isTap(150, 0.3), "a quick flick is a throw");
  assert.ok(!isTap(900, 0.01), "holding it is a grab");
});
