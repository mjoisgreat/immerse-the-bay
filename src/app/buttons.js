// app/buttons.js: the toolbar, the desktop bar and the phone dock.
import * as THREE from "three";
import { Toolbar } from "../toolbar.js";
import { CameraView } from "../cameraview.js";
import { $, camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { BUDDY, WORLD_CYCLE, worldInfo } from "./config.js";
import { buzz, chime, flash } from "./feedback.js";
import { buddy, toggleBuddy } from "./buddy.js";
import { camView, haptic, toggleCamera } from "./desktop.js";
import { gestureCard } from "./guide.js";
import { closePortal, immersion, openPortal, portals, stepInside, stepOut } from "./portals.js";
import { disarm, newStoryPressed, resetPressed } from "./story.js";
import { startTalking, stopTalking } from "./talk.js";
import { toggleWide } from "./wide.js";
import { backdrop, nextWorld, toggleBackdrop } from "./world.js";
import { tmpMat } from "./xrinput.js";

// ---------- Buttons (floating panel in the headset, bar at the bottom on desktop) ----------
export function openInFront() {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  dir.y = Math.max(-0.2, Math.min(0.2, dir.y));
  openPortal(origin, dir.normalize());
}
function toggleStep() {
  if (immersion.inside) stepOut();
  else if (!portals.size) flash("Open a window first.");
  else stepInside(portals.get(state.focusId)?.portal || portals.values().next().value.portal);
}
function closeFocused() {
  const id = immersion.inside ? immersion.portal.id : state.focusId;
  if (id) closePortal(id);
  else flash("No window to close.");
}
/** The Close window button: asks for a second tap first (a window's story can't be brought back). */
function closePressed() {
  const id = immersion.inside ? immersion.portal?.id : state.focusId;
  if (!id) return flash("No window to close.");
  if (state.armed === "close") return (state.armed = null), syncButtons(), closeFocused();
  state.armed = "close";
  syncButtons();
  flash(`Tap Close window again to close window ${id}.`, 600000);
}
// Top row: what you do all the time, Talk in the middle. Bottom row: the rest, with the buttons that
// throw work away grouped at the far end (red, and they ask for a second tap). See toolbar.js.
export const toolbar = new Toolbar(
  camera,
  [
    { id: "new", icon: "＋", label: "New window", press: openInFront },
    { id: "step", icon: "🚪", label: "Step inside", press: toggleStep },
    { id: "talk", icon: "🎙", label: "Hold to talk", big: true, press: () => startTalking(), release: () => stopTalking() },
    { id: "buddy", icon: BUDDY.icon, label: `Call ${BUDDY.name}`, press: toggleBuddy },
    { id: "world", icon: worldInfo(WORLD_CYCLE[0]).icon, label: worldInfo(WORLD_CYCLE[0]).label, press: toggleBackdrop },
    { id: "hide", icon: "▾", label: "Hide", row: "more", press: () => setButtonsHidden(true) },
    { id: "wide", icon: "🔭", label: "Wide view", row: "more", press: toggleWide },
    { id: "newstory", icon: "✨", label: "New story", row: "more", danger: true, press: newStoryPressed },
    { id: "reset", icon: "↺", label: "Reset story", row: "more", danger: true, press: resetPressed },
    { id: "close", icon: "✕", label: "Close window", row: "more", danger: true, press: closePressed },
  ],
  {
    onPress: (id) => (chime("click"), buzz(id === "talk" ? 0.5 : 0.35, 25)),
    onDisabled: (why) => (chime("deny"), buzz(0.2, 40), flash(why, 3000)),
  },
);
// Hide / show the buttons (the exit ring hides with them; A/X and B/Y still work).
// They start hidden (less to take in on a first visit: H, the ☰ handle, a thumbstick click or
// your left palm brings them out) and after that stay the way you last left them.
const BAR_KEY = "lw:bar";
export function setButtonsHidden(on, remember = true) {
  toolbar.setCollapsed(on);
  state.autoHidden = false;
  document.body.classList.toggle("clean", on);
  if (remember) {
    try {
      localStorage.setItem(BAR_KEY, on ? "hidden" : "shown");
    } catch {}
  }
}
scene.add(toolbar.group);
const hoverRay = new THREE.Raycaster();
export function updateToolbar() {
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
    if (gestureCard.visible && hoverRay.intersectObject(gestureCard.closeButton, false).length) hits.push(gestureCard.closeButton);
  }
  if (toolbar.hover(hits)) buzz(0.12, 12); // a light tick as the pointer lands on a button
  gestureCard.hoverClose(hits.includes(gestureCard.closeButton));
  syncButtons();
}
// Called every frame: the DOM is only touched when a label or state actually changed.
const setText = (el, text) => el.textContent !== text && (el.textContent = text);
const setClass = (el, name, on) => el.classList.contains(name) !== on && el.classList.toggle(name, on);
export function syncButtons() {
  // The world button names where it takes you next.
  const nw = nextWorld(), inside = immersion.inside;
  const resetLabel = state.armed === "reset" ? "Tap again to confirm" : "Reset story";
  const newLabel = state.armed === "newstory" ? "Tap again to confirm" : "New story";
  toolbar.set("world", { label: nw ? worldInfo(nw).label : "See-through", icon: nw ? worldInfo(nw).icon : "👓", state: backdrop.loading ? "active" : "idle" });
  toolbar.set("wide", { state: state.wideOn ? "active" : "idle", label: state.wideOn ? "Wide: on" : "Wide view" });
  toolbar.set("talk", { state: state.talking ? "active" : "idle", label: state.talking ? "Listening…" : "Hold to talk" });
  toolbar.set("step", {
    label: inside ? "Step out" : "Step inside",
    icon: inside ? "↩" : "🚪",
    disabled: !inside && !portals.size,
    why: "Open a window first: press ＋ New window, or pinch and draw a square.",
  });
  const closable = Boolean(inside ? immersion.portal : state.focusId && portals.has(state.focusId));
  toolbar.set("close", {
    disabled: !closable,
    why: "No window to close.",
    state: state.armed === "close" ? "warn" : "idle",
    label: state.armed === "close" ? "Tap again" : "Close window",
  });
  setText(bar.close, state.armed === "close" ? "Tap again to close" : "Close window");
  setClass(bar.close, "warn", state.armed === "close");
  toolbar.set("reset", { state: state.armed === "reset" ? "warn" : "idle", label: resetLabel });
  toolbar.set("newstory", { state: state.armed === "newstory" ? "warn" : "idle", label: newLabel });
  setText(bar.world, nw ? worldInfo(nw).bar : "See-through");
  setText(bar.wide, state.wideOn ? "Wide view: on" : "Wide view");
  setClass(bar.wide, "on", state.wideOn);
  setText(bar.camera, camView.on ? "Camera: on" : "Camera");
  setClass(bar.camera, "on", camView.on);
  setText(bar.talk, state.talking ? "Listening…" : "Hold to talk");
  setClass(bar.talk, "on", state.talking);
  setText(bar.step, inside ? "Step out" : "Step inside");
  setText(bar.reset, resetLabel);
  setClass(bar.reset, "warn", state.armed === "reset");
  setText(bar.newstory, newLabel);
  setClass(bar.newstory, "warn", state.armed === "newstory");
  syncDock();
}

