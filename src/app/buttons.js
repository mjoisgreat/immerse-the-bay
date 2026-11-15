// app/buttons.js: the headset menu (a small button that opens a list), the desktop bar and the phone dock.
import * as THREE from "three";
import { Toolbar, menuFor } from "../toolbar.js";
import { CameraView } from "../cameraview.js";
import { $, camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { BUDDY, WORLD_CYCLE, worldInfo } from "./config.js";
import { flash } from "./feedback.js";
import { send } from "./room.js";
import { buddy, toggleBuddy } from "./buddy.js";
import { camView, haptic, toggleCamera } from "./desktop.js";
import { cheatSheet, showCheatSheet } from "./guide.js";
import { hideJoinCard, showJoinCard } from "./join.js";
import { closePortal, immersion, openPortal, portals, stepInside, stepOut } from "./portals.js";
import { disarm, newStoryPressed, pickChoice, resetPressed } from "./story.js";
import { startTalking, stopTalking } from "./talk.js";
import { toggleWide } from "./wide.js";
import { backdrop, nextWorld, toggleBackdrop, toggleWorld, worldKey } from "./world.js";
import { tmpMat } from "./xrinput.js";

// ---------- The headset menu ----------
// A small round button in the lower left of your view. Point at it (controller or pinch) to open its list.
// The list depends on where you are (see menuFor in toolbar.js).
export const toolbar = new Toolbar(camera);
renderer.xr.addEventListener("sessionstart", () => toolbar.recenter());
scene.add(toolbar.group); // in the scene, not on the camera: it follows your gaze (see Toolbar.update)
const STANFORD = WORLD_CYCLE.find((id) => id !== "moon") || "stanford-church";
// ---------- Community: share this story so anyone can watch it, suggest and vote ----------
const isShared = () => Boolean(state.roomState?.meta?.shared);
export function toggleShare() {
  const on = !isShared();
  send({ t: "set_meta", shared: on });
  if (state.roomState) state.roomState.meta = { ...state.roomState.meta, shared: on }; // shown right away; the server confirms
  flash(
    on
      ? "Your story is on the community page now: anyone can watch, suggest what happens next and vote. Press again to stop sharing."
      : "Your story is private again (no longer on the community page).",
    6000,
  );
}
function openCommunity() {
  window.open("/community.html", "_blank", "noopener");
}

// What each menu entry does (made once; menuItems runs every frame in the headset).
const MENU_ACTS = {
  exitwin: stepOut,
  reset: resetPressed,
  stanford: () => void toggleWorld(STANFORD),
  "exit-stanford": () => void toggleWorld(STANFORD),
  moon: () => void toggleWorld("moon"),
  "exit-moon": () => void toggleWorld("moon"),
  wide: () => toggleWide(),
  share: () => toggleShare(),
  cheat: () => showCheatSheet(),
  invite: () => showJoinCard(),
  exitvr: () => renderer.xr.getSession()?.end(),
};
let menuKey = "", menuCache = [];
/** The menu's entries; rebuilt only when something they show changes (no per-frame garbage in the headset). */
function menuItems() {
  const now = { inside: immersion.inside, world: worldKey(), loading: backdrop.loading, armed: state.armed, wideOn: state.wideOn, shared: isShared() };
  const key = `${now.inside}|${now.world}|${now.loading}|${now.armed}|${now.wideOn}|${now.shared}`;
  if (key !== menuKey) {
    menuKey = key;
    menuCache = menuFor(now).map((e) => ({ ...e, press: MENU_ACTS[e.id] }));
  }
  return menuCache;
}
// How close (metres) a ray must pass to a menu item to zone in on it.
const MENU_ZONE = 0.03;
/**
 * The menu item a ray zones in on, if it points at the menu's face within MENU_ZONE of an item.
 * Returns { part, point } where point is the item's centre (where the pointer dot goes), or null.
 */
export function menuSnap(ray) {
  if (!renderer.xr.isPresenting || !toolbar.group.visible) return null;
  toolbar.group.updateMatrixWorld();
  const inv = toolbar.group.matrixWorld.clone().invert();
  const o = ray.origin.clone().applyMatrix4(inv);
  const d = ray.direction.clone().transformDirection(inv);
  if (Math.abs(d.z) < 1e-4) return null;
  const t = -o.z / d.z; // where the ray crosses the menu's face
  if (t <= 0) return null;
  const part = toolbar.nearestPart(o.addScaledVector(d, t), MENU_ZONE);
  return part ? { part, point: toolbar.group.localToWorld(part.position.clone()) } : null;
}
/** Any action other than a menu press (a window, Bonnie, talking, a gesture, a button) shuts the menu. */
export function closeMenu() {
  toolbar.setOpen(false);
}
/** Runs a menu part that was pointed at and pressed: a choice card, or a button or entry of the menu. */
export function pressMenuPart(part) {
  if (part.userData.choice !== undefined) return pickChoice(part.userData.choice);
  if (part.userData.button !== state.armed) disarm(); // any other button cancels a pending confirm
  toolbar.press(part.userData.button);
}
const hoverRay = new THREE.Raycaster();
export function updateToolbar() {
  toolbar.group.visible = renderer.xr.isPresenting;
  if (!toolbar.group.visible) return;
  toolbar.update();
  if (!toolbar.open) (cheatSheet.hide(), hideJoinCard()); // the cheat sheet and invite card close with the menu, however it was shut
  toolbar.setItems(menuItems());
  const hits = [];
  let point = null;
  const panel = toolbar.targets;
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    if (!c.visible && !c.parent) continue;
    tmpMat.identity().extractRotation(c.matrixWorld);
    hoverRay.ray.origin.setFromMatrixPosition(c.matrixWorld);
    hoverRay.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const h = hoverRay.intersectObjects(panel, false)[0];
    const snap = h ? null : menuSnap(hoverRay.ray);
    if (c.userData.isHand && c.userData.laser) c.userData.laser.visible = Boolean(h || snap); // a hand's laser shows only over the menu
    if (h) hits.push(h.object), (point ??= h.point);
    else if (snap) hits.push(snap.part), (point ??= snap.point);
  }
  toolbar.hover(hits);
  toolbar.pointAt(point);
  syncButtons();
}

