import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { Portal, PORTAL_SIZE } from "./portal.js";
import { Immersion } from "./immersion.js";
import { Toolbar } from "./toolbar.js";
import { HandGestures } from "./gestures.js";
import { Companion, BunnyRig, RobotRig } from "./companion.js";
import { Backdrop } from "./backdrop.js";
import { splatQuality } from "./worlds.js";
import { Locomotion } from "./locomotion.js";
import { OrbisStream } from "./orbis.js";
import { PushToTalk } from "./voice.js";
import { createLink, speechHeaders } from "./link.js";
import { PRESETS, TAGLINE } from "./presets.js";
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
// Key and rim light so the companion reads clearly against a dim room.
const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.8);
keyLight.position.set(1.5, 3, 2);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cc3ff, 1.2);
rimLight.position.set(-2, 2, -3);
scene.add(rimLight);

// Desktop preview room (hidden in mixed reality, where the real room shows through).
const previewRoom = new THREE.Group();
previewRoom.add(new THREE.GridHelper(20, 40, 0x334466, 0x1c2233));
scene.add(previewRoom);
const DESKTOP_BG = new THREE.Color(0x0b0e16);
scene.background = DESKTOP_BG;

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
    // Tuck the buttons away inside a world for an unobstructed view; bring them back on leaving.
    if (id && !toolbar.collapsed) (toolbar.setCollapsed(true), (autoHidden = true));
    else if (!id && autoHidden) (toolbar.setCollapsed(false), (autoHidden = false));
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

/**
 * Opens a window. Every window is its own story, so unless a world was chosen ahead of time
 * (New story, Prepare demo, the console) it asks "what world is behind this window?".
 */
function openPortal(origin, dir) {
  if (portals.size >= maxPortals) return flash(`At most ${maxPortals} portals. Close one first.`);
  const hasWorld = Boolean(pendingSeed || roomState?.nextSeed);
  pendingSeed = "";
  if (roomState) roomState.nextSeed = "";
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
  send({ t: "portal_added", id }); // with a world chosen ahead, the server asks the director for its first scene
  if (hasWorld) clearAsk();
  else askWorld("portal", id);
}

function closePortal(id) {
  const p = portals.get(id);
  if (!p) return;
  if (immersion.portal === p.portal) immersion.reset();
  p.stream.close();
  p.portal.dispose();
  portals.delete(id);
  if (asking?.id === id) clearAsk();
  send({ t: "portal_removed", id });
  if (focusId === id) setFocus(portals.keys().next().value ?? null);
}

function setFocus(id, tell = true) {
  focusId = id;
  for (const [pid, p] of portals) p.portal.setFocused(pid === id);
  if (tell && id) send({ t: "focus", id });
  refreshCards(); // idea cards say which window they will steer
}

const labelFor = (s) =>
  ({ asking: ASK.portal, connecting: "Opening a window…", retrying: "Waiting for a free world…", reconnecting: "Reconnecting…", closed: "" })[s] ??
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
{
  // Normalise the address to this room, keeping other settings such as ?companion=pip.
  const q = new URLSearchParams(location.search);
  q.set("room", ROOM);
  q.delete("invite");
  history.replaceState(null, "", `?${q}`);
}
showRoomCard();

