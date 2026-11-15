// app/buddy.js: the companion (Bonnie / Pip): replies, physics, follow/call/toggle, aiming and cradle helpers.
import * as THREE from "three";
import { PORTAL_SIZE } from "../portal.js";
import { windowSlot } from "../errand.js";
import { Companion, RobotRig, BunnyRig } from "../companion.js";
import { CameraView } from "../cameraview.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { BUDDY, USE_PIP } from "./config.js";
import { camView } from "./desktop.js";
import { send } from "./room.js";
import { buzz, chime, flash } from "./feedback.js";
import { immersion, openPortal, portals } from "./portals.js";
import { speak } from "./talk.js";
import { tmpMat } from "./xrinput.js";

// ---------- The companion (Bonnie, or Pip the robot with ?companion=pip) ----------
// It hops around your room, follows you, and talks with you. It is the story director's body in
// the room: what it says and does arrives with each direction (see applyDirection).
export const buddy = new Companion(scene, camera, { name: BUDDY.name, rig: USE_PIP ? new RobotRig() : new BunnyRig() });
// Bonnie is always in the room: she appears as soon as she has loaded, and again in front of you when you
// put the headset on. The Bonnie button (and a double tap on a phone) calls her over; nothing sends her away.
buddy
  .load()
  .then(() => placeBuddy({ greet: false }))
  .catch((e) => console.warn("[companion] failed to load", e));
renderer.xr.addEventListener("sessionstart", () => setTimeout(() => buddy.ready && placeBuddy({ greet: false }), 1500));
renderer.xr.addEventListener("sessionend", () => buddy.ready && placeBuddy({ greet: false }));
/** Tells the story director whether its body is in the room, so it knows when it can speak here. */
export function syncBuddy(present = buddy.visible) {
  send({ t: "companion", id: BUDDY.id, present: Boolean(present) });
}
export function buddyIdle() {
  clearTimeout(state.buddyWait);
  buddy.react({ gesture: "none", move: "none" });
  buddy.say("");
}
/** The companion's part of a direction: gesture, maybe move, and say the line out loud. */
export function buddyReply({ reply, gesture, move, emotion }, announce) {
  clearTimeout(state.buddyWait);
  buddy.react({ gesture, move });
  buddy.say(reply, 12000);
  if (announce) flash(`${BUDDY.name}: “${reply}”`, 9000);
  speak(reply, BUDDY.name, emotion ? `${BUDDY.voice}. Right now: ${emotion}` : BUDDY.voice, buddy.root, {
    onStart: () => buddy.speaking(true),
    onEnd: () => buddy.speaking(false),
  });
}