// Hide / show the desktop bar and the phone dock's sheet state. In the headset the menu is always there;
// the palm and thumbstick click open and close its list.
const BAR_KEY = "lw:bar";
export function setButtonsHidden(on, remember = true) {
  document.body.classList.toggle("clean", on);
  if (remember) {
    try {
      localStorage.setItem(BAR_KEY, on ? "hidden" : "shown");
    } catch {}
  }
}
/** The start screen on or off. The bar and the dock show only once you are past it. */
export function setStartScreen(on) {
  $("#overlay").hidden = !on;
  $("#bar").hidden = on;
}

function openInFront() {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  dir.y = Math.max(-0.2, Math.min(0.2, dir.y));
  openPortal(origin, dir.normalize());
}
export { openInFront };
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

// Called every frame: the DOM is only touched when a label or state actually changed.
const setText = (el, text) => el.textContent !== text && (el.textContent = text);
const setClass = (el, name, on) => el.classList.contains(name) !== on && el.classList.toggle(name, on);
export function syncButtons() {
  const nw = nextWorld(), inside = immersion.inside;
  const resetLabel = state.armed === "reset" ? "Tap again to confirm" : "Reset story";
  const newLabel = state.armed === "newstory" ? "Tap again to confirm" : "New story";
  setText(bar.close, state.armed === "close" ? "Tap again to close" : "Close window");
  setClass(bar.close, "warn", state.armed === "close");
  setText(bar.world, nw ? worldInfo(nw).bar : "See-through");
  setText(bar.wide, state.wideOn ? "Wide view: on" : "Wide view");
  setClass(bar.wide, "on", state.wideOn);
  setText(bar.camera, camView.on ? "Camera: on" : "Camera");
  setClass(bar.camera, "on", camView.on);
  setText(bar.share, isShared() ? "🌐 Shared: on" : "🌐 Share story");
  setClass(bar.share, "on", isShared());
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
bar.info.onclick = () => setStartScreen($("#overlay").hidden);
bar.hide.onclick = () => setButtonsHidden(true);
bar.world.onclick = toggleBackdrop;
bar.wide.onclick = toggleWide;
bar.camera.onclick = toggleCamera;
bar.share.onclick = toggleShare;
bar.community.onclick = openCommunity;
bar.buddy.onclick = toggleBuddy;
bar.buddy.textContent = BUDDY.name;
setStartScreen(true); // the start screen first; the bar appears once you are past it
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
