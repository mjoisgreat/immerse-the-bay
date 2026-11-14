// Moving around a 3D world: the physical-room -> world transform must behave.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Locomotion } from "../src/locomotion.js";

// A fake headset: the head stands at a physical spot; its world position is loco.m applied to it.
function rig(head = new THREE.Vector3(0.5, 1.6, -0.3)) {
  const camera = { getWorldPosition: (v) => v.copy(head).applyMatrix4(loco.m), getWorldQuaternion: (q) => q.identity() };
  const renderer = { xr: { getReferenceSpace: () => null, setReferenceSpace() {}, getSession: () => null } };
  const loco = new Locomotion(renderer, camera, new THREE.Scene());
  return { loco, camera };
}
const near = (a, b) => assert.ok(a.distanceTo(b) < 1e-6, `${a.toArray()} vs ${b.toArray()}`);

test("teleport puts your head right above the target", () => {
  const { loco, camera } = rig();
  loco.teleport(new THREE.Vector3(5, 0, -8));
  const h = camera.getWorldPosition(new THREE.Vector3());
  near(new THREE.Vector3(h.x, 0, h.z), new THREE.Vector3(5, 0, -8));
});

test("snap turning rotates around your head without moving you", () => {
  const { loco, camera } = rig();
  loco.teleport(new THREE.Vector3(3, 0, 2));
  const before = camera.getWorldPosition(new THREE.Vector3());
  loco.turn(Math.PI / 6);
  loco.turn(Math.PI / 6);
  near(camera.getWorldPosition(new THREE.Vector3()), before);
});

test("reset puts you back in your real room", () => {
  const { loco, camera } = rig();
  loco.teleport(new THREE.Vector3(7, 0, 7));
  loco.turn(1);
  loco.reset();
  near(camera.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.5, 1.6, -0.3));
  assert.equal(loco.moved, false);
});

test("only rays pointing down at nearby floor count as teleports", () => {
  const { loco } = rig();
  const ray = (o, d) => new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
  assert.ok(loco.floorHit(ray([0, 1.2, 0], [0, -1, -1])));
  assert.equal(loco.floorHit(ray([0, 1.2, 0], [0, 0, -1])), null); // straight ahead: opens a window instead
  assert.equal(loco.floorHit(ray([0, 1.2, 0], [0, -0.05, -1])), null); // too far away
});
