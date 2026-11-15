// The Twitch vote, floating just above the storyteller's left wrist while chat is voting: the 5 options
// in a few words each, with live tallies. Run by the console (src/twitchpoll.js); this only shows it.
// No hand tracked: it rides above the left controller. On a flat screen it sits at the bottom left.
import * as THREE from "three";
import { LAYER } from "../layers.js";
import { camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { flash } from "./feedback.js";

const W = 640, ROW = 76, HEAD = 84, PAD = 18;
const H = HEAD + 5 * ROW + PAD;
const WIDTH = 0.17; // metres
const PURPLE = "#9146ff";

const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
const tex = new THREE.CanvasTexture(canvas);
tex.colorSpace = THREE.SRGBColorSpace;
const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(WIDTH, (WIDTH * H) / W),
  new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
);
mesh.renderOrder = LAYER.WRIST_POLL;
mesh.visible = false;
scene.add(mesh);

// Which controller grip is the left one (hands say so on their own, see gestures.js).
const grips = [0, 1].map((i) => {
  const g = renderer.xr.getControllerGrip(i);
  g.addEventListener("connected", (e) => ((g.userData.handedness = e.data.handedness), (g.userData.isHand = Boolean(e.data.hand))));
  g.addEventListener("disconnected", () => (g.userData.handedness = null));
  return g;
});
const hands = [0, 1].map((i) => renderer.xr.getHand(i));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  while (text.length > 1 && g.measureText(`${text}…`).width > max) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

function draw(poll, left) {
  const g = canvas.getContext("2d");
  const ideas = poll.ideas;
  const h = HEAD + ideas.length * ROW + PAD;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "rgba(14,10,24,0.86)";
  roundRect(g, 0, 0, W, h, 28);
  g.fill();
  g.strokeStyle = PURPLE;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = "#fff";
  g.font = "600 34px system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText("Chat votes", PAD + 6, HEAD / 2);
  g.textAlign = "right";
  g.fillStyle = left <= 5 ? "#ffb4b4" : "#c9b8ff";
  g.fillText(`${left}s`, W - PAD - 6, HEAD / 2);
  g.textAlign = "left";
  const total = Math.max(1, ideas.reduce((s, x) => s + x.votes, 0));
  const best = Math.max(0, ...ideas.map((x) => x.votes));
  ideas.forEach((x, i) => {
    const y = HEAD + i * ROW;
    const lead = best > 0 && x.votes === best;
    // the bar behind the row: its share of the votes
    g.fillStyle = lead ? "rgba(145,70,255,0.55)" : "rgba(255,255,255,0.10)";
    roundRect(g, PAD, y + 6, Math.max(ROW - 12, (W - 2 * PAD) * (x.votes / total)), ROW - 12, 14);
    g.fill();
    g.fillStyle = lead ? "#fff" : PURPLE;
    g.font = "700 34px system-ui, sans-serif";
    g.fillText(String(x.n), PAD + 16, y + ROW / 2);
    g.fillStyle = "#fff";
    g.font = `${lead ? 600 : 400} 32px system-ui, sans-serif`;
    g.fillText(fit(g, x.short, W - 2 * PAD - 150), PAD + 60, y + ROW / 2);
    g.textAlign = "right";
    g.font = "600 30px system-ui, sans-serif";
    g.fillText(String(x.votes), W - PAD - 16, y + ROW / 2);
    g.textAlign = "left";
  });
  // Only the used part of the canvas shows: fewer options make a shorter panel.
  tex.repeat.set(1, h / H);
  tex.offset.set(0, 1 - h / H);
  mesh.scale.set(1, h / H, 1);
  tex.needsUpdate = true;
}

const v = new THREE.Vector3(), eye = new THREE.Vector3();
/** Where the panel goes: above the left wrist (or left controller), else the other hand, else null. */
function anchor(out) {
  const byHand = (want) => hands.find((h) => h.userData.tracked && h.userData.handedness === want && h.joints?.wrist?.visible !== false && h.joints?.wrist);
  const hand = byHand("left") || byHand("right");
  if (hand) return hand.joints.wrist.getWorldPosition(out);
  const grip = grips.find((g) => g.userData.handedness === "left" && !g.userData.isHand) || grips.find((g) => g.userData.handedness && !g.userData.isHand);
  return grip ? grip.getWorldPosition(out) : null;
}

let key = "", lastStage = null, lastIdeas = [];
export function updateWristPoll() {
  const poll = state.roomState?.poll;
  const voting = poll?.stage === "vote" && poll.ideas?.length;
  // The vote just closed: say what chat picked (the line itself arrives with the director's answer).
  if (lastStage === "vote" && !voting && lastIdeas.length) {
    const best = Math.max(...lastIdeas.map((x) => x.votes));
    const top = lastIdeas.filter((x) => x.votes === best);
    if (top.length === 1) flash(`Chat picked: ${top[0].short}`, 4000);
  }
  lastStage = poll?.stage ?? null;
  lastIdeas = voting ? poll.ideas : [];
  if (!voting) return void (mesh.visible = false);

  const left = Math.max(0, Math.ceil((poll.ends - Date.now()) / 1000));
  const k = JSON.stringify([poll.ideas, left]);
  if (k !== key) (key = k), draw(poll, left);

  camera.getWorldPosition(eye);
  if (renderer.xr.isPresenting) {
    if (!anchor(v)) return void (mesh.visible = false);
    v.y += 0.06 + (WIDTH * mesh.scale.y * H) / W / 2; // its bottom edge a few cm above the wrist
  } else {
    // Flat screen: bottom left of the view, half a metre ahead.
    v.set(-0.2, -0.12, -0.5).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())).add(eye);
  }
  mesh.position.copy(v);
  mesh.lookAt(eye);
  mesh.visible = true;
}
