import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { Portal, PORTAL_SIZE } from "./portal.js";
import { Immersion } from "./immersion.js";
import { Toolbar } from "./toolbar.js";
import { OrbisStream } from "./orbis.js";
import { PushToTalk } from "./voice.js";
import { createLink, speechHeaders } from "./link.js";
import { urlRoom, urlInvite, owned, lastOwnedRoom, newRoomCode, makeOwnerCreds, credFor, voterId } from "./identity.js";

const $ = (s) => document.querySelector(s);
const statusEl = $("#status");
const say = (t) => (statusEl.textContent = t);

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 0);
scene.add(camera);
const listener = new THREE.AudioListener();
camera.add(listener);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));

// Desktop preview room (hidden in mixed reality, where the real room shows through).
const previewRoom = new THREE.Group();
previewRoom.add(new THREE.GridHelper(20, 40, 0x334466, 0x1c2233));
scene.add(previewRoom);
scene.background = new THREE.Color(0x0b0e16);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Mic orb (follows your view; pinch or click and hold it to talk) ----------
const micOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.035, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0xffb36b, emissive: 0x442200, roughness: 0.3 }),
);
micOrb.position.set(-0.22, -0.2, -0.55);
micOrb.userData.mic = true;
camera.add(micOrb);

// Exit orb (blue, right side): only shown while you're inside a world. Pinch it to step back out.
const exitOrb = new THREE.Mesh(
  new THREE.TorusGeometry(0.028, 0.009, 16, 40),
  new THREE.MeshStandardMaterial({ color: 0x6aa8ff, emissive: 0x10264a, roughness: 0.3 }),
);
exitOrb.position.set(0.22, -0.2, -0.55);
exitOrb.userData.exit = true;
exitOrb.visible = false;
camera.add(exitOrb);

// ---------- Step inside ----------
const immersion = new Immersion(scene, camera, {
  audioContext: listener.context,
  onChange(id) {
    send({ t: "immerse", id }); // the director reframes that world as a first-person view
    buzz();
  },
});
function buzz(strength = 0.6, ms = 90) {
  for (const src of renderer.xr.getSession()?.inputSources || []) src.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
}
function stepInside(portal) {
  if (!portal || (immersion.inside && immersion.portal === portal)) return;
  setFocus(portal.id);
  immersion.enter(portal, [...portals.values()].find((p) => p.portal === portal)?.stream.video);
  flash(`You stepped into window ${portal.id}. Step back or press B/Y to leave.`, 5000);
}
function stepOut() {
  if (!immersion.inside) return;
  immersion.exit();
  flash("Back in your room.", 2000);
}

// ---------- Portals ----------
const portals = new Map(); // id -> { portal, stream }
let focusId = null;
let maxPortals = 3;
const LETTERS = "ABCDEF";

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

function openPortal(origin, dir) {
  if (portals.size >= maxPortals) return flash(`At most ${maxPortals} portals. Close one first.`);
  const id = nextId();
  const portal = new Portal(id, listener);
  placeInFront(portal.group, origin, dir);
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
  send({ t: "portal_added", id }); // server asks the director for this portal's first scene
}

function closePortal(id) {
  const p = portals.get(id);
  if (!p) return;
  if (immersion.portal === p.portal) immersion.reset();
  p.stream.close();
  p.portal.dispose();
  portals.delete(id);
  send({ t: "portal_removed", id });
  if (focusId === id) setFocus(portals.keys().next().value ?? null);
}

function setFocus(id, tell = true) {
  focusId = id;
  for (const [pid, p] of portals) p.portal.setFocused(pid === id);
  if (tell && id) send({ t: "focus", id });
}

const labelFor = (s) =>
  ({ connecting: "Opening a window…", retrying: "Waiting for a free world…", reconnecting: "Reconnecting…", closed: "" })[s] ??
  s;

addEventListener("pagehide", () => portals.forEach((p) => p.stream.closeOnUnload()));

