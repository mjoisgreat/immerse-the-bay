import * as THREE from "three";
import manifest from "../worlds/manifest.json";

// Pre-built 3D worlds (Gaussian splats) that replace the flat video when you step inside a
// portal whose scene one of them fits. The director picks the world; this file loads and
// places it. The splat renderer (Spark) is only downloaded when a world is first needed.
const WORLDS = new Map((manifest.worlds || []).map((w) => [w.id, w]));
const KEEP = 2; // loaded worlds kept in memory (the Quest has little to spare)

const SLOW_KEY = "lw:splatSlow";
const SLOW_MS = 8000;

/**
 * Which version of a splat world this device should load: "high" (the full file, with level of
 * detail) or "low" (about a third of the splats, see scripts/decimate-spz.mjs). Weak hardware
 * gets the light one: headsets and phones, software rendering, few cores or little memory, and
 * any device where the full version once took longer than 8 s to build or froze the picture for
 * more than 2 s while it appeared. `?splat=low` or
 * `?splat=high` in the address overrides it.
 */
export function splatQuality(renderer) {
  const forced = new URLSearchParams(location.search).get("splat");
  if (forced === "low" || forced === "high") return forced;
  try {
    if (localStorage.getItem(SLOW_KEY)) return "low";
  } catch {}
  let gpu = "";
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "");
  } catch {}
  const weak =
    /OculusBrowser|Quest|Android|Mobile/i.test(navigator.userAgent) ||
    /swiftshader|llvmpipe|software/i.test(gpu) ||
    (navigator.hardwareConcurrency || 8) <= 4 ||
    (navigator.deviceMemory || 8) <= 4;
  return weak ? "low" : "high";
}

/** The full version was too slow on this device: use the light one from now on. */
export function markSplatSlow() {
  try {
    localStorage.setItem(SLOW_KEY, "1");
  } catch {}
}

/** Downloads a file, reporting progress as a fraction (0..1). */
async function fetchBytes(url, onFraction) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = Number(r.headers.get("Content-Length")) || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const out = new Uint8Array(total);
  const reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > total) return new Uint8Array(await (await fetch(url)).arrayBuffer()); // length was wrong (compressed transfer)
    out.set(value, got);
    got += value.length;
    onFraction?.(got / total);
  }
  return got === total ? out : out.slice(0, got);
}

export class SplatWorlds {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.loaded = new Map(); // "id:quality" -> Promise<Group | null>
    this.spark = null;
  }

  has(id) {
    return WORLDS.has(id);
  }

  /**
   * Resolves to a Group holding the world (floor at y = 0, start point at the origin), or null.
   * `onProgress({ stage: "download", fraction })` then `({ stage: "build" })`.
   */
  load(id, { quality = "high", onProgress } = {}) {
    const w = WORLDS.get(id);
    if (!w) return Promise.resolve(null);
    const low = quality === "low" && Boolean(w.spzLow);
    const key = `${id}:${low ? "low" : "high"}`;
    if (!this.loaded.has(key)) {
      this.loaded.set(
        key,
        this._load(w, low, onProgress).catch((e) => {
          console.warn(`[worlds] ${id} failed to load:`, e);
          this.loaded.delete(key);
          return null;
        }),
      );
    }
    return this.loaded.get(key);
  }

  async _load(w, low, onProgress) {
    const bytes = await fetchBytes(low ? w.spzLow : w.spz, (fraction) => onProgress?.({ stage: "download", fraction }));
    onProgress?.({ stage: "build" });
    // Let the loading state reach the screen before the heavy part (a timer, not
    // requestAnimationFrame, which does not run on the page while a headset session is on).
    await new Promise((r) => setTimeout(r, 80));
    const started = performance.now();
    const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
    if (!this.spark) {
      // A slightly tighter splat cutoff is the recommended setting for headsets.
      this.spark = new SparkRenderer({ renderer: this.renderer, maxStdDev: Math.sqrt(5) });
      this.spark.renderOrder = -5; // after the step-inside backdrop, before windows and buttons
      this.scene.add(this.spark);
    }
    // The light version is small enough to draw whole: no level-of-detail tree to build.
    const mesh = new SplatMesh({ fileBytes: bytes, fileType: "spz", lod: !low });
    await mesh.initialized;
    if (!low && performance.now() - started > SLOW_MS) markSplatSlow();
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
