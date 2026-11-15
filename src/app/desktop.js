// app/desktop.js: camera view, mouse / keyboard controls and touch gestures.
import * as THREE from "three";
import { MAX_SCALE, MIN_SCALE } from "../portalresize.js";
import { TouchGestureRecognizer } from "../touchgestures.js";
import { analyzeStroke, strokeHint } from "../drawportal.js";
import { analyzeHeart } from "../heartshape.js";
import { heartsFor } from "./hearts.js";
import { CameraView, headingOf } from "../cameraview.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { flash } from "./feedback.js";
import { buddy, callBuddy, toggleBuddyFollow } from "./buddy.js";
import { setButtonsHidden } from "./buttons.js";
import { closePortal, immersion, openPortal, portals, setFocus, stepInside, stepOut } from "./portals.js";
import { disarm, skipWorld, touchPortal, touchWorld } from "./story.js";
import { startTalking, stopTalking } from "./talk.js";
import { trail } from "./trail.js";
import { backdrop } from "./world.js";
import { facingPortal, raycaster, targets } from "./xrinput.js";

// ---------- Camera: see your real surroundings on a phone or computer, like the Quest's see-through ----------
export const camView = new CameraView();
export const seeThrough = () => renderer.xr.isPresenting || camView.on; // windows sit over the real world
export async function toggleCamera() {
  if (camView.on) {
    camView.stop();
    state.yaw = headingOf(camera.quaternion);
    state.pitch = 0;
    camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
    return flash("Camera off.", 2500);
  }
  try {
    await camView.start();
    flash(
      camView.orienting
        ? "Camera on: move your phone to look around. Drag to turn the view if the windows are out of reach."
        : "Camera on: your windows float over your camera. Drag to look around.",
      6000,
    );
  } catch (e) {
    flash(e?.name === "NotAllowedError" ? "Camera blocked: allow camera access for this site and try again." : `Camera unavailable: ${e?.message || e}`, 6000);
  }
}

