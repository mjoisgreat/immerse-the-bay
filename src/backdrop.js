import * as THREE from "three";
import { SplatWorlds } from "./worlds.js";

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
  }

  get on() {
    return Boolean(this.worldId);
  }

  /** Shows a world around you (placed where you stand, facing the way you face). */
  async show(id = "stanford") {
    if (this.loading) return false;
    this.loading = true;
    try {
      const holder = await this.worlds.load(id);
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
