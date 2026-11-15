import * as THREE from "three";
import { CameraView, headingOf } from "./cameraview.js";
import { $, DESKTOP_BG, camera, listener, previewRoom, renderer, scene } from "./app/stage.js";
import { state } from "./app/state.js";
import { RID, ROOM, handlers, link, send } from "./app/room.js";
import { toastMesh } from "./app/feedback.js";
import { aimedAtBuddy, buddy, syncBuddy, updateCradle } from "./app/buddy.js";
import { openInFront, setButtonsHidden, syncButtons, toolbar, updateToolbar } from "./app/buttons.js";
import { camView, desktopWalk, seeThrough, toggleCamera } from "./app/desktop.js";
import { guide, showTitle, updateTitle } from "./app/guide.js";
import { closePortal, exitOrb, immersion, portals, retire, setFocus, stepInside, stepOut } from "./app/portals.js";
import { applyDirection, askWorld, clearAsk, resetLocal, showChoices, updateRipples } from "./app/story.js";
import { ptt } from "./app/talk.js";
import { trail } from "./app/trail.js";
import { updateSides } from "./app/wide.js";
import { backdrop, loco, locoRays } from "./app/world.js";
import { checkWalking, gestures, pollButtons, updateResize, updateStrokes } from "./app/xrinput.js";

// app/ module layout (this file is the entry point: wiring, the Enter-mixed-reality button, the animation loop).
//
// ES modules evaluate depth-first in import order; the app/ modules import each other in cycles (the sections
// call each other freely), which is safe only because of these rules:
//   - anything another module calls is an exported `function` declaration (hoisted, usable before its module runs);
//   - top-level (module-evaluation-time) code reads imported consts ONLY from the leaf modules stage.js and
//     config.js (plus its own module's consts), and never calls an imported function. Everything else a module
//     reads from the others happens inside functions/callbacks, which run later, after every module has evaluated;
//   - room.js is the only module with top-level await and imports no feature module: its link callbacks delegate
//     to `handlers`, which this file fills in below, before anything can arrive over the network.
// Resulting evaluation order:
//   stage -> state -> room (awaits) -> feedback -> config -> trail -> xrinput -> world -> desktop -> wide
//   -> buttons -> story -> talk -> guide -> portals -> buddy -> main
// (checked with a script that lists each module's top-level reads of imported bindings).

// The server link's callbacks (see app/room.js): they call into nearly every feature, so they are wired up here.
Object.assign(handlers, {
  async onOpen() {
    const r = await link.request({ t: "hello", role: "renderer", rid: RID });
    if (r.status === 403) return location.replace(`/watch.html?room=${ROOM}`); // someone claimed it first
    for (const [id, p] of portals) {
      if (p.stream.prompt) send({ t: "portal_sync", id, prompt: p.stream.prompt, status: p.stream.status });
      else send({ t: "portal_added", id });
    }
    if (state.focusId) send({ t: "focus", id: state.focusId });
    if (immersion.inside) send({ t: "immerse", id: immersion.portal.id });
    syncBuddy();
  },
  onMessage(m) {
    if (m.t === "direction") applyDirection(m);
    else if (m.t === "state") {
      state.roomState = m;
      // Someone else (the console, a co-narrator) named the world we were asking about.
      if (state.asking?.kind === "portal" && m.threads?.[state.asking.id]?.seed) clearAsk(true);
      showChoices(m.choices || []); // the focused window's options, plus the audience's ideas and votes
      if (m.focusId && m.focusId !== state.focusId && portals.has(m.focusId)) setFocus(m.focusId, false);
    } else if (m.t === "close_portal") closePortal(m.id);
    else if (m.t === "reset") resetLocal(m);
    else if (m.t === "open_portal") openInFront();
    else if (m.t === "takeover" && m.rid !== RID && !state.retired) retire();
  },
});

// ---------- Enter mixed reality ----------
const enterBtn = $("#enter");
// The start screen asks to use the camera on phones and computers (not in the headset's browser,
// which has the real see-through). Starting from this tap lets iPhones ask for motion access too.
function offerCamera(xrOk) {
  const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
  if (quest || !navigator.mediaDevices?.getUserMedia) return;
  const phone = CameraView.touch;
  const btn = Object.assign(document.createElement("button"), {
    id: "camEnter",
    textContent: phone ? "📷 Look through your camera" : "📷 Use your webcam",
    className: xrOk || !phone ? "ghost" : "",
  });
  btn.onclick = async () => {
    $("#overlay").hidden = true;
    await toggleCamera();
    if (camView.on) setButtonsHidden(false, false); // Talk, Step inside and the rest within reach
  };
  enterBtn.after(btn);
  const why = Object.assign(document.createElement("p"), {
    id: "camNote",
    textContent: phone
      ? "Your camera shows your real surroundings and the story's windows appear in them. Move your phone to look around. You'll be asked to allow the camera" +
        (typeof globalThis.DeviceOrientationEvent?.requestPermission === "function" ? " and motion." : ".")
      : "Your webcam fills the background and the windows float over it. You'll be asked to allow the camera.",
  });
  btn.after(why);
}

