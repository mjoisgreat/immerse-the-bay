import * as THREE from "three";
import { CameraView, headingOf } from "./cameraview.js";
import { $, DESKTOP_BG, camera, listener, previewRoom, renderer, scene } from "./app/stage.js";
import { state } from "./app/state.js";
import { RID, ROOM, handlers, link, send, showPeople } from "./app/room.js";
import { updateJoinCard } from "./app/join.js";
import { onRtc } from "./app/livecast.js";
import { joinedLine, myName, startPresence, thisDeviceKind } from "./people.js";
import { flash, toastMesh } from "./app/feedback.js";
import { aimedAtBuddy, buddy, buddyChangesWorld, syncBuddy, updateCradle } from "./app/buddy.js";
import { openInFront, setButtonsHidden, setStartScreen, syncButtons, updateToolbar } from "./app/buttons.js";
import { camView, desktopWalk, seeThrough, toggleCamera } from "./app/desktop.js";
import { guide, showTitle, updateTitle } from "./app/guide.js";
import { closeAllStreams, closeWindow, getWindow, immersion, retire, stepInside, stepOut } from "./app/portals.js";
import { applyDirection, askWorld, clearAsk, resetLocal, showChoices, updateRipples } from "./app/story.js";
import { ptt, stopTalking } from "./app/talk.js";
import { trail } from "./app/trail.js";
import { heartsFor, updateHearts } from "./app/hearts.js";
import { updateSides } from "./app/wide.js";
import { backdrop, loco, locoRays, toggleWorld } from "./app/world.js";
import { WORLD_CYCLE } from "./app/config.js";
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
// (join.js, the invite card, imports only leaves and room.js; xrinput.js and buttons.js call it from functions.)
// (checked with a script that lists each module's top-level reads of imported bindings).

// The server link's callbacks (see app/room.js): they call into nearly every feature, so they are wired up here.
Object.assign(handlers, {
  async onOpen() {
    const r = await link.request({ t: "hello", role: "renderer", rid: RID });
    if (r.status === 403) return location.replace(`/watch.html?room=${ROOM}`); // someone claimed it first
    state.joined = true;
    send({ t: "here", kind: thisDeviceKind(), name: myName() }); // say "here" as soon as the room has accepted us
    const w = getWindow();
    if (w?.stream.prompt) send({ t: "window_sync", prompt: w.stream.prompt, status: w.stream.status });
    else if (w) send({ t: "window_opened" });
    if (immersion.inside) send({ t: "immerse", inside: true });
    syncBuddy();
  },
  onMessage(m) {
    if (m.t === "direction") applyDirection(m);
    else if (m.t === "state") {
      state.roomState = m;
      // Someone else (the console, a co-narrator) named the world we were asking about.
      if (state.asking?.kind === "window" && m.story?.seed) clearAsk(true);
      showChoices(m.choices || []); // the director's options, plus the audience's ideas and votes
      showPeople(m.people);
      updateJoinCard();
    } else if (m.t === "joined") {
      const line = joinedLine(m); // a friend arrived: the storyteller sees it (never for their own devices)
      if (line) flash(line, 4000);
    } else if (m.t === "rtc") onRtc(m); // a friend's watch page asking for (or answering) a live view
    else if (m.t === "close_window") closeWindow();
    else if (m.t === "reset") resetLocal(m);
    else if (m.t === "open_portal") openInFront();
    else if (m.t === "takeover" && m.rid !== RID && !state.retired) retire();
  },
});

// ---------- Enter mixed reality ----------
const enterBtn = $("#enter");
// The start screen's "More info" button: the hints, hidden until asked for.
$("#cheat-toggle").onclick = (e) => {
  const cheat = $("#cheat");
  cheat.hidden = !cheat.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!cheat.hidden));
  e.currentTarget.textContent = cheat.hidden ? "More info" : "Hide info";
};