// ---------- Room: each headset owns a private story room ----------
// Visiting with ?room=X: if this browser owns X, drive it; if X is unclaimed, claim it;
// otherwise it's someone else's story, so go and watch it instead (no takeovers).
async function resolveRoom() {
  let room = urlRoom || lastOwnedRoom() || newRoomCode();
  if (owned()[room]) return room;
  const who = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: "whoami", room, cred: credFor(room), voter: voterId }),
  })
    .then((r) => r.json())
    .catch(() => ({}));
  if (who.role === "none") {
    makeOwnerCreds(room);
    return room;
  }
  location.replace(`/watch.html?room=${room}${urlInvite ? `&invite=${urlInvite}` : ""}`);
  return new Promise(() => {}); // page is leaving
}
const ROOM = await resolveRoom();
history.replaceState(null, "", `?room=${ROOM}`);
showRoomCard();

function showRoomCard() {
  const c = owned()[ROOM];
  const origin = location.origin;
  $("#roominfo").innerHTML = `
    <div class="kv"><span>Your room</span><b>${ROOM}</b></div>
    <div class="kv"><span>Console code</span><b>${c.pin}</b></div>
    <p class="small">On a laptop, open <b>${origin}/console.html</b> and enter the room and code.
    Share <a href="/watch.html?room=${ROOM}" target="_blank">the watch link</a> with friends, or browse the
    <a href="/community.html" target="_blank">community</a>.</p>
    <button class="ghost" id="newroom">Start a new room</button>`;
  $("#newroom").onclick = () => location.replace(`/?room=${newRoomCode()}`);
}

// ---------- Server link ----------
// Identifies this page. If the owner opens the room on a second device/tab, the newest wins.
const RID = Math.random().toString(36).slice(2, 10);
let retired = false;
let roomState = null;
function send(m) {
  if (!retired) link.send({ ...m, rid: RID });
}
function retire(text = `Your room “${ROOM}” is now playing in another tab or device.`) {
  // Stop our streams so credits aren't spent twice.
  immersion.reset();
  for (const p of portals.values()) p.stream.close(), p.portal.dispose();
  portals.clear();
  focusId = null;
  retired = true;
  $("#overlay").hidden = false;
  $("#overlay .card").innerHTML = `<h1>Living Window</h1><p>${text}</p><button onclick="location.reload()">Take it back</button>`;
  renderer.xr.getSession()?.end();
  say(text);
}
const link = createLink(ROOM, {
  async onOpen() {
    const r = await link.request({ t: "hello", role: "renderer", rid: RID });
    if (r.status === 403) return location.replace(`/watch.html?room=${ROOM}`); // someone claimed it first
    for (const [id, p] of portals) {
      if (p.stream.prompt) send({ t: "portal_sync", id, prompt: p.stream.prompt, status: p.stream.status });
      else send({ t: "portal_added", id });
    }
    if (focusId) send({ t: "focus", id: focusId });
    if (immersion.inside) send({ t: "immerse", id: immersion.portal.id });
  },
  onMessage(m) {
    if (m.t === "direction") applyDirection(m);
    else if (m.t === "state") {
      roomState = m;
      if (m.focusId && m.focusId !== focusId && portals.has(m.focusId)) setFocus(m.focusId, false);
    } else if (m.t === "close_portal") closePortal(m.id);
    else if (m.t === "reset") resetLocal();
    else if (m.t === "takeover" && m.rid !== RID && !retired) retire();
  },
});

// Crowd Mode: the audience's top-voted line becomes the next story beat every 20 s.
setInterval(() => {
  if (retired || !roomState?.meta?.crowd || !roomState.suggestions?.length || !portals.size) return;
  send({ t: "use_suggestion", id: "top" });
  flash("The crowd has spoken…", 3000);
}, 20000);

// Keep the room marked "live" for the community page.
setInterval(() => !retired && send({ t: "heartbeat" }), 30000);

// Small snapshots of each portal so watchers and the gallery can see the story (no extra credits).
const snapCanvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 });
setInterval(() => {
  if (retired) return;
  const g = snapCanvas.getContext("2d");
  for (const [id, p] of portals) {
    const v = p.stream.video;
    if (p.stream.status !== "streaming" || v.readyState < 2) continue;
    g.drawImage(v, 0, 0, 320, 180);
    fetch("/api/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), id, data: snapCanvas.toDataURL("image/jpeg", 0.6) }),
    }).catch(() => {});
  }
}, 8000);

