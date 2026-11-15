// app/guide.js: title card, the first-time guide, and the how-to gesture card.
import * as THREE from "three";
import { GestureCard, buttonRows, gestureRows } from "../gesturecard.js";
import { TAGLINE } from "../presets.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { BUDDY } from "./config.js";
import { flash } from "./feedback.js";
import { speak } from "./talk.js";

// ---------- First-time guide: a title card and a narrator who teaches the controls ----------
export const NARRATOR = ["Narrator", "a warm, wise storyteller with a gentle voice, full of hushed wonder"];
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
export function showTitle() {
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
export function updateTitle() {
  if (!titleCard.visible) return;
  const t = (performance.now() - titleShownAt) / 1000;
  titleCard.material.opacity = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (6.5 - t) / 1.2));
  titleCard.position.y += 0.0004; // slow drift upward
  if (t > 6.5) titleCard.visible = false;
}

// Steps: open a window → tell the story → touch / step inside. Each is spoken once.
const GUIDE = [
  "Welcome, storyteller. Pinch the air and draw a square, like a window frame, to open your first window.",
  "A world is waking. Hold a thumbs up to your mouth like a microphone, and tell me what happens next. Lower it when you're done.",
  "Now part your hands like curtains, and step inside. Shake both hands to wipe a window away.",
];
export function guide(step) {
  if (step <= state.guideStep || state.retired) return;
  state.guideStep = step;
  flash(GUIDE[step], 9000);
  if (renderer.xr.isPresenting) speak(GUIDE[step], ...NARRATOR);
}

// The cheat sheet: every hand gesture, controller button and desktop key. It opens only from the menu's
// Cheat sheet entry, and closes when the menu closes or when you pinch it.
export const cheatSheet = new GestureCard(BUDDY.name, { rows: [...gestureRows(BUDDY.name), ...buttonRows()], title: "Cheat sheet", row: 66 });
scene.add(cheatSheet.mesh);
// Returns true so the menu stays open: the cheat sheet lives only while the menu does.
export function showCheatSheet() {
  cheatSheet.show(camera);
  return true;
}
renderer.xr.addEventListener("sessionend", () => cheatSheet.hide());
