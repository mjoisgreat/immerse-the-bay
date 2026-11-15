// app/xrinput.js: controllers and hands: selecting, grabbing, resizing, drawing windows, buttons, walking, hand gestures.
import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { PORTAL_SIZE } from "../portal.js";
import { resizedScale, carriedPosition } from "../portalresize.js";
import { analyzeStroke, strokeHint } from "../drawportal.js";
import { analyzeHeart } from "../heartshape.js";
import { heartsFor } from "./hearts.js";
import { HandGestures } from "../gestures.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { buzz, chime, flash } from "./feedback.js";
import { buddy, buddyAimed, buddyTouched, cradle, nearBuddy, toggleBuddyFollow, updateCradle } from "./buddy.js";
import { closeMenu, menuSnap, pressMenuPart, toolbar } from "./buttons.js";
import { cheatSheet } from "./guide.js";
import { closePortal, immersion, openPortal, portals, setFocus, stepInside, stepOut } from "./portals.js";
import { touchPortal, touchWorld } from "./story.js";
import { startTalking, stopTalking } from "./talk.js";
import { trail } from "./trail.js";
import { loco } from "./world.js";

// ---------- XR input: controllers and hands ----------
export const raycaster = new THREE.Raycaster();
export const tmpMat = new THREE.Matrix4();
const controllerFactory = new XRControllerModelFactory();
const handFactory = new XRHandModelFactory();

export function targets() {
  const ui = [];
  if (renderer.xr.isPresenting) ui.push(...toolbar.targets);
  if (buddy.visible) ui.push(buddy.hitbox);
  if (cheatSheet.visible) ui.push(cheatSheet.mesh);
  return [...ui.filter((o) => o.visible || o === buddy.hitbox), ...[...portals.values()].filter((p) => p.portal.group.visible).map((p) => p.portal.screen)];
}

function rayFrom(obj) {
  tmpMat.identity().extractRotation(obj.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(obj.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
  return raycaster.ray;
}

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.6 }),
  );
  // A short ray, not an endless line. The only dot is the pointer on the menu (see Toolbar.pointAt).
  line.scale.z = 0.4;
  ctrl.add(line);
  ctrl.addEventListener("connected", (e) => {
    // A hand's laser only shows while it points at the menu (controllers always show theirs).
    ctrl.userData.laser = line;
    line.visible = !e.data.hand;
    ctrl.userData.isHand = Boolean(e.data.hand);
  });
  ctrl.addEventListener("selectstart", () => onSelectStart(ctrl));
  ctrl.addEventListener("selectend", () => onSelectEnd(ctrl));
  ctrl.addEventListener("squeezestart", () => onSqueeze(ctrl));
  scene.add(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);

  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, "mesh"));
  ctrl.userData.hand = hand;
  scene.add(hand);
}

