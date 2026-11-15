// app/portals.js: the windows: the portals Map, open/close/focus, stepping inside, the exit orb, retire().
import * as THREE from "three";
import { Portal } from "../portal.js";
import { Immersion } from "../immersion.js";
import { OrbisStream } from "../orbis.js";
import { CameraView } from "../cameraview.js";
import { $, camera, listener, renderer, say, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM, send } from "./room.js";
import { buzz, flash } from "./feedback.js";
import { toolbar } from "./buttons.js";
import { hideGestureCard } from "./guide.js";
import { ASK, askWorld, clearAsk, refreshCards } from "./story.js";
import { sides } from "./wide.js";

// Exit orb (blue, right side): only shown while you're inside a world. Pinch it to step back out.
export const exitOrb = new THREE.Mesh(
  new THREE.TorusGeometry(0.028, 0.009, 16, 40),
  new THREE.MeshStandardMaterial({ color: 0x6aa8ff, emissive: 0x10264a, roughness: 0.3 }),
);
exitOrb.position.set(0.22, -0.2, -0.55);
exitOrb.userData.exit = true;
exitOrb.visible = false;
camera.add(exitOrb);

// ---------- Step inside ----------
export const immersion = new Immersion(scene, camera, {
  audioContext: listener.context,
  onChange(id) {
    send({ t: "immerse", id }); // the director reframes that world as a first-person view
    buzz();
    // Tuck the buttons away inside a world for an unobstructed view; bring them back on leaving.
    if (id && !toolbar.collapsed) (toolbar.setCollapsed(true), (state.autoHidden = true));
    else if (!id && state.autoHidden) (toolbar.setCollapsed(false), (state.autoHidden = false));
  },
});
export function stepInside(portal) {
  if (!portal || (immersion.inside && immersion.portal === portal)) return;
  hideGestureCard(); // you've clearly found your way around
  setFocus(portal.id);
  immersion.enter(portal, entryOf(portal)?.stream.video);
  flash(
    renderer.xr.isPresenting
      ? `You stepped into window ${portal.id}. Bring your hands together, or shake them, to step back out (or press B/Y).`
      : CameraView.touch
        ? `You stepped into window ${portal.id}. Pinch in or double-tap to step back out.`
        : `You stepped into window ${portal.id}. Press E or Esc to step back out.`,
    5000,
  );
}
export function stepOut() {
  if (!immersion.inside) return;
  immersion.exit();
  flash("Back in your room.", 2000);
}
// ---------- Portals ----------
export const portals = new Map(); // id -> { portal, stream }
const LETTERS = "ABCDEF";

/** The { portal, stream } entry (and id) of a Portal object. */
export function entryOf(portal) {
  for (const [id, e] of portals) if (e.portal === portal) return { id, ...e };
  return null;
}

function nextId() {
  for (const l of LETTERS) if (!portals.has(l)) return l;
  return null;
}

function placeInFront(obj, origin, dir, dist = 1.8) {
  obj.position.copy(origin).addScaledVector(dir, dist);
  const eye = new THREE.Vector3();
  camera.getWorldPosition(eye);
  obj.lookAt(eye.x, obj.position.y, eye.z); // stay upright, face the viewer
}

/**
 * Opens a window. Every window is its own story, so unless a world was chosen ahead of time
 * (New story, Prepare demo, the console) it asks "what world is behind this window?".
 * opts.at: where it goes ([x, y, z] where you drew it, or {x, y, z} where the companion stands), facing you;
 * opts.scale: its size (a drawn window); opts.world: the world its story starts in (no question asked).
 */
export function openPortal(origin, dir, opts = {}) {
  const { at = null, world = null, scale = 1 } = opts;
  if (portals.size >= state.maxPortals) return flash(`At most ${state.maxPortals} portals. Close one first.`);
  const hasWorld = Boolean(state.pendingSeed || state.roomState?.nextSeed);
  state.pendingSeed = "";
  if (state.roomState) state.roomState.nextSeed = "";
  const id = nextId();
  const portal = new Portal(id, listener);
  if (at) {
    if (Array.isArray(at)) portal.group.position.fromArray(at);
    else portal.group.position.set(at.x, at.y, at.z);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    portal.group.lookAt(eye.x, portal.group.position.y, eye.z); // upright, facing you
    portal.group.scale.setScalar(scale);
  } else placeInFront(portal.group, origin, dir);
  scene.add(portal.group);
  const stream = new OrbisStream(id, ROOM);
  stream.addEventListener("video", () => portal.attachVideo(stream.video));
  stream.addEventListener("audio", () => portal.attachAudio(stream.audioStream));
  stream.addEventListener("status", (e) => {
    const { status, detail } = e.detail;
    if (status !== "streaming") portal.setCaption(detail || labelFor(status), "status");
    else if (portal._lastStory) portal.setCaption(portal._lastStory, "story");
    else portal.setCaption("", "status");
    send({ t: "portal_status", id, status });
  });
  portals.set(id, { portal, stream });
  setFocus(id);
  send({ t: "portal_added", id }); // with a world chosen ahead, the server asks the director for its first scene
  if (world) {
    // The companion was told which world: this window's own story starts there, no question needed.
    clearAsk();
    portal.setCaption("The world is forming…", "status");
    send({ t: "set_seed", id, seed: world });
  } else if (hasWorld) clearAsk();
  else askWorld("portal", id);
}

export function closePortal(id) {
  const p = portals.get(id);
  if (!p) return;
  if (immersion.portal === p.portal) immersion.reset();
  p.stream.close();
  p.portal.dispose();
  portals.delete(id);
  if (state.asking?.id === id) clearAsk();
  send({ t: "portal_removed", id });
  if (state.focusId === id) setFocus(portals.keys().next().value ?? null);
}

export function setFocus(id, tell = true) {
  state.focusId = id;
  for (const [pid, p] of portals) p.portal.setFocused(pid === id);
  if (tell && id) send({ t: "focus", id });
  refreshCards(); // idea cards say which window they will steer
}

export const labelFor = (s) =>
  ({ asking: ASK.portal, connecting: "Opening a window…", retrying: "Waiting for a free world…", reconnecting: "Reconnecting…", closed: "" })[s] ??
  s;

addEventListener("pagehide", () => {
  portals.forEach((p) => p.stream.closeOnUnload());
  for (const side of ["L", "R"]) sides[side]?.closeOnUnload();
});

export function retire(text = `Your room “${ROOM}” is now playing in another tab or device.`) {
  // Stop our streams so credits aren't spent twice.
  immersion.reset();
  for (const p of portals.values()) p.stream.close(), p.portal.dispose();
  portals.clear();
  state.focusId = null;
  state.retired = true;
  $("#overlay").hidden = false;
  $("#overlay .card").innerHTML = `<h1>Living Window</h1><p>${text}</p><button onclick="location.reload()">Take it back</button>`;
  renderer.xr.getSession()?.end();
  say(text);
}