function applyDirection({ narration, updates }) {
  for (const u of updates) {
    const p = portals.get(u.portal_id);
    if (!p) continue;
    if (p.stream.status === "idle") p.stream.start(u.prompt);
    else p.stream.steer(u.prompt);
  }
  if (narration) {
    const target = portals.get(focusId) || portals.values().next().value;
    if (target) {
      target.portal._lastStory = narration;
      if (target.stream.status === "streaming") target.portal.setCaption(narration, "story");
    }
    flash(narration, 5000);
  }
}

// ---------- Voice ----------
const ptt = new PushToTalk();
let talking = false;
async function startTalking() {
  if (talking) return;
  try {
    await ptt.begin();
    talking = true;
    micOrb.material.emissive.set(0xff3300);
    micOrb.scale.setScalar(1.4);
    flash("Listening… let go when you're done", 60000);
  } catch (e) {
    flash(`Microphone unavailable: ${e.message}`);
  }
}
async function stopTalking() {
  if (!talking) return;
  talking = false;
  micOrb.material.emissive.set(0x442200);
  micOrb.scale.setScalar(1);
  flash("Thinking…", 20000);
  try {
    const text = await ptt.end(speechHeaders(ROOM));
    if (!text) return flash("Didn't catch that. Hold the orb and speak.");
    flash(`“${text}”`, 4000);
    send({ t: "utterance", text });
  } catch (e) {
    flash(e.message);
  }
}

// ---------- In-headset toast ----------
const toast = new Portal("toast"); // reuse the caption renderer only
const toastMesh = toast.group.children[2];
toast.group.remove(toastMesh);
toastMesh.position.set(0, -0.32, -1.1);
toastMesh.scale.setScalar(0.5);
camera.add(toastMesh);
let toastTimer;
function flash(text, ms = 3000) {
  say(text);
  toast.setCaption(text, "status");
  toastMesh.visible = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMesh.visible = false), ms);
}
toastMesh.visible = false;

// ---------- XR input: controllers and hands ----------
const raycaster = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();
const controllerFactory = new XRControllerModelFactory();
const handFactory = new XRHandModelFactory();

function targets() {
  const ui = immersion.inside ? [micOrb, exitOrb] : [micOrb];
  if (renderer.xr.isPresenting) ui.push(...toolbar.meshes);
  return [...ui, ...[...portals.values()].filter((p) => p.portal.group.visible).map((p) => p.portal.screen)];
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
  line.scale.z = 3;
  ctrl.add(line);
  ctrl.addEventListener("connected", (e) => (line.visible = !e.data.hand)); // hands have their own visuals
  ctrl.addEventListener("selectstart", () => onSelectStart(ctrl));
  ctrl.addEventListener("selectend", () => onSelectEnd(ctrl));
  ctrl.addEventListener("squeezestart", () => onSqueeze(ctrl));
  scene.add(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);

  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, "mesh"));
  scene.add(hand);
}

