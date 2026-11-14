import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { Portal } from "./portal.js";
import { OrbisStream } from "./orbis.js";
import { PushToTalk } from "./voice.js";
import { createLink, ROOM } from "./link.js";

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
  const stream = new OrbisStream(id);
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

// ---------- Server link ----------
// Identifies this headset page. Only the newest headset in a room drives the streams.
const RID = Math.random().toString(36).slice(2, 10);
let retired = false;
let link = null;
function send(m) {
  if (!retired) link?.send({ ...m, rid: RID });
}
function retire() {
  // Another headset took over this room: stop our streams so credits aren't spent twice.
  for (const p of portals.values()) p.stream.close(), p.portal.dispose();
  portals.clear();
  focusId = null;
  retired = true;
  $("#overlay").hidden = false;
  $("#overlay .card").innerHTML =
    `<h1>Living Window</h1><p>Room “${ROOM}” is now playing on another headset.</p><button onclick="location.reload()">Take it back</button>`;
  renderer.xr.getSession()?.end();
  say("Another headset took over this room");
}
createLink({
  onOpen() {
    send({ t: "hello", role: "renderer" });
    for (const [id, p] of portals) {
      if (p.stream.prompt) send({ t: "portal_sync", id, prompt: p.stream.prompt, status: p.stream.status });
      else send({ t: "portal_added", id });
    }
    if (focusId) send({ t: "focus", id: focusId });
  },
  onMessage(m) {
    if (m.t === "direction") applyDirection(m);
    else if (m.t === "state") {
      if (m.focusId && m.focusId !== focusId && portals.has(m.focusId)) setFocus(m.focusId, false);
    } else if (m.t === "close_portal") closePortal(m.id);
    else if (m.t === "takeover" && m.rid !== RID && !retired) retire();
  },
}).then((l) => (link = l));

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
    const text = await ptt.end();
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
  return [micOrb, ...[...portals.values()].map((p) => p.portal.screen)];
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
  const portal = hit?.object.userData.portal;
  if (portal) {
    setFocus(portal.id);
    ctrl.attach(portal.group); // grab: the portal follows your hand until you let go
    ctrl.userData.grabbed = portal;
    return;
  }
  openPortal(ray.origin.clone(), ray.direction.clone());
}

function onSelectEnd(ctrl) {
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

// A / X button on Touch controllers = push-to-talk from anywhere.
let buttonHeld = false;
function pollButtons() {
  const session = renderer.xr.getSession();
  if (!session) return;
  let pressed = false;
  for (const src of session.inputSources) {
    const b = src.gamepad?.buttons?.[4];
    if (b?.pressed) pressed = true;
  }
  if (pressed && !buttonHeld) startTalking();
  if (!pressed && buttonHeld) stopTalking();
  buttonHeld = pressed;
}

// ---------- Desktop controls (for building and testing without the headset) ----------
let yaw = 0, pitch = 0, dragging = false, moved = 0;
renderer.domElement.addEventListener("pointerdown", (e) => ((dragging = true), (moved = 0)));
addEventListener("pointerup", (e) => {
  dragging = false;
  if (moved > 6 || renderer.xr.isPresenting || e.target !== renderer.domElement) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(targets(), false)[0];
  if (hit?.object.userData.portal) setFocus(hit.object.userData.portal.id);
  else if (!hit) openPortal(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
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
      scene.background = new THREE.Color(0x0b0e16);
      previewRoom.visible = true;
      $("#overlay").hidden = false;
    });
    flash("Pinch at a wall to open a window. Hold the orange orb (or A/X) to tell the story.", 8000);
  };
}
setupXR();
document.addEventListener("click", () => listener.context.state === "suspended" && listener.context.resume());

// ---------- Loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  for (const { portal } of portals.values()) portal.update(t);
  micOrb.position.y = -0.2 + Math.sin(t * 2) * 0.004;
  // The orb and in-view caption are headset UI; on desktop, Space and the status bar do the job.
  micOrb.visible = renderer.xr.isPresenting;
  if (!renderer.xr.isPresenting) toastMesh.visible = false;
  pollButtons();
  renderer.render(scene, camera);
});