// Grab and throw (src/physics.js): what it bounces off, and how it reacts.
const tmpV = new THREE.Vector3();
export function buddyTouched(ctrl) {
  if (!buddy.visible || !renderer.xr.isPresenting) return false;
  const c = buddy.centerWorld();
  const tip = ctrl.userData.hand?.joints?.["index-finger-tip"];
  return ctrl.getWorldPosition(tmpV).distanceTo(c) < 0.5 || Boolean(tip?.visible && tip.getWorldPosition(tmpV).distanceTo(c) < 0.5);
}
buddy.physicsEnv = () => {
  // A rough room around you (so it can't fly off forever), and the open windows.
  const eye = camera.getWorldPosition(new THREE.Vector3()), c = buddy.centerWorld();
  const R = 4;
  const bounds = {
    minX: Math.min(eye.x - R, c.x - 0.5), maxX: Math.max(eye.x + R, c.x + 0.5),
    minZ: Math.min(eye.z - R, c.z - 0.5), maxZ: Math.max(eye.z + R, c.z + 0.5),
    maxY: Math.max(3, c.y + 0.5),
  };
  const rects = [];
  if (!immersion.inside)
    for (const { portal } of portals.values()) {
      const g = portal.group;
      if (!g.visible) continue;
      const q = g.getWorldQuaternion(new THREE.Quaternion());
      rects.push({
        center: g.getWorldPosition(new THREE.Vector3()),
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        halfW: PORTAL_SIZE.W / 2,
        halfH: PORTAL_SIZE.H / 2,
      });
    }
  return { bounds, rects };
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
buddy.onPhysics = (event, amount) => {
  if (event === "grab") buzz(0.4, 40);
  if (event === "throw" && amount > 1.5) chime("whee"), buddy.say(pick(["Wheeeee!", "I can flyyy!", "Woooah!"]), 2500);
  if (event === "bounce") chime("bounce");
  if (event === "landed" && amount > 1.2) {
    const hard = amount > 4;
    buddy.gesture(hard ? "no" : "jump");
    buddy.say(hard ? pick(["Oof. I'm okay!", "Bunnies bounce. Mostly."]) : pick(["Again! Again!", "Ta-da!", "Nice throw!"]), 3500);
  }
};

/**
 * "Bonnie, go over there and open a window": she walks to the place (relative to where you look) and
 * opens a window just behind her. `open_window` is the world behind it, or "" to ask you which.
 */
// Several windows (asked for at once, or one after another) line up side by side on an arc around
// you, each facing you, and Bonnie stands beside each one as she opens it rather than in front of it.
// See windowSlot (errand.js).
export function buddyOpensWindow({ open_window: world, place, more_windows: more = [] }) {
  const free = state.maxPortals - portals.size;
  if (free <= 0) return buddy.say(`I'm holding all ${state.maxPortals} windows already. Close one first!`, 5000);
  const worlds = [world, ...(Array.isArray(more) ? more : [])].slice(0, free);
  if (worlds.length < 1 + (more?.length || 0)) flash(`Room for ${free} more window${free === 1 ? "" : "s"}: opening ${free}.`, 4000);
  // The arrangement is worked out from where you are and look now, so it stays tidy even if you turn.
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  const l = Math.hypot(f.x, f.z);
  const fwd = l > 1e-3 ? { x: f.x / l, z: f.z / l } : { x: 0, z: -1 };
  const xr = renderer.xr.isPresenting;
  // Further away on a flat screen, so a row of windows fits the view; the gap keeps them from touching.
  const r = xr ? 2.2 : 3.4;
  const gapDeg = (2 * Math.atan((PORTAL_SIZE.W / 2 + 0.2) / r) * 180) / Math.PI;
  const y = Math.min(1.7, Math.max(1.1, eye.y - 0.1));
  const openNext = (i) => {
    if (i >= worlds.length || !buddy.visible || portals.size >= state.maxPortals) return;
    const existing = [...portals.values()].map(({ portal }) => portal.group.position);
    const slot = windowSlot(place, eye, fwd, existing, { r, gapDeg, halfWidth: PORTAL_SIZE.W / 2 });
    buddy.goTo(slot.stand, () => {
      if (!buddy.visible || portals.size >= state.maxPortals) return;
      openPortal(eye, new THREE.Vector3(0, 0, -1), { at: { x: slot.window.x, y, z: slot.window.z }, world: worlds[i] || null });
      const last = i === worlds.length - 1;
      buddy.say(
        !worlds[i] ? "Ta-da! What world should it show?" : worlds.length > 1 ? (last ? "And that's all of them!" : `That's ${i + 1}…`) : "Ta-da! Here's your window.",
        4000,
      );
      if (!last) setTimeout(() => openNext(i + 1), 700);
    });
  };
  openNext(0);
}

// A quick pinch / tap on the companion toggles following you around.
export function toggleBuddyFollow() {
  buddy.setFollowing(!buddy.following);
  buddy.gesture(buddy.following ? "thumbs_up" : "wave");
  buddy.say(buddy.following ? "Lead the way! I'm right beside you." : "Okay, I'll wait here!", 4000);
  flash(
    buddy.following
      ? `${BUDDY.name} is following you. ${renderer.xr.isPresenting ? "Pinch" : CameraView.touch ? "Tap" : "Click"} ${BUDDY.name} again (or say “stay”) to stop.`
      : `${BUDDY.name} will stay here.`,
    5000,
  );
}
/** How far to the side she stands on a flat screen: nearly straight ahead on a narrow (portrait) one, so she's in view. */
function flatSide() {
  return renderer.xr.isPresenting ? 0.4 : innerWidth / innerHeight < 1 ? 0.08 : 0.3;
}
/** Is she on screen (flat screens only; in the headset you just turn your head)? */
export function buddyInView() {
  if (renderer.xr.isPresenting || !buddy.visible) return true;
  const p = buddy.centerWorld(new THREE.Vector3()).project(camera);
  return p.z < 1 && Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.9;
}
/** The Bonnie button, or a phone double-tap on empty space: Bonnie hops back over to you. */
export function callBuddy() {
  if (!buddy.ready) return flash(`${BUDDY.name} is still waking up…`);
  if (!buddy.visible) return placeBuddy();
  buddy.summon(renderer.xr.isPresenting ? 1.4 : 3.0, { side: flatSide() });
  buddy.gesture("wave");
  buddy.say("Coming!", 3000);
}
// (The button used to send her away too; she now always stays.)
export function toggleBuddy() {
  callBuddy();
}
/** Put Bonnie in front of you, sized for the headset or a flat screen. `greet`: say hello and explain her. */
function placeBuddy({ greet = true } = {}) {
  const xr = renderer.xr.isPresenting;
  buddy.range = xr ? [1.2, 2.4] : [2.6, 3.4];
  buddy.comeDistance = xr ? 0.8 : 2.4;
  if (xr) buddy.summon(1.4);
  else {
    // On a flat screen: 3 m away and a slight downward tilt, so it and the windows stay in frame.
    buddy.summon(3.0, { side: flatSide() });
    if (greet && !camView.orienting) {
      state.pitch = Math.min(state.pitch, -0.2);
      camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
    }
  }
  syncBuddy(true);
  buddy.say(`Hi! I'm ${BUDDY.name}. Talk to me any time!`, 6000);
  if (!greet) return;
  const touchUi = !xr && CameraView.touch;
  flash(
    touchUi
      ? `Meet ${BUDDY.name}! Hold 🎙 and say “${BUDDY.name}” to chat. Tap ${BUDDY.name} (or say “follow me”) and ${BUDDY.name} comes with you. Drag to pick ${BUDDY.name} up, let go to throw! Double-tap empty space to call ${BUDDY.name} back.`
      : `Meet ${BUDDY.name}! Say “${BUDDY.name}”, or look at ${BUDDY.name} while you talk, to chat. Pinch, or say “follow me”, and ${BUDDY.name} comes with you. Pinch and hold to pick ${BUDDY.name} up, let go to throw!`,
    9000,
  );
}

// Is any hand / controller aimed at Bonnie right now (so a pinch would catch her)? Drives her glow.
export function aimedAtBuddy() {
  if (!buddy.visible) return false;
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    if (!c.visible || c.userData.grabbed || c.userData.pendingTap) continue;
    tmpMat.identity().extractRotation(c.matrixWorld);
    const ray = new THREE.Ray(c.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, -1).applyMatrix4(tmpMat));
    if (buddyAimed(ray) || buddyTouched(c)) return true;
  }
  return false;
}

// Does a pointing ray pass close to Bonnie? (A near miss still grabs her: she's small and moves.)
export function buddyAimed(ray) {
  if (!buddy.visible || !buddy.ready) return false;
  const c = buddy.centerWorld();
  const along = c.clone().sub(ray.origin).dot(ray.direction);
  if (along < 0 || along > 6) return false;
  const miss = ray.distanceToPoint(c);
  return miss < Math.max(0.25, along * Math.tan(THREE.MathUtils.degToRad(9))); // 25 cm, or 9° far away
}

// Two-hand pick-up of Bonnie: she rides on a point midway between your hands, kept upright.
export const cradle = { obj: new THREE.Object3D(), hands: null };
scene.add(cradle.obj);
export function updateCradle() {
  if (!cradle.hands) return;
  const [a, b] = cradle.hands.map((c) => c.getWorldPosition(new THREE.Vector3()));
  cradle.obj.position.copy(a.add(b).multiplyScalar(0.5));
  cradle.obj.updateMatrixWorld(true);
}
export function nearBuddy(ctrl, r) {
  return buddy.visible && ctrl.getWorldPosition(tmpV).distanceTo(buddy.centerWorld()) < r;
}