function showRoomCard() {
  const c = owned()[ROOM];
  const origin = location.origin;
  $("#roominfo").innerHTML = `
    <div class="kv"><span>Your room</span><b>${ROOM}</b></div>
    <div class="kv"><span>Console code</span><b>${c.pin}</b></div>
    <p class="small">On a laptop, open <b>${origin}/console.html</b> and enter the room and code.
    Put the <a href="/theater.html?room=${ROOM}" target="_blank">theater view</a> on a big screen, share
    <a href="/watch.html?room=${ROOM}" target="_blank">the watch link</a> with friends, or browse the
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
    syncBuddy();
  },
  onMessage(m) {
    if (m.t === "direction") applyDirection(m);
    else if (m.t === "state") {
      roomState = m;
      // Someone else (the console, a co-narrator) named the world we were asking about.
      if (asking?.kind === "portal" && m.threads?.[asking.id]?.seed) clearAsk(true);
      showChoices(m.choices || []); // the focused window's options, plus the audience's ideas and votes
      if (m.focusId && m.focusId !== focusId && portals.has(m.focusId)) setFocus(m.focusId, false);
    } else if (m.t === "close_portal") closePortal(m.id);
    else if (m.t === "reset") resetLocal(m);
    else if (m.t === "open_portal") openInFront();
    else if (m.t === "takeover" && m.rid !== RID && !retired) retire();
  },
});

// Crowd Mode: the audience's top-voted line becomes the next story beat every 20 s. The message
// names the idea and who suggested it: inside a world the cards are hidden, so this is the only
// place the storyteller sees a friend's idea arrive.
setInterval(() => {
  if (retired || talking || wantTalk || asking || !roomState?.meta?.crowd || !roomState.suggestions?.length) return;
  if (!roomState.threads?.[focusId]?.seed) return; // the idea steers the focused window, which needs a world first
  const top = [...roomState.suggestions].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at)[0];
  roomState.suggestions = roomState.suggestions.filter((x) => x.id !== top.id);
  send({ t: "use_suggestion", id: top.id }); // by id, so the message names the idea actually used
  refreshCards();
  flash(`“${top.text}”, ${top.by ? `${top.by}'s idea` : "the crowd's pick"}`, 4000);
}, 20000);

// Keep the room marked "live" for the community page.
setInterval(() => !retired && send({ t: "heartbeat" }), 30000);

// Small snapshots of each portal so watchers and the gallery can see the story (no extra credits).
const snapCanvas = Object.assign(document.createElement("canvas"), { width: 480, height: 270 });
setInterval(() => {
  if (retired) return;
  const g = snapCanvas.getContext("2d");
  for (const [id, p] of portals) {
    const v = p.stream.video;
    if (p.stream.status !== "streaming" || v.readyState < 2) continue;
    g.drawImage(v, 0, 0, 480, 270);
    fetch("/api/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), id, data: snapCanvas.toDataURL("image/jpeg", 0.62) }),
    }).catch(() => {});
  }
}, 3000);

function applyDirection({ portal_id, narration, updates, choices, speech, companion }) {
  if (guideStep === 1 && roomState?.log?.some((l) => ["voice", "choice", "guest", "crowd"].includes(l.kind))) setTimeout(() => guide(2), 6000);
  showChoices(choices || []);
  // The companion and the story are one mind: the same answer may carry its reply. One voice at a time.
  const replied = Boolean(companion?.reply && buddy.visible);
  if (replied) buddyReply(companion, !narration);
  else if (buddy.listening) buddyIdle();
  if (speech?.line && !replied) playVoice(speech);
  for (const u of updates) {
    const p = portals.get(u.portal_id);
    if (!p) continue;
    if (p.stream.status === "idle") p.stream.start(u.prompt);
    else p.stream.steer(u.prompt);
  }
  if (narration) {
    // The line belongs to the window whose story it is, which may not be the focused one any more.
    const target = portals.get(portal_id) || portals.get(focusId) || portals.values().next().value;
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
let wantTalk = false; // the button is held (the mic may still be starting)
let talkingToBuddy = false;
async function startTalking() {
  if (talking || wantTalk) return;
  wantTalk = true;
  talkingToBuddy = buddy.isLookedAt(); // look at the companion while you talk and your words go to it
  if (talkingToBuddy) buddy.listen();
  try {
    await ptt.begin();
    if (!wantTalk) {
      // Released before the mic was ready: treat it as a cancelled press.
      await ptt.end({}).catch(() => {});
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return;
    }
    talking = true;
    micOrb.material.emissive.set(0xff3300);
    micOrb.scale.setScalar(1.4);
    flash("Listening… let go when you're done", 60000);
  } catch (e) {
    wantTalk = false;
    if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
    flash(`Microphone unavailable: ${e.message}`);
  }
}
async function stopTalking() {
  wantTalk = false;
  if (!talking) return;
  talking = false;
  micOrb.material.emissive.set(0x442200);
  micOrb.scale.setScalar(1);
  flash("Thinking…", 20000);
  try {
    const text = await ptt.end(speechHeaders(ROOM));
    if (!text) {
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return flash("Didn't catch that. Hold the orb and speak.");
    }
    if (asking) {
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return answerWorld(text);
    }
    flash(`“${text}”`, 4000);
    // Everything you say goes to the same mind: it steers the story and answers as the companion.
    // Looking at the companion while you talk tells it your words are meant for it.
    if (talkingToBuddy) {
      buddy.say("…", 15000);
      clearTimeout(buddyWait);
      buddyWait = setTimeout(() => buddy.listening && buddyIdle(), 30000); // no answer came back
      send({ t: "utterance", text, addressed: true });
    } else send({ t: "utterance", text });
  } catch (e) {
    if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
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
  if (renderer.xr.isPresenting) ui.push(...toolbar.targets);
  if (buddy.visible) ui.push(buddy.hitbox);
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
    if (ctrl.userData.button !== armed) disarm(); // any other button cancels a pending confirm
    return toolbar.press(ctrl.userData.button, ctrl);
  }
  if (hit?.object.userData.choice !== undefined) return pickChoice(hit.object.userData.choice);
  if (hit?.object.userData.companion) return toggleBuddyFollow();
  const portal = hit?.object.userData.portal;
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
  // Inside a world, pointing at it and pulling the trigger touches it.
  if (immersion.inside) return touchWorld(ray.origin.clone(), ray.direction.clone());
  // In a 3D world, pointing at the ground and pinching (or the trigger) teleports you there.
  const floor = loco.enabled && loco.floorHit(ray);
  if (floor) return loco.teleport(floor), buzz(0.3, 30);
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
  rayFrom(ctrl);
  const portal = raycaster.intersectObjects(targets(), false)[0]?.object.userData.portal;
  if (portal) closePortal(portal.id);
}

// A / X on Touch controllers = push-to-talk from anywhere. B / Y = step into the window you're
// pointing at (or the focused one), or step back out.
let buttonHeld = false, stepHeld = false, stickHeld = false;
function pollButtons() {
  const session = renderer.xr.getSession();
  if (!session) return;
  let pressed = false, step = null, stick = false;
  session.inputSources.forEach((src, i) => {
    if (src.gamepad?.buttons?.[4]?.pressed) pressed = true;
    if (src.gamepad?.buttons?.[5]?.pressed) step = i;
    if (src.gamepad?.buttons?.[3]?.pressed) stick = true;
  });
  if (stick && !stickHeld) setButtonsHidden(!toolbar.collapsed); // thumbstick click: hide / show buttons
  stickHeld = stick;
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

// ---------- Interaction: touch the world, pick what happens next, characters speak ----------
const touchCanvas = Object.assign(document.createElement("canvas"), { width: 512, height: 288 });
let lastTouch = 0;
function touchPortal(portal, uv, point) {
  const entry = [...portals.values()].find((x) => x.portal === portal);
  const v = entry?.stream.video;
  if (!v || entry.stream.status !== "streaming" || v.readyState < 2) return flash("This world is still forming…");
  if (performance.now() - lastTouch < 4000) return flash("The world is still answering your last touch…");
  lastTouch = performance.now();
  const g = touchCanvas.getContext("2d");
  g.drawImage(v, 0, 0, 512, 288);
  const x = uv.x * 512, y = (1 - uv.y) * 288;
  g.strokeStyle = "#ff3df0";
  g.shadowColor = "#ff3df0";
  g.shadowBlur = 12;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(x, y, 22, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  send({ t: "touch", id: portal.id, image: touchCanvas.toDataURL("image/jpeg", 0.75) });
  if (point) ripple(point);
  buzz(0.35, 40);
  flash("You reach into the world…", 6000);
}
function touchWorld(origin, dir) {
  const uv = immersion.uvFromDirection(dir);
  if (!uv) return flash("Nothing to touch there; reach toward the scene.");
  touchPortal(immersion.portal, uv, origin.addScaledVector(dir, 3));
}

// A glowing ring where you touched, expanding and fading.
const ripples = [];
function ripple(point) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.075, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  m.position.copy(point);
  m.lookAt(camera.getWorldPosition(new THREE.Vector3()));
  m.renderOrder = 15;
  m.userData.born = performance.now();
  scene.add(m);
  ripples.push(m);
}
function updateRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const m = ripples[i], age = (performance.now() - m.userData.born) / 900;
    m.scale.setScalar(1 + age * 4);
    m.material.opacity = Math.max(0, 1 - age);
    if (age >= 1) scene.remove(m), m.geometry.dispose(), m.material.dispose(), ripples.splice(i, 1);
  }
}

// "What happens next?" cards: the audience's top-voted ideas first (with who suggested them and
// how many votes they have), then the director's options, three cards at most. Friends playing
// along on their phones become visible to the storyteller, who picks with a pinch.
const MAX_CROWD_CARDS = 3;
let directorChoices = [];
let cards = []; // [{ kind: "crowd", id, text, by, votes } | { kind: "choice", index, text }]
let cardsKey = "";
function showChoices(list) {
  directorChoices = list || [];
  refreshCards();
}
function refreshCards() {
  const crowd = [...(roomState?.suggestions || [])]
    .sort((a, b) => b.voters.length - a.voters.length || a.at - b.at)
    .slice(0, MAX_CROWD_CARDS)
    // With more than one window open, each idea card says which window it will steer: the focused one.
    .map((x) => ({ kind: "crowd", id: x.id, text: x.text, by: x.by || "", votes: x.voters.length, to: portals.size > 1 ? focusId : null }));
  const director = directorChoices.map((text, index) => ({ kind: "choice", index, text }));
  const next = [...crowd, ...director].slice(0, 3);
  const key = JSON.stringify(next);
  if (key === cardsKey) return; // state arrives often; only redraw when something changed
  cardsKey = key;
  cards = next;
  toolbar.setChoices(cards.map((c) => (c.kind === "crowd" ? { text: c.text, by: c.by, votes: c.votes, to: c.to } : c.text)));
  const clean = (s) => String(s).replace(/[&<>"]/g, "");
  $("#choices").innerHTML = cards
    .map((c, i) =>
      c.kind === "crowd"
        ? `<button data-choice="${i}" class="crowd"><small>${clean(c.by || "A friend")} · ▲ ${c.votes}${c.to ? ` · → window ${clean(c.to)}` : ""}</small>${clean(c.text)}</button>`
        : `<button data-choice="${i}">${clean(c.text)}</button>`,
    )
    .join("");
}
function pickChoice(i) {
  const c = cards[i];
  if (!c) return;
  if (c.kind === "crowd") {
    // Hide it now; the server removes it and the director turns it into the next beat.
    if (!portals.has(focusId)) return flash("Open a window first: an idea steers the window you're looking at.");
    if (roomState) roomState.suggestions = (roomState.suggestions || []).filter((x) => x.id !== c.id);
    showChoices([]);
    send({ t: "use_suggestion", id: c.id });
    flash(`“${c.text}”${c.by ? `, ${c.by}'s idea` : ""}`, 4000);
  } else {
    showChoices([]);
    send({ t: "choose", index: c.index });
    flash(`“${c.text}”`, 4000);
  }
}
$("#choices").addEventListener("click", (e) => {
  const b = e.target.closest("[data-choice]");
  if (b) pickChoice(Number(b.dataset.choice));
});

// Characters speak their lines aloud, from their window (or all around you when you're inside it).
let voice = null;
let voiceEnd = null; // onEnd of the line playing now
async function playVoice({ speaker, line, voice: style, portal_id }) {
  const target = portals.get(portal_id) || portals.get(focusId);
  target?.portal.setCaption(`${speaker}: “${line}”`, "story");
  // From the character's window, or all around you when you're inside that world.
  const inside = immersion.inside && target && immersion.portal === target.portal;
  await speak(line, speaker, style, inside ? null : target?.portal.group);
}
/** Speaks a line in a character's voice, from `anchor` (an object in the room) or all around you. */
async function speak(line, speaker, style, anchor = null, { onStart, onEnd } = {}) {
  try {
    const r = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), text: line, speaker, voice: style }),
    });
    if (!r.ok) throw new Error(`voice ${r.status}`);
    const buf = await listener.context.decodeAudioData(await r.arrayBuffer());
    if (listener.context.state === "suspended") await listener.context.resume();
    // A new line interrupts the previous one; let its speaker know it stopped.
    const interrupted = voiceEnd;
    voiceEnd = null;
    voice?.stop?.();
    voice?.removeFromParent();
    interrupted?.();
    voice = anchor ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
    if (anchor) voice.setRefDistance(2), anchor.add(voice);
    else scene.add(voice);
    voice.setBuffer(buf);
    voice.setVolume(1.4);
    const mine = voice;
    voiceEnd = onEnd || null;
    voice.onEnded = () => {
      mine.isPlaying = false;
      if (voiceEnd === onEnd) voiceEnd = null;
      onEnd?.();
    };
    voice.play();
    onStart?.(buf.duration);
  } catch (e) {
    console.warn("[voice]", e.message);
    onEnd?.();
  }
}

// ---------- First-time guide: a title card and a narrator who teaches the controls ----------
const NARRATOR = ["Narrator", "a warm, wise storyteller with a gentle voice, full of hushed wonder"];
const titleCanvas = Object.assign(document.createElement("canvas"), { width: 1400, height: 520 });
{
  const g = titleCanvas.getContext("2d");
  const grad = g.createRadialGradient(700, 260, 20, 700, 260, 700);
  grad.addColorStop(0, "rgba(40,28,20,0.85)");
  grad.addColorStop(1, "rgba(10,12,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1400, 520);
  g.textAlign = "center";
  g.fillStyle = "#ffd08a";
  g.shadowColor = "#ff9a5a";
  g.shadowBlur = 40;
  g.font = "500 150px Georgia, serif";
  g.fillText("Living Window", 700, 250);
  g.shadowBlur = 0;
  g.fillStyle = "#f3ead8";
  g.font = "italic 52px Georgia, serif";
  g.fillText(TAGLINE, 700, 360);
}
const titleTex = new THREE.CanvasTexture(titleCanvas);
titleTex.colorSpace = THREE.SRGBColorSpace;
const titleCard = new THREE.Mesh(
  new THREE.PlaneGeometry(1.4, 0.52),
  new THREE.MeshBasicMaterial({ map: titleTex, transparent: true, depthWrite: false, opacity: 0 }),
);
titleCard.visible = false;
scene.add(titleCard);
let titleShownAt = 0;
function showTitle() {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  fwd.y = 0;
  fwd.normalize();
  titleCard.position.copy(eye).addScaledVector(fwd, 1.6);
  titleCard.position.y = eye.y + 0.1;
  titleCard.lookAt(eye.x, titleCard.position.y, eye.z);
  titleCard.visible = true;
  titleShownAt = performance.now();
}
function updateTitle() {
  if (!titleCard.visible) return;
  const t = (performance.now() - titleShownAt) / 1000;
  titleCard.material.opacity = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (6.5 - t) / 1.2));
  titleCard.position.y += 0.0004; // slow drift upward
  if (t > 6.5) titleCard.visible = false;
}

// Steps: open a window → tell the story → touch / step inside. Each is spoken once.
const GUIDE = [
  "Welcome, storyteller. Point at a wall and pinch, or pull the trigger, to open your first window.",
  "A world is waking. Raise your hand to your mouth, or hold the A button, and tell me what happens next.",
  "Now reach out and tap anything in the window to touch it. Or clap your hands, and step inside.",
];
let guideStep = -1;
function guide(step) {
  if (step <= guideStep || retired) return;
  guideStep = step;
  flash(GUIDE[step], 9000);
  if (renderer.xr.isPresenting) speak(GUIDE[step], ...NARRATOR);
}

// ---------- The companion (Bonnie, or Pip the robot with ?companion=pip) ----------
// It hops around your room, follows you, and talks with you. It is the story director's body in
// the room: what it says and does arrives with each direction (see applyDirection).
const USE_PIP = new URLSearchParams(location.search).get("companion") === "pip";
const BUDDY = USE_PIP
  ? { id: "pip", name: "Pip", icon: "🤖", voice: "a small, bright, curious robot companion; quick and playful, warm, a little mischievous" }
  : { id: "bunny", name: "Bonnie", icon: "🐰", voice: "a bright, friendly young voice; bubbly, quick and a little cheeky, full of wonder" };
const buddy = new Companion(scene, camera, { name: BUDDY.name, rig: USE_PIP ? new RobotRig() : new BunnyRig() });
buddy.load().catch((e) => console.warn("[companion] failed to load", e));
let buddyWait = 0;
/** Tells the story director whether its body is in the room, so it knows when it can speak here. */
function syncBuddy(present = buddy.visible) {
  send({ t: "companion", id: BUDDY.id, present: Boolean(present) });
}
function buddyIdle() {
  clearTimeout(buddyWait);
  buddy.react({ gesture: "none", move: "none" });
  buddy.say("");
}
/** The companion's part of a direction: gesture, maybe move, and say the line out loud. */
function buddyReply({ reply, gesture, move }, announce) {
  clearTimeout(buddyWait);
  buddy.react({ gesture, move });
  buddy.say(reply, 12000);
  if (announce) flash(`${BUDDY.name}: “${reply}”`, 9000);
  speak(reply, BUDDY.name, BUDDY.voice, buddy.root, {
    onStart: () => buddy.speaking(true),
    onEnd: () => buddy.speaking(false),
  });
}

// Pinch / point at the companion to toggle following you around.
function toggleBuddyFollow() {
  buddy.setFollowing(!buddy.following);
  buddy.gesture(buddy.following ? "thumbs_up" : "wave");
  buddy.say(buddy.following ? "Lead the way! I'm right beside you." : "Okay, I'll wait here!", 4000);
  flash(
    buddy.following ? `${BUDDY.name} is following you. Pinch ${BUDDY.name} again (or say “stay”) to stop.` : `${BUDDY.name} will stay here.`,
    5000,
  );
}
function toggleBuddy() {
  if (buddy.visible) return buddy.dismiss(), syncBuddy(false), flash(`${BUDDY.name} waves goodbye.`);
  if (!buddy.ready) return flash(`${BUDDY.name} is still waking up…`);
  const xr = renderer.xr.isPresenting;
  buddy.range = xr ? [1.2, 2.4] : [2.6, 3.4];
  buddy.comeDistance = xr ? 0.8 : 2.4;
  if (xr) buddy.summon(1.4);
  else {
    // On a flat screen: 3 m away and a slight downward tilt, so it and the windows stay in frame.
    buddy.summon(3.0);
    pitch = Math.min(pitch, -0.2);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }
  syncBuddy(true);
  buddy.say(`Hi! I'm ${BUDDY.name}. Talk to me any time!`, 6000);
  flash(`Meet ${BUDDY.name}! Say “${BUDDY.name}”, or look at ${BUDDY.name} while you talk, to chat. Pinch, or say “follow me”, and ${BUDDY.name} comes with you.`, 8000);
}