function onSelectStart(ctrl) {
  const ray = rayFrom(ctrl);
  const snap = menuSnap(ray); // pointing near a menu item zones in on it
  if (snap) return pressMenuPart(snap.part);
  const hit = raycaster.intersectObjects(targets(), false)[0];
  if (!(hit?.object.userData.button || hit?.object.userData.choice !== undefined)) closeMenu(); // any other action shuts the menu
  if (hit?.object.userData.gestureCard) return cheatSheet.hide(); // pinching the cheat sheet closes it
  if (hit?.object.userData.button || hit?.object.userData.choice !== undefined) return pressMenuPart(hit.object);
  // Pick the companion up (pointing at it, or reaching out and touching it). A quick tap toggles
  // following (see onSelectEnd); holding carries it, and letting go throws it.
  const otherHand = [0, 1].map((i) => renderer.xr.getController(i)).find((c) => c !== ctrl);
  const aimedHere = !hit?.object.userData.portal && buddyAimed(ray);
  if (hit?.object.userData.companion || buddyTouched(ctrl) || aimedHere || (otherHand?.userData.heldBuddy && nearBuddy(ctrl, 0.5))) {
    // The other hand already holds it: lift it with both, held between your hands.
    if (otherHand?.userData.heldBuddy && buddy.held) {
      ctrl.userData.heldBuddy = ctrl.userData.twoHand = otherHand.userData.twoHand = true;
      cradle.hands = [otherHand, ctrl];
      updateCradle();
      buddy.rehold(cradle.obj);
      buzz(0.4, 40);
      return;
    }
    if (buddy.grab(ctrl)) (ctrl.userData.heldBuddy = true), (buddyQuietUntil = performance.now() + 1500);
    return;
  }
  const portal = hit?.object.userData.portal;
  // Second hand pinches the window the first hand is already holding: resize with both.
  const holder = portal && [0, 1].map((i) => renderer.xr.getController(i)).find((c) => c !== ctrl && c.userData.grabbed === portal);
  if (holder) {
    holder.userData.tap = null; // this is not a tap on the world
    ctrl.userData.resizing = portal;
    const a = holder.getWorldPosition(new THREE.Vector3()), b = ctrl.getWorldPosition(new THREE.Vector3());
    resize = {
      portal, holder, ctrl, dist: a.distanceTo(b), scale: portal.group.scale.x,
      mid: a.clone().add(b).multiplyScalar(0.5).toArray(), // where the window was lifted, to carry it by both hands
      pos: portal.group.getWorldPosition(new THREE.Vector3()).toArray(),
    };
    return buzz(0.3, 30);
  }
  if (portal) {
    setFocus(portal.id);
    // A quick tap touches the world at that spot; holding and dragging moves the window.
    ctrl.userData.tap = { at: performance.now(), uv: hit.uv.clone(), point: hit.point.clone() };
    // Remember where it was: pulling it into your face steps inside and puts the window back.
    const at = portal.group.getWorldPosition(new THREE.Vector3());
    ctrl.userData.grabFrom = {
      pos: portal.group.position.clone(),
      quat: portal.group.quaternion.clone(),
      dist: at.distanceTo(camera.getWorldPosition(new THREE.Vector3())),
    };
    ctrl.attach(portal.group); // grab: the portal follows your hand until you let go
    ctrl.userData.grabbed = portal;
    return;
  }
  // Empty space: touch the world you're inside, teleport (pointing at the ground in a 3D world), or open
  // a window. Decided on release, and only for a quick, still tap: a throwing swing, a slipped grab or a
  // pinch while Bonnie is in the air never opens a window or moves you.
  ctrl.userData.pendingTap = {
    at: performance.now(),
    from: ctrl.getWorldPosition(new THREE.Vector3()),
    origin: ray.origin.clone(),
    dir: ray.direction.clone(),
  };
  // ...and record the pinch's path, in case you're drawing a window frame in the air.
  ctrl.userData.stroke = [pinchPoint(ctrl).toArray()];
  trail.start(ctrl.userData.stroke[0]);
}

// Where you're pinching: between thumb and index fingertip (hands), or just ahead of the controller.
const _pp = new THREE.Vector3(), _pq = new THREE.Vector3();
function pinchPoint(ctrl) {
  const j = ctrl.userData.hand?.joints;
  const a = j?.["thumb-tip"], b = j?.["index-finger-tip"];
  if (a?.visible && b?.visible) return a.getWorldPosition(_pp).add(b.getWorldPosition(_pq)).multiplyScalar(0.5).clone();
  tmpMat.identity().extractRotation(ctrl.matrixWorld);
  return ctrl.getWorldPosition(_pp).add(_pq.set(0, 0, -0.06).applyMatrix4(tmpMat)).clone();
}
export function updateStrokes() {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const s = c.userData.stroke;
    if (!s || !c.userData.pendingTap) continue;
    const p = pinchPoint(c).toArray();
    const last = s.at(-1);
    if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.01 && s.length < 600) s.push(p), trail.add(p);
  }
}

// Bonnie was just grabbed or thrown, or is flying / getting up: empty-space pinches are ignored.
let buddyQuietUntil = 0;
const buddyBusy = () => performance.now() < buddyQuietUntil || (buddy.phys && buddy.phys.state !== "held");
const TAP_MS = 450, TAP_MOVE = 0.08; // metres the hand may drift during a tap
function finishTap(ctrl) {
  const t = ctrl.userData.pendingTap, stroke = ctrl.userData.stroke || [];
  ctrl.userData.pendingTap = null;
  ctrl.userData.stroke = null;
  if (!t) return;
  if (buddyBusy()) return trail.cancel(); // a throw's follow-through: nothing happens
  const still = performance.now() - t.at < TAP_MS && ctrl.getWorldPosition(new THREE.Vector3()).distanceTo(t.from) < TAP_MOVE;
  if (still) {
    trail.cancel();
    if (immersion.inside) return touchWorld(t.origin, t.dir);
    const floor = loco.enabled && loco.floorHit(new THREE.Ray(t.origin, t.dir));
    if (floor) return loco.teleport(floor), buzz(0.3, 30);
    // With hands, windows are drawn (see below); a controller's trigger tap still opens one ahead.
    if (ctrl.userData.isHand) return flash("Pinch and draw a square in the air to open a window.", 4000);
    return openPortal(t.origin, t.dir);
  }
  // A heart drawn in the air: Bonnie answers with hearts (inside a world too: she comes along).
  const eyeNow = camera.getWorldPosition(new THREE.Vector3()).toArray();
  const heart = analyzeHeart(stroke, eyeNow);
  if (heart.heart) return trail.end("heart"), buzz(0.5, 60), heartsFor(heart.center);
  if (immersion.inside) return trail.cancel();
  // Moved while pinching: was it a window frame drawn in the air?
  const r = analyzeStroke(stroke, eyeNow);
  if (r.ok) {
    trail.end(true);
    buzz(0.5, 60);
    return openPortal(null, null, { at: r.position, scale: r.scale });
  }
  let path = 0;
  for (let i = 1; i < stroke.length; i++) path += Math.hypot(...stroke[i].map((v, k) => v - stroke[i - 1][k]));
  if (path > 0.35) (trail.end(false), flash(strokeHint(r.reason), 4000));
  else trail.cancel();
}