// ---------- Desktop controls (for building and testing without the headset) ----------
let dragging = false, moved = 0, lastX = 0, lastY = 0;
// Drag the companion with the mouse to pick it up; let go to throw it.
const mouseHand = new THREE.Object3D();
scene.add(mouseHand);
let buddyDrag = 0; // how far along the mouse ray it is held (0 = not held)
const mouseRay = (e) => raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
let lastPointerType = "mouse";
renderer.domElement.addEventListener("pointerdown", (e) => {
  lastPointerType = e.pointerType;
  dragging = true;
  moved = 0;
  (lastX = e.clientX), (lastY = e.clientY);
  if (renderer.xr.isPresenting || !buddy.visible) return;
  mouseRay(e);
  if (!raycaster.intersectObjects(targets(), false)[0]?.object.userData.companion) return;
  buddyDrag = buddy.centerWorld().distanceTo(raycaster.ray.origin);
  raycaster.ray.at(buddyDrag, mouseHand.position);
  if (!buddy.grab(mouseHand, { reel: false })) buddyDrag = 0;
});
addEventListener("pointerup", (e) => {
  touch.up(e);
  dragging = touch.pts.size > 0;
  if (buddyDrag) {
    buddyDrag = 0;
    if (buddy.release() === "tap") toggleBuddyFollow();
    return;
  }
  if (moved > 6 || renderer.xr.isPresenting || e.target !== renderer.domElement) return;
  if (e.pointerType === "touch") return; // fingers: taps arrive through the touch gestures (onTap)
  tapAt(e.clientX, e.clientY);
});
/** What's under a point on the screen (window, Bonnie, button…), or undefined. */
function hitAt(x, y) {
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return raycaster.intersectObjects(targets(), false)[0];
}
/** A click or tap: focus / touch a window, touch the world you're inside, or open a window. */
function tapAt(x, y) {
  const hit = hitAt(x, y);
  if (hit?.object.userData.exit) stepOut();
  else if (hit?.object.userData.portal) {
    const p = hit.object.userData.portal;
    if (p.id === state.focusId) touchPortal(p, hit.uv, hit.point); // click the focused window to touch it
    else setFocus(p.id);
  } else if (immersion.inside) touchWorld(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
  else if (!hit) openPortal(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
}
renderer.domElement.addEventListener("dblclick", (e) => {
  if (lastPointerType === "touch") return; // fingers have their own double tap
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  stepInside(raycaster.intersectObjects(targets(), false)[0]?.object.userData.portal);
});
addEventListener("pointermove", (e) => {
  touch.move(e);
  if (!dragging || touch.busy || touch.pts.size > 1) return; // a hold, pinch or second finger isn't looking around
  if (buddyDrag) return mouseRay(e), void raycaster.ray.at(buddyDrag, mouseHand.position);
  // From positions, not movementX/Y: phones (Safari especially) don't report those for touch.
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  (lastX = e.clientX), (lastY = e.clientY);
  moved += Math.abs(dx) + Math.abs(dy);
  if (camView.orienting) return void (camView.offset -= dx * 0.004); // the phone aims; a drag turns the room around you
  state.yaw -= dx * 0.004;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - dy * 0.004));
  camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
});
addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && !/INPUT|TEXTAREA/.test(e.target.tagName)) (e.preventDefault(), startTalking());
  if (e.code === "Backspace" && state.focusId && !/INPUT|TEXTAREA/.test(e.target.tagName)) closePortal(state.focusId);
  if (e.code === "KeyE" && !/INPUT|TEXTAREA/.test(e.target.tagName)) immersion.inside ? stepOut() : stepInside(portals.get(state.focusId)?.portal);
  if (e.code === "Escape") stepOut(), disarm(), skipWorld();
  if (e.code === "KeyH" && !/INPUT|TEXTAREA/.test(e.target.tagName)) setButtonsHidden(!document.body.classList.contains("clean"));
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") stopTalking();
  keysDown.delete(e.code);
});
// ---------- Touch gestures (phones, tablets): the headset's hand gestures, with fingers ----------
// See touchgestures.js for how each is recognised, and the gesture guide (#gestures) for the list.
export const haptic = (ms = 12) => navigator.vibrate?.(ms);
const screenRay = (x, y) => (raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera), raycaster.ray);
let carry = null, drawing = null, pinchResize = null, flickArmed = null;
// Where one finger came down: the window under it, and the view then. A flick also drags the view
// (it can't be told apart until the finger lifts), so a flick puts the view back and acts on that window.
let touchStart = null;
const DRAW_AT = 0.6; // metres: you "draw in the air" at arm's length, as in the headset
const touch = new TouchGestureRecognizer({
  claims: () => buddyDrag > 0, // a finger on Bonnie picks her up (pointerdown above): carry and throw
  onTap: (x, y) => tapAt(x, y),
  onDoubleTap(x, y) {
    const p = hitAt(x, y)?.object.userData.portal;
    haptic();
    if (p && !immersion.inside) return stepInside(p);
    if (immersion.inside) return stepOut();
    callBuddy(); // Bonnie appears, or hops back over to you
  },
  onHoldStart(x, y) {
    const hit = hitAt(x, y);
    const p = hit?.object.userData.portal;
    if (p && !immersion.inside) {
      const eye = camera.getWorldPosition(new THREE.Vector3());
      carry = { portal: p, dist: p.group.getWorldPosition(new THREE.Vector3()).distanceTo(eye) };
      setFocus(p.id);
      haptic(20);
      return true;
    }
    if (hit || immersion.inside) return false; // a button, or inside a world: nothing to hold
    const ray = screenRay(x, y);
    drawing = [ray.at(DRAW_AT, new THREE.Vector3()).toArray()];
    trail.start(drawing[0]);
    haptic(20);
    flash("Draw a rectangle where the window should go (or a heart for Bonnie), then lift your finger.", 4000);
    return true;
  },
  onHoldMove(x, y) {
    const ray = screenRay(x, y);
    if (carry) {
      const g = carry.portal.group;
      g.position.copy(ray.at(carry.dist, new THREE.Vector3()));
      const eye = camera.getWorldPosition(new THREE.Vector3());
      g.lookAt(eye.x, g.position.y, eye.z);
    } else if (drawing) {
      const p = ray.at(DRAW_AT, new THREE.Vector3()).toArray(), last = drawing.at(-1);
      if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.004 && drawing.length < 600) drawing.push(p), trail.add(p);
    }
  },
  onHoldEnd(_at, cancelled) {
    if (carry) (carry = null), haptic(10);
    if (!drawing) return;
    const stroke = drawing;
    drawing = null;
    if (cancelled) return trail.cancel();
    // A heart drawn with your finger: Bonnie answers with hearts.
    const heart = analyzeHeart(stroke, camera.getWorldPosition(new THREE.Vector3()).toArray());
    if (heart.heart) return trail.end("heart"), haptic(40), heartsFor(heart.center);
    const r = analyzeStroke(stroke, camera.getWorldPosition(new THREE.Vector3()).toArray());
    if (r.ok) return trail.end(true), haptic(40), openPortal(null, null, { at: r.position, scale: r.scale });
    trail.end(false);
    flash(strokeHint(r.reason), 4000);
  },
  onFlick() {
    const start = touchStart;
    if (start) {
      if (camView.orienting) camView.offset = start.offset;
      else (state.yaw = start.yaw), (state.pitch = start.pitch), camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
    }
    const p = start?.portal;
    if (!p || immersion.inside || !portals.has(p.id)) return;
    if (flickArmed?.id === p.id && performance.now() - flickArmed.at < 3000) {
      flickArmed = null;
      haptic(40);
      flash(`Window ${p.id} wiped away.`, 2500);
      return closePortal(p.id);
    }
    flickArmed = { id: p.id, at: performance.now() };
    haptic();
    flash(`Flick up again to close window ${p.id}.`, 3000);
  },
  onPinchStart(mid, a, b) {
    const p = [mid, a, b].map(([x, y]) => hitAt(x, y)?.object.userData.portal).find(Boolean);
    pinchResize = p && !immersion.inside ? { portal: p, s0: p.group.scale.x } : null;
    if (pinchResize) setFocus(p.id);
  },
  onPinch(ratio) {
    if (pinchResize) pinchResize.portal.group.scale.setScalar(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchResize.s0 * ratio)));
  },
  onPinchEnd(ratio, cancelled) {
    if (pinchResize) return (pinchResize = null), haptic(10);
    if (cancelled) return;
    // Like parting curtains: fingers apart steps into the window; together steps back out.
    if (!immersion.inside && ratio > 1.45) {
      const p = portals.get(state.focusId)?.portal || facingPortal();
      if (!p) return flash("Open a window first, then spread two fingers to step inside.", 3500);
      haptic(30);
      return stepInside(p);
    }
    if (immersion.inside && ratio < 0.7) return haptic(30), stepOut();
  },
  onTwoFingerTap: () => (haptic(), setButtonsHidden(!document.body.classList.contains("clean"))),
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && touch.pts.size === 0)
    touchStart = { portal: hitAt(e.clientX, e.clientY)?.object.userData.portal, yaw: state.yaw, pitch: state.pitch, offset: camView.offset };
  touch.down(e);
});
addEventListener("pointercancel", (e) => {
  touch.up(e);
  dragging = touch.pts.size > 0;
});

