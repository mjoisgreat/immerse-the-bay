import * as THREE from "three";
import manifest from "../worlds/manifest.json";

// Pre-built 3D worlds (Gaussian splats) that replace the flat video when you step inside a
// portal whose scene one of them fits. The director picks the world; this file loads and
// places it. The splat renderer (Spark) is only downloaded when a world is first needed.
const WORLDS = new Map((manifest.worlds || []).map((w) => [w.id, w]));
const KEEP = 2; // loaded worlds kept in memory (the Quest has little to spare)

export class SplatWorlds {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.loaded = new Map(); // id -> Promise<Group | null>
    this.spark = null;
  }

  has(id) {
    return WORLDS.has(id);
  }

  /** Resolves to a Group holding the world (floor at y = 0, start point at the origin), or null. */
  load(id) {
    if (!WORLDS.has(id)) return Promise.resolve(null);
    if (!this.loaded.has(id)) {
      this.loaded.set(
        id,
        this._load(WORLDS.get(id)).catch((e) => {
          console.warn(`[worlds] ${id} failed to load:`, e);
          this.loaded.delete(id);
          return null;
        }),
      );
    }
    return this.loaded.get(id);
  }

  async _load(w) {
    const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
    if (!this.spark) {
      // A slightly tighter splat cutoff is the recommended setting for headsets.
      this.spark = new SparkRenderer({ renderer: this.renderer, maxStdDev: Math.sqrt(5) });
      this.spark.renderOrder = -5; // after the step-inside backdrop, before windows and buttons
      this.scene.add(this.spark);
    }
    const mesh = new SplatMesh({ url: w.spz, fileType: "spz", lod: true });
    await mesh.initialized;
    // Marble worlds are y-down and in their own units: flip upright, scale to metres, floor to y = 0.
    const scale = w.scale ?? 1;
    mesh.quaternion.set(1, 0, 0, 0);
    mesh.scale.setScalar(scale);
    mesh.position.set(w.offset?.[0] ?? 0, (w.ground ?? 0) + (w.offset?.[1] ?? 0), w.offset?.[2] ?? 0);
    mesh.opacity = 0;
    const holder = new THREE.Group();
    holder.rotation.y = THREE.MathUtils.degToRad(w.yaw ?? 0);
    holder.add(mesh);
    holder.userData = { id: w.id, mesh, title: w.title || w.id };
    return holder;
  }

  /** Frees worlds no open portal points at any more (beyond the few most recent). */
  prune(inUse) {
    const spare = [...this.loaded.keys()].filter((id) => !inUse.has(id));
    for (const id of spare.slice(0, Math.max(0, this.loaded.size - KEEP))) {
      this.loaded.get(id).then((h) => (h?.removeFromParent(), h?.userData.mesh.dispose()));
      this.loaded.delete(id);
    }
  }
}