// ---------- Room background: see-through (your real room) or a 3D world around you ----------
// The story windows are unaffected; stepping inside a window still shows its live video.
const backdrop = new Backdrop(scene, renderer, camera);
const loco = new Locomotion(renderer, camera, scene);
const aimRay = new THREE.Raycaster();
// Pointing rays of the controllers/hands, skipping any that point at a button, window or Bonnie.
function locoRays() {
  if (!loco.enabled) return [];
  const hitTargets = targets();
  return [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    if (!c.visible) return null;
    tmpMat.identity().extractRotation(c.matrixWorld);
    aimRay.ray.origin.setFromMatrixPosition(c.matrixWorld);
    aimRay.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    return aimRay.intersectObjects(hitTargets, false).length ? null : aimRay.ray.clone();
  });
}
// A real loading state: the splat file is several MB and building it can hold the page for a
// while on weak hardware, so the download shows a percentage and the build says what is going on
// (painted before the heavy part starts; it cannot be updated while the page is busy).
function showLoading(text, fraction = null) {
  const el = $("#loading");
  el.hidden = !text;
  if (!text) return;
  $("#loadingText").textContent = text;
  el.classList.toggle("busy", fraction === null);
  $("#loadingBar").style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  flash(text, 120000); // in the headset the toast is the loading state
}
async function toggleBackdrop() {
  if (backdrop.on) {
    backdrop.hide();
    return flash("Back to your room.", 3000);
  }
  if (backdrop.loading) return;
  const quality = splatQuality(renderer);
  const light = quality === "low" ? " (light version)" : "";
  showLoading(`Loading Stanford's Main Quad${light}…`, 0);
  const ok = await backdrop
    .show("stanford", {
      quality,
      onProgress: ({ stage, fraction }) =>
        stage === "download"
          ? showLoading(`Loading Stanford's Main Quad${light}… ${Math.round(fraction * 100)}%`, fraction)
          : showLoading(`Building the world${light}… hold still, this can take a moment.`),
    })
    .catch(() => false);
  showLoading("");
  const how = renderer.xr.isPresenting
    ? "Walk, use the left thumbstick, or point at the ground and pinch to jump there."
    : "Use W/A/S/D or the arrow keys to walk around.";
  flash(ok ? `You're standing in Stanford's Main Quad. ${how} Press See-through to return to your room.` : "Couldn't load the 3D world.", 9000);
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
// ---------- The world question ----------
// "What world is this story set in?" (New story) and "What world is behind this window?" (every
// new window). Answer by voice (hold to talk) or by typing; skip it and the first thing you say
// defines the world instead. Nothing is ever taken from an earlier story.
const ASK = { story: "What world is this story set in?", portal: "What world is behind this window?" };
let asking = null; // { kind: "story" | "portal", id }
let pendingSeed = ""; // a world chosen ahead of time for the next window (also kept by the server)
function askWorld(kind, id = null) {
  asking = { kind, id };
  $("#askQ").textContent = ASK[kind];
  $("#ask").hidden = false;
  const xr = renderer.xr.isPresenting;
  if (id) portals.get(id)?.portal.setCaption(ASK.portal, "status");
  flash(`${ASK[kind]} ${xr ? "Raise a hand to your mouth, or hold A, and say it." : "Type it, or hold Space and say it."}`, 600000);
  if (xr) speak(ASK[kind], ...NARRATOR);
  else if ($("#overlay").hidden) $("#askText").focus();
}
function clearAsk(quiet = false) {
  if (!asking) return;
  asking = null;
  $("#ask").hidden = true;
  $("#askText").value = "";
  if (quiet) flash("", 1);
}
function answerWorld(text) {
  const a = asking;
  text = String(text || "").trim();
  if (!a || !text) return;
  clearAsk();
  flash(`“${text}”`, 5000);
  if (a.kind === "portal" && portals.has(a.id)) {
    portals.get(a.id).portal.setCaption("The world is forming…", "status");
    return send({ t: "set_seed", id: a.id, seed: text });
  }
  // A new story: its first window opens onto the world just named.
  for (const id of [...portals.keys()]) closePortal(id);
  send({ t: "set_seed", seed: text });
  pendingSeed = text;
  openInFront();
}
function skipWorld() {
  if (!asking) return;
  clearAsk();
  flash("No world chosen. The first thing you say will become the world.", 7000);
}
$("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  answerWorld($("#askText").value);
});
$("#askSkip").onclick = skipWorld;