// W/A/S/D or arrow keys walk around a 3D world background in the desktop preview.
const keysDown = new Set();
addEventListener("keydown", (e) => {
  if (!/INPUT|TEXTAREA/.test(e.target.tagName) && /^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) {
    keysDown.add(e.code);
    if (backdrop.on && e.code.startsWith("Arrow")) e.preventDefault();
  }
});
addEventListener("blur", () => keysDown.clear());
export function desktopWalk(dt) {
  if (renderer.xr.isPresenting) return;
  if (!backdrop.on) {
    // Back in the preview room: return to the starting spot once the world has faded out.
    if (backdrop.opacity === 0 && (camera.position.x || camera.position.z)) camera.position.set(0, 1.6, 0);
    return;
  }
  const f = (keysDown.has("KeyW") || keysDown.has("ArrowUp") ? 1 : 0) - (keysDown.has("KeyS") || keysDown.has("ArrowDown") ? 1 : 0);
  const r = (keysDown.has("KeyD") || keysDown.has("ArrowRight") ? 1 : 0) - (keysDown.has("KeyA") || keysDown.has("ArrowLeft") ? 1 : 0);
  if (!f && !r) return;
  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  camera.position.addScaledVector(fwd, f * 2 * dt).addScaledVector(right, r * 2 * dt);
}