async function setupXR() {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  state.maxPortals = cfg.maxPortals || state.maxPortals;
  const xrOk = Boolean(navigator.xr) && (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
  offerCamera(xrOk);
  if (!xrOk) {
    // No mixed reality here: offer the desktop preview, and say where the real thing runs.
    enterBtn.textContent = "Explore the preview";
    enterBtn.className = CameraView.touch ? "ghost" : ""; // on a phone the camera is the main way in
    enterBtn.onclick = () => ($("#overlay").hidden = true);
    if (CameraView.touch) ($("#camNote") ?? $("#camEnter"))?.after(enterBtn); // camera first on a phone
    enterBtn.insertAdjacentHTML("afterend", `<p id="note">For full mixed reality, open this page in the Meta Quest browser.</p>`);
    return;
  }
  enterBtn.onclick = async () => {
    await ptt.init().catch(() => {}); // ask for the mic before going immersive
    if (listener.context.state === "suspended") listener.context.resume();
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["hand-tracking"],
    });
    renderer.xr.setReferenceSpaceType("local-floor");
    await renderer.xr.setSession(session);
    camView.stop(); // the headset (or phone AR) has its own see-through
    loco.start();
    $("#overlay").hidden = true;
    session.addEventListener("end", () => {
      immersion.reset();
      loco.stop();
      $("#overlay").hidden = false;
    });
    showTitle();
    // A world question that was waiting on the flat page is asked again, out loud.
    if (state.asking) setTimeout(() => state.asking && askWorld(state.asking.kind, state.asking.id), 7000);
    else if (!portals.size) setTimeout(() => guide(0), 4500);
    else state.guideStep = 2; // already mid-story (or a prepared demo): no tutorial
  };
}
setupXR();
document.addEventListener("click", () => listener.context.state === "suspended" && listener.context.resume());

// ---------- Loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const { portal } of portals.values()) portal.update(t);
  checkWalking();
  if (!renderer.xr.isPresenting && camView.update(camera, state.yaw)) state.yaw = headingOf(camera.quaternion);
  // Over the real world (headset, or the camera view) the step-inside world is drawn first, so the
  // windows' wall masks can't cut holes in it (see immersion.js).
  immersion.update(t, dt, { presenting: seeThrough() });
  backdrop.update(dt, { inside: immersion.active });
  // Moving around: only in a 3D world, not inside a window. Back to see-through puts you back
  // where your real room is, so windows line up with your walls again.
  loco.enabled = backdrop.on && !immersion.active && renderer.xr.isPresenting;
  if (!backdrop.on && backdrop.opacity === 0) loco.reset();
  loco.update(dt, locoRays());
  desktopWalk(dt);
  scene.background = backdrop.background(renderer.xr.isPresenting ? null : camView.on ? camView.texture : DESKTOP_BG);
  previewRoom.visible = !seeThrough() && !immersion.active && !backdrop.on;
  exitOrb.visible = immersion.inside && renderer.xr.isPresenting && !toolbar.collapsed;
  updateToolbar();
  gestures.update();
  updateResize();
  updateSides();
  updateStrokes();
  trail.update();
  updateCradle();
  buddy.highlight(renderer.xr.isPresenting && !buddy.held && aimedAtBuddy());
  buddy.update(dt);
  updateRipples();
  updateTitle();
  for (const { portal, stream } of portals.values()) {
    // The "hole in the wall" only makes sense over passthrough
    // ...nor over a 3D world background (there's no real wall to cut into).
    // It stays on while you step in and out (the world is drawn before it, so it can't cut holes there),
    // but not once you're fully inside: there it would hide the motes and Bonnie behind each window's frame.
    portal.mask.visible = seeThrough() && backdrop.opacity === 0 && !(immersion.inside && immersion.progress >= 1);
    if (state.guideStep === 0 && stream.status === "streaming") guide(1);
  }
  if (!renderer.xr.isPresenting) syncButtons();
  if (!renderer.xr.isPresenting) toastMesh.visible = false; // headset UI; on a flat screen the status bar does the job
  pollButtons();
  renderer.render(scene, camera);
});

// `?debug`: the app's objects on `window.lw`, for poking at it from the browser console.
if (new URLSearchParams(location.search).has("debug")) window.lw = { THREE, renderer, scene, camera, portals, immersion, backdrop, buddy, openInFront, stepInside, stepOut };