// ---------- Reset and New story ----------
// One tap arms the button, which then reads "Tap again to confirm" until you do (or press any
// other button, or Esc). No timer: a toast that vanishes is easy to miss in the headset.
let armed = null; // "reset" | "newstory"
function confirmTap(what) {
  if (armed === what || !portals.size) return (armed = null), syncButtons(), true; // nothing open: nothing to lose
  armed = what;
  syncButtons(); // show the confirm state right away, not on the next frame
  flash(`This closes every window and forgets the story. Tap ${what === "reset" ? "Reset story" : "New story"} again to confirm.`, 600000);
  return false;
}
function disarm() {
  if (!armed) return;
  armed = null;
  syncButtons();
  flash("Cancelled.", 1500);
}
/** Reset: every window closes and every story, idea and seed is forgotten. */
function resetPressed() {
  if (!confirmTap("reset")) return;
  clearAsk();
  send({ t: "reset_story" });
  flash("Clearing the story…", 4000);
}
/** New story: a reset, then "what world is this story set in?". */
function newStoryPressed() {
  if (!confirmTap("newstory")) return;
  clearAsk();
  send({ t: "reset_story", ask: true });
  flash("Starting a new story…", 4000);
}
// The server confirmed a reset: close everything. Nothing of the old story is kept, its seed included.
function resetLocal({ ask = false, open = false, seed = "" } = {}) {
  armed = null;
  syncButtons();
  immersion.reset();
  clearAsk();
  showChoices([]);
  for (const id of [...portals.keys()]) closePortal(id);
  pendingSeed = seed;
  if (open) return openInFront(), flash(seed ? `A new story begins: ${seed}` : "A new story begins.", 6000);
  if (ask) return askWorld("story");
  flash(seed ? `New story: ${seed}. Open a window to begin.` : "Story cleared. Open a window to begin a new one.", 8000);
}