// Desktop bar.
const bar = Object.fromEntries([...document.querySelectorAll("#bar [data-act]")].map((b) => [b.dataset.act, b]));
bar.talk.addEventListener("pointerdown", (e) => (e.preventDefault(), startTalking()));
bar.talk.addEventListener("pointerup", () => stopTalking());
bar.talk.addEventListener("pointerleave", () => stopTalking());
bar.new.onclick = openInFront;
bar.step.onclick = toggleStep;
bar.close.onclick = closePressed;
bar.reset.onclick = resetPressed;
bar.newstory.onclick = newStoryPressed;
// Any other button cancels a pending confirm (capture: runs before the button's own handler).
$("#bar").addEventListener("click", (e) => e.target.closest("[data-act]")?.dataset.act !== state.armed && disarm(), true);
bar.info.onclick = () => ($("#overlay").hidden = !$("#overlay").hidden);
bar.hide.onclick = () => setButtonsHidden(true);
bar.world.onclick = toggleBackdrop;
bar.wide.onclick = toggleWide;
bar.camera.onclick = toggleCamera;
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

// ---------- Phone layout: a dock with the main actions, the rest in a "More" sheet ----------
// The desktop bar (buttons and handlers) moves into the sheet, so both stay one set of controls.
const MOBILE = CameraView.touch && !/OculusBrowser|Quest/i.test(navigator.userAgent);
const dock = Object.fromEntries([...document.querySelectorAll("#dock [data-dock]")].map((b) => [b.dataset.dock, b]));
const moreSheet = $("#moreSheet"), gestSheet = $("#gestSheet"), scrim = $("#scrim");
const GEST_KEY = "lw:gestures";
function openSheet(el) {
  closeSheets();
  el.classList.add("open");
  scrim.classList.add("open");
}
function closeSheets() {
  for (const el of [moreSheet, gestSheet]) el.classList.remove("open");
  scrim.classList.remove("open");
}
function showGestures() {
  openSheet(gestSheet);
  try {
    localStorage.setItem(GEST_KEY, "seen");
  } catch {}
}
scrim.onclick = closeSheets;
$("#gestBtn").onclick = showGestures;
$("#gestDone").onclick = closeSheets;
if (MOBILE) {
  document.body.classList.add("mobile");
  $("#sheetBody").append($("#bar"));
  setButtonsHidden(false, false); // the dock is the app's main controls: always there to start with
  dock.new.onclick = () => (haptic(), openInFront());
  dock.step.onclick = () => (haptic(), toggleStep());
  dock.buddy.onclick = () => (haptic(), toggleBuddy());
  dock.more.onclick = () => (haptic(), moreSheet.classList.contains("open") ? closeSheets() : openSheet(moreSheet));
  dock.talk.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dock.talk.setPointerCapture?.(e.pointerId); // keep listening while the finger slides a little
    haptic(25);
    startTalking();
  });
  for (const ev of ["pointerup", "pointercancel"]) dock.talk.addEventListener(ev, () => stopTalking());
  dock.talk.addEventListener("contextmenu", (e) => e.preventDefault());
  // A tap in the sheet does its thing and closes it, unless it's waiting for "tap again to confirm".
  $("#bar").addEventListener("click", (e) => {
    if (!e.target.closest("[data-act]")) return;
    haptic();
    setTimeout(() => !state.armed && closeSheets(), 0);
  });
  // The first time the app opens on a phone, show the touch gestures once.
  new MutationObserver(() => {
    let seen = null;
    try {
      seen = localStorage.getItem(GEST_KEY);
    } catch {}
    if ($("#overlay").hidden && !seen) setTimeout(showGestures, 900);
  }).observe($("#overlay"), { attributes: true, attributeFilter: ["hidden"] });
}
/** Dock labels follow the app's state (called with the other button syncing). */
function syncDock() {
  if (!MOBILE) return;
  const set = (b, icon, label, on) => {
    const [i, sp] = b.children;
    setText(i, icon);
    setText(sp, label);
    setClass(b, "on", Boolean(on));
  };
  set(dock.step, immersion.inside ? "↩" : "🚪", immersion.inside ? "Step out" : "Step in", immersion.inside);
  set(dock.talk, "🎙", state.talking ? "Listening…" : "Hold to talk", state.talking);
  set(dock.buddy, BUDDY.icon, BUDDY.name, buddy.visible);
}