// Two-hand pick-up of a window: { portal, holder (hand carrying the window), ctrl (second hand), dist,
// scale, mid, pos }. The window is carried by the midpoint of your hands and sized by how far apart they are.
let resize = null;
export function updateResize() {
  if (!resize) return;
  const a = resize.holder.getWorldPosition(new THREE.Vector3()), b = resize.ctrl.getWorldPosition(new THREE.Vector3());
  resize.portal.group.scale.setScalar(resizedScale(resize.scale, resize.dist, a.distanceTo(b)));
  const mid = a.clone().add(b).multiplyScalar(0.5).toArray();
  // The window hangs off the carrying hand, so ask for its place in that hand's space.
  resize.portal.group.position.copy(resize.holder.worldToLocal(new THREE.Vector3(...carriedPosition(resize.pos, resize.mid, mid))));
}



function onSelectEnd(ctrl) {
  if (ctrl.userData.heldBuddy && ctrl.userData.twoHand) {
    // Either hand letting go drops (or throws) her; the other hand's release then does nothing.
    for (const c of cradle.hands) c.userData.heldBuddy = c.userData.twoHand = false;
    cradle.hands = null;
    buddy.release();
    return;
  }
  if (ctrl.userData.heldBuddy) {
    ctrl.userData.heldBuddy = false;
    buddyQuietUntil = performance.now() + 1500; // the throw's follow-through must not open a window
    if (buddy.release() === "tap") toggleBuddyFollow();
    return;
  }
  if (ctrl.userData.pendingTap) return finishTap(ctrl);
  if (ctrl.userData.resizing) {
    ctrl.userData.resizing = null;
    resize = null; // the other hand keeps holding the window, now at its new size
    return;
  }
  if (resize && resize.holder === ctrl) resize = null; // let go of the carrying hand: resizing ends too
  const p = ctrl.userData.grabbed;
  const tap = ctrl.userData.tap;
  ctrl.userData.tap = null;
  if (p && tap && performance.now() - tap.at < 280) {
    // It was a tap, not a move: put the window back exactly and touch the world there.
    scene.attach(p.group);
    const from = ctrl.userData.grabFrom;
    if (from) p.group.position.copy(from.pos), p.group.quaternion.copy(from.quat);
    ctrl.userData.grabbed = null;
    touchPortal(p, tap.uv, tap.point);
    return;
  }
  if (p) {
    scene.attach(p.group);
    const eye = new THREE.Vector3();
    camera.getWorldPosition(eye);
    p.group.lookAt(eye.x, p.group.position.y, eye.z);
    ctrl.userData.grabbed = null;
  }
}

function onSqueeze(ctrl) {
  if (ctrl.userData.isHand) return; // a middle-finger pinch must not close a window by accident; shake does that
  rayFrom(ctrl);
  const portal = raycaster.intersectObjects(targets(), false)[0]?.object.userData.portal;
  if (portal) closePortal(portal.id);
}