// ---------- Prepare demo ----------
// One tap before the headset goes on: a fresh story in a chosen world with its first window
// already opening, because a window needs 20-30 s to reach video.
let demoWatch = 0;
function prepareDemo(seed) {
  armed = null;
  clearAsk();
  send({ t: "reset_story", seed, open: true });
  const el = $("#demoStatus");
  const began = performance.now();
  clearInterval(demoWatch);
  demoWatch = setInterval(() => {
    const p = portals.values().next().value;
    const secs = Math.round((performance.now() - began) / 1000);
    if (p?.stream.status === "streaming") {
      clearInterval(demoWatch);
      el.textContent = `Demo ready: window ${p.portal.id} is live (took ${secs} s). Put the headset on and enter.`;
    } else el.textContent = `Preparing the demo… ${p ? labelFor(p.stream.status === "idle" ? "connecting" : p.stream.status) || "starting" : "resetting the room"} (${secs} s)`;
  }, 500);
}
$("#demoSeed").innerHTML =
  PRESETS.map(([label, seed]) => `<option value="${seed.replace(/"/g, "&quot;")}">${label}</option>`).join("") + `<option value="">Ask me (no world chosen)</option>`;
$("#demo").addEventListener("submit", (e) => {
  e.preventDefault();
  if (listener.context.state === "suspended") listener.context.resume();
  const seed = $("#demoSeed").value;
  if (seed) return prepareDemo(seed);
  // No world chosen: a clean room that asks for one.
  send({ t: "reset_story", ask: true });
  $("#demoStatus").textContent = "Room cleared. The headset will ask what world the story is set in.";
});

