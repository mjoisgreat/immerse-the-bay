// app/buddy.js: the companion (Bonnie / Pip): replies, physics, follow/call/toggle, aiming and cradle helpers.
import * as THREE from "three";
import { PORTAL_SIZE } from "../portal.js";
import { Companion, RobotRig, BunnyRig } from "../companion.js";
import { CameraView } from "../cameraview.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { BUDDY, USE_PIP } from "./config.js";
import { camView } from "./desktop.js";
import { send } from "./room.js";
import { buzz, chime, flash } from "./feedback.js";
import { getWindow, immersion, setWorld } from "./portals.js";
import { speak } from "./talk.js";
import { askWorld } from "./story.js";
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
  // Not before the room has accepted us: the server refuses it ("room has no owner yet"). Joining syncs her.
  if (state.joined) send({ t: "companion", id: BUDDY.id, present: Boolean(present) });
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
  const g = getWindow()?.portal.group;
  if (!immersion.inside && g?.visible) {
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
 * "Bonnie, take us to the desert": she changes the window's world, whether or not you are inside it (with no
 * window open yet, it opens onto that world). The story restarts there and the director gives Orbis the new
 * opening shot, which swaps the stream. `world` is "" when they asked for a new world without saying which.
 */
export function buddyChangesWorld(world) {
  if (!world) return askWorld("window"), buddy.say("What world should it show?", 4000);
  flash(`“${world}”`, 5000);
  setWorld(world);
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
/** On a flat screen she only wanders where you can see her: within the view's width (a portrait phone is narrow). */
function fitWander() {
  if (renderer.xr.isPresenting) return void (buddy.wanderDeg = 50);
  const half = THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
  buddy.wanderDeg = Math.max(6, Math.min(50, half - 9));
}
addEventListener("resize", fitWander);
renderer.xr.addEventListener("sessionstart", fitWander);
renderer.xr.addEventListener("sessionend", fitWander);
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
  fitWander();
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
  buddy.say(`Hi! I'm ${BUDDY.name}. Ask me for ideas any time, or just talk to me!`, 6000);
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
    c.getWorldPosition(_aimRay.origin);
    _aimRay.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    if (buddyAimed(_aimRay) || buddyTouched(c)) return true;
  }
  return false;
}

// Does a pointing ray pass close to Bonnie? (A near miss still grabs her: she's small and moves.)
export function buddyAimed(ray) {
  if (!buddy.visible || !buddy.ready) return false;
  const c = buddy.centerWorld(_bc);
  const along = _bd.copy(c).sub(ray.origin).dot(ray.direction);
  if (along < 0 || along > 6) return false;
  const miss = ray.distanceToPoint(c);
  return miss < Math.max(0.25, along * Math.tan(THREE.MathUtils.degToRad(9))); // 25 cm, or 9° far away
}

// Two-hand pick-up of Bonnie: she rides on a point midway between your hands, kept upright.
export const cradle = { obj: new THREE.Object3D(), hands: null };
scene.add(cradle.obj);
// Scratch for the per-frame paths below (headset frames must not make garbage: GC pauses show as judder).
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _aimRay = new THREE.Ray(), _bc = new THREE.Vector3(), _bd = new THREE.Vector3();
export function updateCradle() {
  if (!cradle.hands) return;
  const a = cradle.hands[0].getWorldPosition(_ca), b = cradle.hands[1].getWorldPosition(_cb);
  cradle.obj.position.copy(a.add(b).multiplyScalar(0.5));
  cradle.obj.updateMatrixWorld(true);
}
export function nearBuddy(ctrl, r) {
  return buddy.visible && ctrl.getWorldPosition(tmpV).distanceTo(buddy.centerWorld()) < r;
}