// The start screen offers the camera on phones and computers (not in the headset's browser, which has the
// real see-through). Starting from this tap lets iPhones ask for motion access too.
function offerCamera(xrOk) {
  const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
  if (quest || !navigator.mediaDevices?.getUserMedia || $("#camEnter")) return;
  const phone = CameraView.touch;
  const btn = Object.assign(document.createElement("button"), {
    id: "camEnter",
    textContent: phone ? "📷 Look through your camera" : "📷 Use your webcam",
    className: "ghost", // secondary: on a phone the main way in is Stanford, on a computer the preview
  });
  btn.onclick = async () => {
    setStartScreen(false);
    await toggleCamera();
    if (camView.on) setButtonsHidden(false, false); // Talk, Step inside and the rest within reach
  };
  const why = Object.assign(document.createElement("p"), {
    id: "camNote",
    textContent: phone
      ? "Your camera shows your real surroundings and the story's windows appear in them. Move your phone to look around. You'll be asked to allow the camera" +
        (typeof globalThis.DeviceOrientationEvent?.requestPermission === "function" ? " and motion." : ".")
      : "Your webcam fills the background and the windows float over it. You'll be asked to allow the camera.",
  });
  if (phone && !xrOk) why.textContent = "Or see your real surroundings through your camera, with the story's windows in them. You can switch any time with the Camera button.";
  (($("#note") ?? enterBtn).after(btn), btn.after(why));
}

async function setupXR() {
    const xrOk = Boolean(navigator.xr) && (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
  if (!xrOk) {
    // No mixed reality here: offer the desktop preview, and say where the real thing runs.
    enterBtn.textContent = "Explore the preview";
    enterBtn.onclick = () => setStartScreen(false);
    if (CameraView.touch) {
      // On a phone you start at Stanford (the World button's Stanford world); the camera is one tap away.
      const stanford = WORLD_CYCLE.find((id) => id !== "moon") || "stanford-church";
      enterBtn.textContent = "🏛 Enter Stanford";
      enterBtn.onclick = () => (setStartScreen(false), setButtonsHidden(false, false), toggleWorld(stanford));
    }
    enterBtn.insertAdjacentHTML("afterend", `<p id="note">For full mixed reality, open this page in the Meta Quest browser.</p>`);
    return offerCamera(false);
  }
  offerCamera(true);
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
    setStartScreen(false);
    session.addEventListener("end", () => {
      immersion.reset();
      loco.stop();
      stopTalking();
      closeAllStreams();
      setStartScreen(true);
    });
    showTitle();
    // A world question that was waiting on the flat page is asked again, out loud.
    if (state.asking) setTimeout(() => state.asking && askWorld(state.asking.kind), 7000);
    else if (!getWindow()) setTimeout(() => guide(0), 4500);
    else state.guideStep = 2; // already mid-story (or a prepared demo): no tutorial
  };
}
setupXR();
// Say "here" to the room, so friends' pages and the invite card can show who is in it.
// Not before the room has accepted us (the server refuses it then: "room has no owner yet"); joining pings at once.
startPresence((m) => state.joined && send(m), { kind: thisDeviceKind(), getName: myName });
state.started = true; // every module has loaded: the background timers may run now
document.addEventListener("click", () => listener.context.state === "suspended" && listener.context.resume());

// ---------- Loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  getWindow()?.portal.update(t);
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
  updateToolbar();
  gestures.update();
  updateResize();
  updateSides();
  updateStrokes();
  trail.update();
  updateHearts();
  updateCradle();
  buddy.highlight(renderer.xr.isPresenting && !buddy.held && aimedAtBuddy());
  buddy.update(dt);
  updateRipples();
  updateTitle();
  const w = getWindow();
  if (w) {
    const { portal, stream } = w;
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
if (new URLSearchParams(location.search).has("debug")) window.lw = { THREE, renderer, scene, camera, getWindow, immersion, backdrop, buddy, buddyChangesWorld, heartsFor, ptt, camView, openInFront, stepInside, stepOut };