const toolbar = new Toolbar(camera, [
  { id: "talk", icon: "🎙", label: "Hold to talk", press: () => startTalking(), release: () => stopTalking() },
  { id: "new", icon: "＋", label: "New window", press: openInFront },
  { id: "step", icon: "🚪", label: "Step inside", press: toggleStep },
  { id: "close", icon: "✕", label: "Close window", press: closeFocused },
  { id: "buddy", icon: BUDDY.icon, label: BUDDY.name, press: toggleBuddy },
  { id: "world", icon: "🏛", label: "Stanford", press: toggleBackdrop },
  { id: "newstory", icon: "✨", label: "New story", press: newStoryPressed },
  { id: "reset", icon: "↺", label: "Reset story", press: resetPressed },
  { id: "hide", icon: "▾", label: "Hide buttons", press: () => setButtonsHidden(true) },
]);
// Hide / show the buttons (the orb and ring hide with them; A/X and B/Y still work).
// They start hidden (less to take in on a first visit: H, the ☰ handle, a thumbstick click or
// your left palm brings them out) and after that stay the way you last left them.
let autoHidden = false;
const BAR_KEY = "lw:bar";
function setButtonsHidden(on, remember = true) {
  toolbar.setCollapsed(on);
  autoHidden = false;
  document.body.classList.toggle("clean", on);
  if (remember) {
    try {
      localStorage.setItem(BAR_KEY, on ? "hidden" : "shown");
    } catch {}
  }
}
scene.add(toolbar.group);
const hoverRay = new THREE.Raycaster();
function updateToolbar() {
  toolbar.group.visible = renderer.xr.isPresenting;
  if (!toolbar.group.visible) return;
  toolbar.update();
  const hits = [];
  const panel = toolbar.targets;
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    if (!c.visible && !c.parent) continue;
    tmpMat.identity().extractRotation(c.matrixWorld);
    hoverRay.ray.origin.setFromMatrixPosition(c.matrixWorld);
    hoverRay.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const h = hoverRay.intersectObjects(panel, false)[0];
    if (h) hits.push(h.object);
  }
  toolbar.hover(hits);
  syncButtons();
}
function syncButtons() {
  toolbar.set("world", { label: backdrop.on ? "See-through" : "Stanford", icon: backdrop.on ? "👓" : "🏛" });
  bar.world.textContent = backdrop.on ? "See-through" : "Stanford Quad";
  toolbar.set("talk", { state: talking ? "active" : "idle", label: talking ? "Listening…" : "Hold to talk" });
  toolbar.set("step", { label: immersion.inside ? "Step out" : "Step inside", icon: immersion.inside ? "↩" : "🚪" });
  toolbar.set("reset", { state: armed === "reset" ? "warn" : "idle", label: armed === "reset" ? "Tap again to confirm" : "Reset story" });
  toolbar.set("newstory", { state: armed === "newstory" ? "warn" : "idle", label: armed === "newstory" ? "Tap again to confirm" : "New story" });
  toolbar.set("world", { state: backdrop.loading ? "active" : "idle" });
  bar.talk.classList.toggle("on", talking);
  bar.talk.textContent = talking ? "Listening…" : "Hold to talk";
  bar.step.textContent = immersion.inside ? "Step out" : "Step inside";
  bar.reset.textContent = armed === "reset" ? "Tap again to confirm" : "Reset story";
  bar.reset.classList.toggle("warn", armed === "reset");
  bar.newstory.textContent = armed === "newstory" ? "Tap again to confirm" : "New story";
  bar.newstory.classList.toggle("warn", armed === "newstory");
}

