// app/feedback.js: haptics, tones and the in-headset toast (flash).
import { Caption } from "../portal.js";
import { LAYER } from "../layers.js";
import { camera, listener, renderer, say } from "./stage.js";

export function buzz(strength = 0.6, ms = 90) {
  for (const src of renderer.xr.getSession()?.inputSources || []) src.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
}
// A short tone so a gesture is heard as well as seen (hands have no haptics; controllers also buzz).
const TONES = { talk: [660, 880], send: [880, 660], open: [392, 523, 784], close: [784, 523, 392], shake: [300, 220, 300, 220], whee: [523, 784, 1047], bounce: [160, 95], click: [1175], deny: [233, 196] };
export function chime(kind) {
  const ctx = listener.context;
  if (ctx.state !== "running") return;
  TONES[kind].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.07;
    o.type = kind === "shake" ? "triangle" : "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.18);
  });
}

// ---------- In-headset toast ----------
const toast = new Caption();
export const toastMesh = toast.mesh;
toastMesh.position.set(0, -0.32, -1.1);
toastMesh.renderOrder = LAYER.TOAST;
toastMesh.material.depthTest = false; // ...even when a window or its wall mask is nearer than the toast
toastMesh.scale.setScalar(0.5);
camera.add(toastMesh);
let toastTimer;
export function flash(text, ms = 3000) {
  say(text);
  toast.set(text, "status");
  toastMesh.visible = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMesh.visible = false), ms);
}
toastMesh.visible = false;