function onSelectStart(ctrl) {
  const ray = rayFrom(ctrl);
  const hit = raycaster.intersectObjects(targets(), false)[0];
  if (hit?.object.userData.mic) {
    ctrl.userData.talking = true;
    return startTalking();
  }
  if (hit?.object.userData.exit) return stepOut();
  if (hit?.object.userData.button) {
    ctrl.userData.button = hit.object.userData.button;
    return toolbar.press(ctrl.userData.button, ctrl);
  }
  const portal = hit?.object.userData.portal;
  if (portal) {
    setFocus(portal.id);
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
  openPortal(ray.origin.clone(), ray.direction.clone());
}

function onSelectEnd(ctrl) {
  if (ctrl.userData.button) {
    toolbar.release(ctrl.userData.button, ctrl);
    ctrl.userData.button = null;
  }
  if (ctrl.userData.talking) {
    ctrl.userData.talking = false;
    stopTalking();
  }
  const p = ctrl.userData.grabbed;
  if (p) {
    scene.attach(p.group);
    const eye = new THREE.Vector3();
    camera.getWorldPosition(eye);
    p.group.lookAt(eye.x, p.group.position.y, eye.z);
    ctrl.userData.grabbed = null;
  }
}

function onSqueeze(ctrl) {
  rayFrom(ctrl);
  const portal = raycaster.intersectObjects(targets(), false)[0]?.object.userData.portal;
  if (portal) closePortal(portal.id);
}

// A / X on Touch controllers = push-to-talk from anywhere. B / Y = step into the window you're
// pointing at (or the focused one), or step back out.
let buttonHeld = false, stepHeld = false;
function pollButtons() {
  const session = renderer.xr.getSession();
  if (!session) return;
  let pressed = false, step = null;
  session.inputSources.forEach((src, i) => {
    if (src.gamepad?.buttons?.[4]?.pressed) pressed = true;
    if (src.gamepad?.buttons?.[5]?.pressed) step = i;
  });
  if (pressed && !buttonHeld) startTalking();
  if (!pressed && buttonHeld) stopTalking();
  buttonHeld = pressed;
  if (step !== null && !stepHeld) {
    if (immersion.inside) stepOut();
    else {
      rayFrom(renderer.xr.getController(step));
      const aimed = raycaster.intersectObjects(targets(), false).find((h) => h.object.userData.portal);
      stepInside(aimed?.object.userData.portal || portals.get(focusId)?.portal);
    }
  }
  stepHeld = step !== null;
}

// Walking: step through a window's surface to go inside; walk back ~60 cm to come out.
// Pulling a grabbed window into your face also takes you in.
const eye = new THREE.Vector3(), local = new THREE.Vector3();
function checkWalking() {
  camera.getWorldPosition(eye);
  if (!renderer.xr.isPresenting) return;
  for (const { portal } of portals.values()) {
    const grabbedBy = [0, 1].map((i) => renderer.xr.getController(i)).find((c) => c.userData.grabbed === portal);
    if (grabbedBy) {
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

// ---------- Buttons (floating panel in the headset, bar at the bottom on desktop) ----------
function openInFront() {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  dir.y = Math.max(-0.2, Math.min(0.2, dir.y));
  openPortal(origin, dir.normalize());
}
function toggleStep() {
  if (immersion.inside) stepOut();
  else if (!portals.size) flash("Open a window first.");
  else stepInside(portals.get(focusId)?.portal || portals.values().next().value.portal);
}
function closeFocused() {
  const id = immersion.inside ? immersion.portal.id : focusId;
  if (id) closePortal(id);
  else flash("No window to close.");
}
// Reset asks twice (no pop-up dialogs in the headset): first tap arms it for 3 seconds.
let resetArmed = 0;
function resetPressed() {
  if (Date.now() < resetArmed) {
    resetArmed = 0;
    send({ t: "reset_story" });
    flash("Resetting the story…");
  } else {
    resetArmed = Date.now() + 3000;
    flash("Tap Reset again to start the story over (closes all windows).", 3000);
  }
}
// The server confirmed a reset: close everything and start fresh.
function resetLocal() {
  immersion.reset();
  for (const id of [...portals.keys()]) closePortal(id);
  flash("Story reset. Open a window to begin again.", 5000);
}

const toolbar = new Toolbar(camera, [
  { id: "talk", icon: "🎙", label: "Hold to talk", press: () => startTalking(), release: () => stopTalking() },
  { id: "new", icon: "＋", label: "New window", press: openInFront },
  { id: "step", icon: "🚪", label: "Step inside", press: toggleStep },
  { id: "close", icon: "✕", label: "Close window", press: closeFocused },
  { id: "reset", icon: "↺", label: "Reset story", press: resetPressed },
]);
scene.add(toolbar.group);
const hoverRay = new THREE.Raycaster();
function updateToolbar() {
  toolbar.group.visible = renderer.xr.isPresenting;
  if (!toolbar.group.visible) return;
  toolbar.update();
  const hits = [];
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    if (!c.visible && !c.parent) continue;
    tmpMat.identity().extractRotation(c.matrixWorld);
    hoverRay.ray.origin.setFromMatrixPosition(c.matrixWorld);
    hoverRay.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const h = hoverRay.intersectObjects(toolbar.meshes, false)[0];
    if (h) hits.push(h.object);
  }
  toolbar.hover(hits);
  syncButtons();
}
function syncButtons() {
  const armed = Date.now() < resetArmed;
  toolbar.set("talk", { state: talking ? "active" : "idle", label: talking ? "Listening…" : "Hold to talk" });
  toolbar.set("step", { label: immersion.inside ? "Step out" : "Step inside", icon: immersion.inside ? "↩" : "🚪" });
  toolbar.set("reset", { state: armed ? "warn" : "idle", label: armed ? "Tap again" : "Reset story" });
  bar.talk.classList.toggle("on", talking);
  bar.talk.textContent = talking ? "Listening…" : "Hold to talk";
  bar.step.textContent = immersion.inside ? "Step out" : "Step inside";
  bar.reset.textContent = armed ? "Click again to reset" : "Reset story";
  bar.reset.classList.toggle("warn", armed);
}

// Desktop bar.
const bar = Object.fromEntries([...document.querySelectorAll("#bar [data-act]")].map((b) => [b.dataset.act, b]));
bar.talk.addEventListener("pointerdown", (e) => (e.preventDefault(), startTalking()));
bar.talk.addEventListener("pointerup", () => stopTalking());
bar.talk.addEventListener("pointerleave", () => stopTalking());
bar.new.onclick = openInFront;
bar.step.onclick = toggleStep;
bar.close.onclick = closeFocused;
bar.reset.onclick = resetPressed;
bar.info.onclick = () => ($("#overlay").hidden = !$("#overlay").hidden);

// ---------- Desktop controls (for building and testing without the headset) ----------
let yaw = 0, pitch = 0, dragging = false, moved = 0;
renderer.domElement.addEventListener("pointerdown", (e) => ((dragging = true), (moved = 0)));
addEventListener("pointerup", (e) => {
  dragging = false;
  if (moved > 6 || renderer.xr.isPresenting || e.target !== renderer.domElement) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(targets(), false)[0];
  if (hit?.object.userData.exit) stepOut();
  else if (hit?.object.userData.portal) setFocus(hit.object.userData.portal.id);
  else if (!hit) openPortal(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
});
renderer.domElement.addEventListener("dblclick", (e) => {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  stepInside(raycaster.intersectObjects(targets(), false)[0]?.object.userData.portal);
});
addEventListener("pointermove", (e) => {
  if (!dragging) return;
  moved += Math.abs(e.movementX) + Math.abs(e.movementY);
  yaw -= e.movementX * 0.004;
  pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.004));
  camera.rotation.set(pitch, yaw, 0, "YXZ");
});
addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && e.target === document.body) (e.preventDefault(), startTalking());
  if (e.code === "Backspace" && focusId && e.target === document.body) closePortal(focusId);
  if (e.code === "KeyE" && e.target === document.body) immersion.inside ? stepOut() : stepInside(portals.get(focusId)?.portal);
  if (e.code === "Escape") stepOut();
});
addEventListener("keyup", (e) => e.code === "Space" && stopTalking());