// Hand gestures: mic to the mouth, clap to step in or out, look at your left palm for the buttons.
function facingPortal() {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  let best = null, bestDot = 0.8;
  for (const { portal } of portals.values()) {
    const d = portal.group.getWorldPosition(new THREE.Vector3()).sub(eye).normalize().dot(gaze);
    if (d > bestDot) (best = portal), (bestDot = d);
  }
  return best;
}
const gestures = new HandGestures(renderer, camera, {
  "talk-start": startTalking,
  "talk-end": stopTalking,
  clap() {
    if (immersion.inside) return stepOut();
    const p = facingPortal() || portals.get(focusId)?.portal;
    if (p) stepInside(p);
    else flash("Open a window first, then clap to step inside.");
  },
  palm: () => setButtonsHidden(!toolbar.collapsed),
  firstSeen: () =>
    flash("Hands: raise a hand to your mouth to talk · clap to step inside · look at your left palm for the buttons.", 9000),
});

// Desktop bar.
const bar = Object.fromEntries([...document.querySelectorAll("#bar [data-act]")].map((b) => [b.dataset.act, b]));
bar.talk.addEventListener("pointerdown", (e) => (e.preventDefault(), startTalking()));
bar.talk.addEventListener("pointerup", () => stopTalking());
bar.talk.addEventListener("pointerleave", () => stopTalking());
bar.new.onclick = openInFront;
bar.step.onclick = toggleStep;
bar.close.onclick = closeFocused;
bar.reset.onclick = resetPressed;
bar.newstory.onclick = newStoryPressed;
// Any other button cancels a pending confirm (capture: runs before the button's own handler).
$("#bar").addEventListener("click", (e) => e.target.closest("[data-act]")?.dataset.act !== armed && disarm(), true);
bar.info.onclick = () => ($("#overlay").hidden = !$("#overlay").hidden);
bar.hide.onclick = () => setButtonsHidden(true);
bar.world.onclick = toggleBackdrop;
bar.buddy.onclick = toggleBuddy;
bar.buddy.textContent = BUDDY.name;
$("#showbar").onclick = () => setButtonsHidden(false);
$("#bar").hidden = false; // only clickable once everything is wired up
{
  let pref = null;
  try {
    pref = localStorage.getItem(BAR_KEY);
  } catch {}
  setButtonsHidden(pref !== "shown", false);
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
  if (hit?.object.userData.exit) stepOut();
  else if (hit?.object.userData.portal) {
    const p = hit.object.userData.portal;
    if (p.id === focusId) touchPortal(p, hit.uv, hit.point); // click the focused window to touch it
    else setFocus(p.id);
  } else if (immersion.inside) touchWorld(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
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
  if (e.code === "Space" && !e.repeat && !/INPUT|TEXTAREA/.test(e.target.tagName)) (e.preventDefault(), startTalking());
  if (e.code === "Backspace" && focusId && !/INPUT|TEXTAREA/.test(e.target.tagName)) closePortal(focusId);
  if (e.code === "KeyE" && !/INPUT|TEXTAREA/.test(e.target.tagName)) immersion.inside ? stepOut() : stepInside(portals.get(focusId)?.portal);
  if (e.code === "Escape") stepOut(), disarm(), skipWorld();
  if (e.code === "KeyH" && !/INPUT|TEXTAREA/.test(e.target.tagName)) setButtonsHidden(!toolbar.collapsed);
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") stopTalking();
  keysDown.delete(e.code);
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
function desktopWalk(dt) {
  if (renderer.xr.isPresenting) return;
  if (!backdrop.on) {
    // Back in the preview room: return to the starting spot once the world has faded out.
    if (backdrop.opacity === 0 && (camera.position.x || camera.position.z)) camera.position.set(0, 1.6, 0);
    return;
  }
  const f = (keysDown.has("KeyW") || keysDown.has("ArrowUp") ? 1 : 0) - (keysDown.has("KeyS") || keysDown.has("ArrowDown") ? 1 : 0);
  const r = (keysDown.has("KeyD") || keysDown.has("ArrowRight") ? 1 : 0) - (keysDown.has("KeyA") || keysDown.has("ArrowLeft") ? 1 : 0);
  if (!f && !r) return;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  camera.position.addScaledVector(fwd, f * 2 * dt).addScaledVector(right, r * 2 * dt);
}

// ---------- Enter mixed reality ----------
const enterBtn = $("#enter");
async function setupXR() {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  maxPortals = cfg.maxPortals || maxPortals;
  if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar").catch(() => false))) {
    // No mixed reality here: offer the desktop preview, and say where the real thing runs.
    enterBtn.textContent = "Explore the preview";
    enterBtn.onclick = () => ($("#overlay").hidden = true);
    enterBtn.insertAdjacentHTML("afterend", `<p id="note">To step into mixed reality, open this page in the Meta Quest browser.</p>`);
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
    loco.start();
    scene.background = null;
    previewRoom.visible = false;
    $("#overlay").hidden = true;
    session.addEventListener("end", () => {
      immersion.reset();
      loco.stop();
      scene.background = new THREE.Color(0x0b0e16);
      previewRoom.visible = true;
      $("#overlay").hidden = false;
    });
    showTitle();
    // A world question that was waiting on the flat page is asked again, out loud.
    if (asking) setTimeout(() => asking && askWorld(asking.kind, asking.id), 7000);
    else if (!portals.size) setTimeout(() => guide(0), 4500);
    else guideStep = 2; // already mid-story (or a prepared demo): no tutorial
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
  backdrop.update(dt, { inside: immersion.active });
  // Moving around: only in a 3D world, not inside a window. Back to see-through puts you back
  // where your real room is, so windows line up with your walls again.
  loco.enabled = backdrop.on && !immersion.active && renderer.xr.isPresenting;
  if (!backdrop.on && backdrop.opacity === 0) loco.reset();
  loco.update(dt, locoRays());
  desktopWalk(dt);
  scene.background = backdrop.background(renderer.xr.isPresenting ? null : DESKTOP_BG);
  previewRoom.visible = !renderer.xr.isPresenting && !immersion.active && !backdrop.on;
  exitOrb.visible = immersion.inside && renderer.xr.isPresenting && !toolbar.collapsed;
  updateToolbar();
  gestures.update();
  buddy.update(dt);
  updateRipples();
  updateTitle();
  for (const { portal, stream } of portals.values()) {
    // The "hole in the wall" only makes sense over passthrough, not inside a world.
    // ...nor over a 3D world background (there's no real wall to cut into).
    portal.mask.visible = renderer.xr.isPresenting && !immersion.active && backdrop.opacity === 0;
    if (guideStep === 0 && stream.status === "streaming") guide(1);
  }
  if (!renderer.xr.isPresenting) syncButtons();
  micOrb.position.y = -0.2 + Math.sin(t * 2) * 0.004;
  // The orb and in-view caption are headset UI; on desktop, Space and the status bar do the job.
  micOrb.visible = renderer.xr.isPresenting && !toolbar.collapsed;
  if (!renderer.xr.isPresenting) toastMesh.visible = false;
  pollButtons();
  renderer.render(scene, camera);
});