// A / X on Touch controllers = push-to-talk from anywhere. B / Y = step into the window you're
// pointing at (or the focused one), or step back out.
let buttonHeld = false, stepHeld = false, stickHeld = false;
export function pollButtons() {
  const session = renderer.xr.getSession();
  if (!session) return;
  let pressed = false, step = null, stick = false;
  session.inputSources.forEach((src, i) => {
    if (src.gamepad?.buttons?.[4]?.pressed) pressed = true;
    if (src.gamepad?.buttons?.[5]?.pressed) step = i;
    if (src.gamepad?.buttons?.[3]?.pressed) stick = true;
  });
  if (stick && !stickHeld) toolbar.toggleOpen(); // thumbstick click: open / close the menu
  stickHeld = stick;
  if (pressed && !buttonHeld) (closeMenu(), startTalking());
  if (!pressed && buttonHeld) stopTalking();
  buttonHeld = pressed;
  if (step !== null && !stepHeld) {
    closeMenu();
    if (immersion.inside) stepOut();
    else {
      rayFrom(renderer.xr.getController(step));
      const aimed = raycaster.intersectObjects(targets(), false).find((h) => h.object.userData.portal);
      stepInside(aimed?.object.userData.portal || portals.get(state.focusId)?.portal);
    }
  }
  stepHeld = step !== null;
}

// Walking: step through a window's surface to go inside; walk back ~60 cm to come out.
// Pulling a grabbed window into your face also takes you in.
const eye = new THREE.Vector3(), local = new THREE.Vector3();
export function checkWalking() {
  camera.getWorldPosition(eye);
  if (!renderer.xr.isPresenting) return;
  for (const { portal } of portals.values()) {
    const grabbedBy = [0, 1].map((i) => renderer.xr.getController(i)).find((c) => c.userData.grabbed === portal);
    if (grabbedBy) {
      if (resize?.portal === portal) continue; // two-handed resize: never mistaken for pulling it into your face
      const from = grabbedBy.userData.grabFrom;
      const d = portal.group.getWorldPosition(local).distanceTo(eye);
      if (d < 0.4 || (from && d < from.dist - 0.45)) {
        scene.attach(portal.group);
        if (from) portal.group.position.copy(from.pos), portal.group.quaternion.copy(from.quat);
        grabbedBy.userData.grabbed = null;
        stepInside(portal);
      }
      continue;
    }
    if (!portal.group.visible) continue;
    local.copy(eye);
    portal.group.worldToLocal(local);
    const prev = portal._headZ;
    portal._headZ = local.z;
    const within = Math.abs(local.x) < PORTAL_SIZE.W / 2 + 0.1 && Math.abs(local.y) < PORTAL_SIZE.H / 2 + 0.6;
    if (within && prev >= 0.25 && local.z < 0.25 && local.z > -0.6) stepInside(portal);
  }
  if (immersion.walkedBack(eye)) stepOut();
}

// Hand gestures (the main way in; the controller buttons do the same three things): mic to the mouth,
// part your hands to step in, bring them together to step out, shake both to wipe a window away,
// look at your left palm for the buttons. Each one answers with a glow on the hands, a tone and a buzz.
function confirmGesture(kind, color) {
  gestures.pulse(color);
  chime(kind);
  buzz(0.7, 80);
}
export function facingPortal() {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  let best = null, bestDot = 0.8;
  for (const { portal } of portals.values()) {
    const d = portal.group.getWorldPosition(new THREE.Vector3()).sub(eye).normalize().dot(gaze);
    if (d > bestDot) (best = portal), (bestDot = d);
  }
  return best;
}
export const gestures = new HandGestures(renderer, camera, {
  "talk-start": () => (closeMenu(), gestures.pulse(0xff5533), startTalking(true)),
  "talk-end": () => (gestures.pulse(0xffd08a), stopTalking()),
  open() {
    closeMenu();
    if (immersion.inside) return;
    if ([0, 1].some((i) => renderer.xr.getController(i).userData.grabbed || renderer.xr.getController(i).userData.heldBuddy)) return; // dragging a window, not parting curtains
    const p = portals.get(state.focusId)?.portal || facingPortal();
    if (!p) return flash("Open a window first, then part your hands to step inside.");
    confirmGesture("open", 0x7fd4ff);
    stepInside(p);
  },
  close() {
    closeMenu();
    if (!immersion.inside) return; // outside, hands coming together means nothing
    confirmGesture("close", 0xffd08a);
    stepOut();
  },
  shake() {
    closeMenu();
    if (immersion.inside) return confirmGesture("close", 0xffd08a), stepOut();
    if (!portals.has(state.focusId)) return;
    confirmGesture("shake", 0xff6a4a);
    flash(`Window ${state.focusId} wiped away.`, 2500);
    closePortal(state.focusId);
  },
  palm: () => (gestures.pulse(0xffffff), toolbar.toggleOpen()),
});
scene.add(gestures.fx);
