// app/portals.js: the window: open/close, stepping inside, setting its world, retire().
import * as THREE from "three";
import { Portal } from "../portal.js";
import { Immersion } from "../immersion.js";
import { OrbisStream } from "../orbis.js";
import { CameraView } from "../cameraview.js";
import { $, camera, listener, renderer, say, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM, send } from "./room.js";
import { buzz, flash } from "./feedback.js";
import { sides, stopSides } from "./wide.js";
import { resolveWindow } from "../windowplace.js";

// ---------- Step inside ----------
export const immersion = new Immersion(scene, camera, {
  audioContext: listener.context,
  onChange(portal) {
    send({ t: "immerse", inside: Boolean(portal) }); // the director reframes the world as a first-person view
    buzz();
  },
});
export function stepInside(portal = current?.portal) {
  if (!portal || (immersion.inside && immersion.portal === portal)) return;
  // Nothing to step into until the world's stream has started: its first frame has arrived (and stays "started"
  // through a brief stall or reconnect, when the video element's own readiness dips).
  if (!portal._videoReady) return flash("The world is still forming. Step in once it appears.", 3000);
  immersion.enter(portal, current?.stream.video);
  flash(
    renderer.xr.isPresenting
      ? "You stepped into the window. Bring your hands together, or shake them, to step back out (or press B/Y)."
      : CameraView.touch
        ? "You stepped into the window. Pinch in or double-tap to step back out."
        : "You stepped into the window. Press E or Esc to step back out.",
    5000,
  );
}
export function stepOut() {
  if (!immersion.inside) return;
  immersion.exit();
  flash("Back in your room.", 2000);
}

// ---------- The window ----------
let current = null; // { portal, stream } once the window is open
/** The one window ({ portal, stream }), or null while none is open. */
export const getWindow = () => current;

/** A spot that is physically sound for the window: off the floor, under the ceiling, not in your face. */
export function settledSpot(pos, scale) {
  return resolveWindow(pos, scale, camera.getWorldPosition(new THREE.Vector3()).toArray());
}

/** After the window is moved or resized: lift / push it to an allowed spot and face you. */
export function settlePortal(portal) {
  const spot = settledSpot(portal.group.getWorldPosition(new THREE.Vector3()).toArray(), portal.group.scale.x);
  portal.group.position.fromArray(spot);
  const eye = camera.getWorldPosition(new THREE.Vector3());
  portal.group.lookAt(eye.x, spot[1], eye.z);
}

/**
 * Opens the window. It starts empty (it shows "Tell Bonnie what to show here") unless a world was chosen
 * ahead of time (the console) or is given here; otherwise Bonnie makes its world from what you ask her for.
 * opts.at: where it goes ([x, y, z] where you drew it, or {x, y, z}), facing you; else in front of you
 * (along opts.origin / opts.dir if given, else where you look); opts.scale: its size (a drawn window);
 * opts.world: the world it starts in (no question asked).
 */
export function openWindow({ at = null, origin = null, dir = null, world = null, scale = 1 } = {}) {
  if (immersion.inside) return flash("Step back out before opening the window.", 2500);
  if (current) return flash("The window is already open. Ask for a new world to change it.", 3500);
  const hasWorld = Boolean(state.pendingSeed || state.roomState?.nextSeed);
  state.pendingSeed = "";
  if (state.roomState) state.roomState.nextSeed = "";
  const eye = camera.getWorldPosition(new THREE.Vector3());
  if (!origin || !dir) {
    origin = eye;
    dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    dir.y = Math.max(-0.2, Math.min(0.2, dir.y));
    dir.normalize();
  }
  const wanted = at ? (Array.isArray(at) ? at : [at.x, at.y, at.z]) : origin.clone().addScaledVector(dir, 1.8).toArray();
  const spot = settledSpot(wanted, scale);
  const portal = new Portal(listener);
  portal.group.position.fromArray(spot);
  portal.group.lookAt(eye.x, spot[1], eye.z); // upright, facing you
  portal.group.scale.setScalar(scale);
  scene.add(portal.group);
  const stream = new OrbisStream("main", ROOM);
  stream.addEventListener("video", () => portal.attachVideo(stream.video));
  stream.addEventListener("audio", () => portal.attachAudio(stream.audioStream));
  stream.addEventListener("status", (e) => {
    const { status, detail } = e.detail;
    if (status !== "streaming") portal.setCaption(detail || labelFor(status), "status");
    else if (portal._lastStory) portal.setCaption(portal._lastStory, "story");
    else portal.setCaption("", "status");
    send({ t: "window_status", status });
  });
  current = { portal, stream };
  send({ t: "window_opened" }); // with a world chosen ahead, the server asks the director for its first scene
  if (world) {
    portal.setCaption("The world is forming…", "status");
    send({ t: "set_seed", seed: world });
  } else if (!hasWorld) portal.setCaption(labelFor("asking"), "status"); // empty until Bonnie makes its world
}

export function closeWindow() {
  if (!current) return;
  const { portal, stream } = current;
  if (immersion.portal === portal) immersion.reset();
  stream.close();
  portal.dispose();
  current = null;
  send({ t: "window_closed" });
}

/**
 * Shows a new world in the window, whenever it is asked for (by Bonnie, the world question, the console):
 * the story restarts there and the director gives Orbis the new opening shot, which swaps the stream.
 * With no window open yet, it opens onto that world.
 */
export function setWorld(world) {
  if (!current) return openWindow({ world });
  current.portal.setCaption("The world is forming…", "status");
  send({ t: "set_seed", seed: world });
}

export const labelFor = (s) =>
  ({ asking: "Tell Bonnie what to show here", connecting: "Opening a window…", retrying: "Waiting for a free world…", reconnecting: "Reconnecting…", closed: "" })[s] ??
  s;

addEventListener("pagehide", () => {
  current?.stream.closeOnUnload();
  for (const side of ["L", "R"]) sides[side]?.closeOnUnload();
});

/** Exiting VR: close the window's Orbis stream and the wide view's side views, so no credits are spent out of the headset. The page stays open. */
export function closeAllStreams() {
  current?.stream.close();
  stopSides();
}
export function retire(text = `Your room “${ROOM}” is now playing in another tab or device.`) {
  // Stop our stream so credits aren't spent twice.
  immersion.reset();
  if (current) current.stream.close(), current.portal.dispose();
  current = null;
  state.retired = true;
  $("#overlay").hidden = false;
  $("#overlay .card").innerHTML = `<h1>Living Window</h1><p>${text}</p><button onclick="location.reload()">Take it back</button>`;
  renderer.xr.getSession()?.end();
  say(text);
}
