import * as THREE from "three";
import { SplatWorlds, markSplatSlow } from "./worlds.js";

// Room background: "see-through" (your real room, passthrough) or a pre-built 3D world (a
// Gaussian splat, e.g. Stanford's Main Quad) all around you, which you can walk around in.
// The story windows are untouched: they keep floating in front of you, and stepping inside a
// window still shows its live video (the world hides while you're inside and comes back after).
const FADE_S = 1.0;
const SKY = new THREE.Color(0x9fb4cc); // fills any gaps in the splat, so your room doesn't peek through

export class Backdrop {
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.camera = camera;
    this.worlds = new SplatWorlds(scene, renderer);
    this.worldId = null; // null = see-through
    this.holder = null;
    this.opacity = 0;
    this.loading = false;
    this.suppressed = false; // true while you're inside a window
    this.watchUntil = 0;
    this.lastFrame = 0;
    document.addEventListener("visibilitychange", () => (this.lastFrame = 0)); // a hidden tab is not a slow one
  }

  get on() {
    return Boolean(this.worldId);
  }

  /**
   * Shows a world around you (placed where you stand, facing the way you face).
   * `quality`: "high" or "low" (see worlds.js); `onProgress({ stage, fraction })` reports loading.
   */
  async show(id = "stanford", { quality = "high", onProgress } = {}) {
    if (this.loading) return false;
    this.loading = true;
    try {
      const holder = await this.worlds.load(id, { quality, onProgress });
      if (!holder) return false;
      if (this.holder && this.holder !== holder) this.holder.removeFromParent();
      const eye = this.camera.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
      // The world's start point under your feet; its yaw (from the manifest) plus the way you face.
      const baseYaw = holder.userData.baseYaw ?? (holder.userData.baseYaw = holder.rotation.y);
      holder.position.set(eye.x, 0, eye.z);
      holder.rotation.y = baseYaw + Math.atan2(-fwd.x, -fwd.z);
      this.scene.add(holder);
      this.holder = holder;
      this.worldId = id;
      // Watch the first half minute of the full version for frozen frames (see update).
      this.watchUntil = quality === "high" ? performance.now() + 30000 : 0;
      this.lastFrame = 0;
      return true;
    } finally {
      this.loading = false;
    }
  }

  /** Back to your real room. */
  hide() {
    this.worldId = null;
  }

  /** Call every frame. `presenting`: in the headset. `inside`: you've stepped inside a window. */
  update(dt, { inside }) {
    this.suppressed = inside;
    // The full splat can hold the page for seconds while it first draws on weak hardware. If a
    // frame takes over 2 s, remember it so this device gets the light version next time.
    const now = performance.now();
    if (this.watchUntil && now < this.watchUntil && this.on && this.lastFrame && now - this.lastFrame > 2000 && !document.hidden) {
      markSplatSlow();
      this.watchUntil = 0;
    }
    this.lastFrame = now;
    const want = this.on && !inside ? 1 : 0;
    const step = dt / FADE_S;
    this.opacity = want > this.opacity ? Math.min(1, this.opacity + step) : Math.max(0, this.opacity - step);
    if (this.holder) {
      this.holder.userData.mesh.opacity = this.opacity;
      this.holder.visible = this.opacity > 0;
      if (!this.on && this.opacity === 0) this.holder.removeFromParent();
    }
  }

  /** The scene background to use: a sky colour once the world is fully in, else whatever it was. */
  background(fallback) {
    return this.opacity >= 1 ? SKY : fallback;
  }
}
