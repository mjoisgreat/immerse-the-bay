// app/world.js: the room background (see-through / 3D world), locomotion, loading state.
import * as THREE from "three";
import { Backdrop } from "../backdrop.js";
import { CameraView } from "../cameraview.js";
import { splatQuality } from "../worlds.js";
import { Locomotion } from "../locomotion.js";
import { $, camera, renderer, scene } from "./stage.js";
import { WORLD_CYCLE, worldInfo } from "./config.js";
import { flash } from "./feedback.js";
import { targets, tmpMat } from "./xrinput.js";
import { closeWindow, getWindow } from "./portals.js";

// ---------- Room background: see-through (your real room) or a 3D world around you ----------
// The story windows are unaffected; stepping inside a window still shows its live video.
export const backdrop = new Backdrop(scene, renderer, camera);
export const loco = new Locomotion(renderer, camera, scene);
const aimRay = new THREE.Raycaster();
// Pointing rays of the controllers/hands, skipping any that point at a button, window or Bonnie.
export function locoRays() {
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
/** Where the world button takes you next (null = back to see-through). */
export function nextWorld() {
  if (!backdrop.on) return WORLD_CYCLE[0];
  const i = WORLD_CYCLE.indexOf(backdrop.worldId);
  return i >= 0 && i < WORLD_CYCLE.length - 1 ? WORLD_CYCLE[i + 1] : null;
}
/** The world button: cycles your room → the Moon → Stanford → your room. */
export async function toggleBackdrop() {
  if (backdrop.loading) return;
  const next = nextWorld();
  if (!next) {
    backdrop.hide();
    return flash("Back to your room.", 3000);
  }
  return loadWorld(next);
}
/** The menu's world entries: go to that world from wherever you are, or leave it if you are in it. */
export async function toggleWorld(id) {
  if (backdrop.loading) return;
  if (backdrop.worldId === id) {
    backdrop.hide();
    return flash("Back to your room.", 3000);
  }
  return loadWorld(id);
}
/** Which world is on, for the menu: "moon", "stanford" or null. */
export function worldKey() {
  return backdrop.worldId ? (backdrop.worldId === "moon" ? "moon" : "stanford") : null;
}
async function loadWorld(next) {
  // Going from one 3D world straight to another (the Moon <-> Stanford): the window stays behind, deleted.
  if (backdrop.on && backdrop.worldId !== next && getWindow()) {
    closeWindow();
    flash("The window closed behind you.", 3000);
  }
  const info = worldInfo(next);
  const quality = splatQuality(renderer);
  const light = next !== "moon" && quality === "low" && backdrop.worlds.hasLight(next) ? " (light version)" : "";
  showLoading(next === "moon" ? "Flying to the Moon…" : `Loading ${info.name}${light}…`, next === "moon" ? null : 0);
  const ok = await backdrop
    .show(next, {
      quality,
      onProgress: ({ stage, fraction }) =>
        stage === "download"
          ? showLoading(`Loading ${info.name}${light}… ${Math.round(fraction * 100)}%`, fraction)
          : showLoading(`Building the world${light}… hold still, this can take a moment.`),
    })
    .catch(() => false);
  showLoading("");
  const how = renderer.xr.isPresenting
    ? "Walk, use the left thumbstick, or point at the ground and pinch to jump there."
    : CameraView.touch
      ? "Drag to look around. Press Camera to see your real surroundings instead."
      : "Use W/A/S/D or the arrow keys to walk around.";
  const after = nextWorld();
  const then = after ? `Press ${worldInfo(after).label} to go there next, or keep pressing to return to your room.` : "Press See-through to return to your room.";
  flash(ok ? `You're standing ${info.on} ${info.name}. ${how} ${then}` : "Couldn't load the 3D world.", 9000);
}