// ---------- Enter mixed reality ----------
const enterBtn = $("#enter");
async function setupXR() {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  maxPortals = cfg.maxPortals || maxPortals;
  if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar").catch(() => false))) {
    enterBtn.textContent = "Desktop preview (open on Quest for MR)";
    enterBtn.disabled = true;
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
    scene.background = null;
    previewRoom.visible = false;
    $("#overlay").hidden = true;
    session.addEventListener("end", () => {
      immersion.reset();
      scene.background = new THREE.Color(0x0b0e16);
      previewRoom.visible = true;
      $("#overlay").hidden = false;
    });
    flash("Pinch at a wall to open a window. Hold the orange orb (or A/X) to tell the story. Walk through a window, or press B/Y, to step inside.", 9000);
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
  immersion.update(t, dt);
  previewRoom.visible = !renderer.xr.isPresenting && !immersion.active;
  exitOrb.visible = immersion.inside && renderer.xr.isPresenting;
  updateToolbar();
  if (!renderer.xr.isPresenting) syncButtons();
  micOrb.position.y = -0.2 + Math.sin(t * 2) * 0.004;
  // The orb and in-view caption are headset UI; on desktop, Space and the status bar do the job.
  micOrb.visible = renderer.xr.isPresenting;
  if (!renderer.xr.isPresenting) toastMesh.visible = false;
  pollButtons();
  renderer.render(scene, camera);
});
