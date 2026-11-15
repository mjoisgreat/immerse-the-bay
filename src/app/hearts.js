// app/hearts.js: draw a heart (in the air, or with a finger) and Bonnie answers with hearts.
//
// A few hearts pop out of the spot where you drew it and float over to her; she hops, and a burst of
// heart emojis rises from her head while a big heart beats above her. Sprites from a small pool, no
// allocations per frame. See heartshape.js for how a heart is recognised.
import * as THREE from "three";
import { LAYER } from "../layers.js";
import { renderer, scene } from "./stage.js";
import { buddy, buddyInView, callBuddy } from "./buddy.js";
import { buzz, chime, flash } from "./feedback.js";

const POOL = 40;

/** A glossy heart emoji, drawn as a shape (the same on every device; emoji fonts differ). */
function heartTexture() {
  const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
  const g = c.getContext("2d");
  const heart = () => {
    g.beginPath();
    g.moveTo(64, 112);
    g.bezierCurveTo(18, 82, 6, 56, 10, 38);
    g.bezierCurveTo(14, 16, 44, 6, 64, 32);
    g.bezierCurveTo(84, 6, 114, 16, 118, 38);
    g.bezierCurveTo(122, 56, 110, 82, 64, 112);
    g.closePath();
  };
  g.shadowColor = "rgba(255,60,110,0.75)";
  g.shadowBlur = 14;
  const grad = g.createLinearGradient(20, 10, 100, 115);
  grad.addColorStop(0, "#ff7aa2");
  grad.addColorStop(0.55, "#ff2d55");
  grad.addColorStop(1, "#d10f3f");
  g.fillStyle = grad;
  heart();
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,0.55)"; // a little shine
  g.beginPath();
  g.ellipse(38, 36, 12, 7, -0.6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const tex = heartTexture();
const sprites = Array.from({ length: POOL }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.renderOrder = LAYER.SPEECH_BUBBLE;
  s.visible = false;
  s.userData = { kind: "", t0: 0, life: 1, size: 0.07, from: new THREE.Vector3(), mid: new THREE.Vector3(), to: new THREE.Vector3(), vel: new THREE.Vector3(), seed: 0 };
  scene.add(s);
  return s;
});
let next = 0;
const take = () => sprites[(next = (next + 1) % POOL)];
const tmp = new THREE.Vector3();

/** Above Bonnie's head (or `fallback` when she isn't around). */
function headTop(out, fallback) {
  if (!buddy.visible) return out.copy(fallback);
  return buddy.centerWorld(out).setY(buddy.root.position.y + buddy.height + 0.08);
}

/** You drew a heart around `at` ([x, y, z]): hearts fly to Bonnie, she hops, and more rise from her. */
export function heartsFor(at) {
  // On a phone or desktop she may be off screen: she hops into view first, so you see her catch them.
  if (buddy.ready && !buddyInView()) callBuddy();
  flash("❤️", 1500);
  const now = performance.now();
  const from = new THREE.Vector3().fromArray(at);
  const k = renderer.xr.isPresenting ? 1 : 1.7; // bigger on a flat screen, where she stands further away
  const top = headTop(new THREE.Vector3(), from.clone().add(new THREE.Vector3(0, 0.3, 0)));
  // 1. Six hearts pop out of your drawing and arc over to her.
  for (let i = 0; i < 6; i++) {
    const s = take(), u = s.userData;
    u.kind = "fly";
    u.t0 = now + i * 70;
    u.life = 900;
    u.size = 0.06 * k;
    u.from.copy(from).add(tmp.set((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.12, 0));
    u.to.copy(top).add(tmp.set((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1));
    u.mid.copy(u.from).lerp(u.to, 0.5).add(tmp.set(0, 0.35 + Math.random() * 0.2, 0));
    s.position.copy(u.from);
  }
  // 2. When they arrive: she hops and beams, a burst rises from her head, and a big heart beats above it.
  setTimeout(() => {
    const t = performance.now();
    const head = headTop(new THREE.Vector3(), top);
    if (buddy.visible) {
      buddy.gesture("jump");
      buddy.say("Aww! ❤️ I love you too!", 4000);
    }
    chime("love");
    buzz(0.4, 80);
    for (let i = 0; i < 12; i++) {
      const s = take(), u = s.userData;
      u.kind = "rise";
      u.t0 = t + i * 60;
      u.life = 1800 + Math.random() * 700;
      u.size = (0.045 + Math.random() * 0.04) * k;
      u.from.copy(head);
      u.vel.set((Math.random() - 0.5) * 0.25, 0.32 + Math.random() * 0.25, (Math.random() - 0.5) * 0.25).multiplyScalar(k);
      u.seed = Math.random() * 10;
      s.position.copy(head);
    }
    const big = take(), b = big.userData;
    b.kind = "beat";
    b.t0 = t;
    b.life = 2200;
    b.size = 0.2 * k;
    b.from.copy(head).add(tmp.set(0, 0.12 * k, 0));
    big.position.copy(b.from);
  }, 950);
}

/** Every frame. */
export function updateHearts() {
  const now = performance.now();
  for (const s of sprites) {
    const u = s.userData;
    if (!u.kind) continue;
    const t = (now - u.t0) / u.life;
    if (t < 0) {
      s.visible = false;
      continue;
    }
    if (t >= 1) {
      u.kind = "";
      s.visible = false;
      continue;
    }
    s.visible = true;
    let size = u.size, alpha = 1;
    if (u.kind === "fly") {
      // A curved hop from your drawing to her head (quadratic Bézier), popping in and shrinking on arrival.
      const a = 1 - t;
      s.position.set(0, 0, 0).addScaledVector(u.from, a * a).addScaledVector(u.mid, 2 * a * t).addScaledVector(u.to, t * t);
      size *= Math.min(1, t * 6) * (1 - 0.4 * t);
    } else if (u.kind === "rise") {
      const secs = (now - u.t0) / 1000;
      s.position.copy(u.from).addScaledVector(u.vel, secs);
      s.position.x += Math.sin(secs * 5 + u.seed) * 0.03; // a little sway as it floats up
      size *= Math.min(1, t * 8) * (1 + 0.3 * t);
      alpha = 1 - t * t;
    } else if (u.kind === "beat") {
      // Two heartbeats, then it fades.
      const secs = (now - u.t0) / 1000;
      const beat = Math.max(0, Math.sin(secs * Math.PI * 2.4)) ** 4;
      size *= Math.min(1, t * 7) * (1 + 0.22 * beat);
      alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    }
    s.scale.setScalar(size);
    s.material.opacity = alpha;
  }
}
