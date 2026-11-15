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

/**
 * The world's own 360° panorama (Marble's pano) on an opaque dome at infinity, behind the splats.
 * In passthrough three.js clears to transparent whatever the background colour is, so without it
 * your real room shows through every gap and at the edge of the splat world.
 * Same tricks as the Moon's black sky: depth pinned to the far plane, drawn first in the opaque pass
 * (a custom blend still lets it fade there). The panorama is looked up per pixel from the view
 * direction: Marble's space is y-down, so the world's (x, y, z) is the pano's (x, -y, -z).
 */
async function skyDome(url) {
  const map = await new THREE.TextureLoader().loadAsync(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = false; // no mip seam where the longitude wraps around
  map.minFilter = THREE.LinearFilter;
  map.wrapS = THREE.RepeatWrapping;
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * (mat3(modelMatrix) * position), 1.0);
        clip.z = clip.w * 0.99999;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float opacity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(0.5 + atan(d.x, -d.z) / 6.28318530718, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359);
        gl_FragColor = vec4(texture2D(map, uv).rgb, opacity);
        #include <colorspace_fragment>
      }`,
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), m);
  dome.frustumCulled = false;
  dome.renderOrder = -40; // before the step-inside world (-30) and the windows' wall masks (-20)
  return dome;
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

  /** Whether the world has a light version (otherwise "low" quality loads the full one too). */
  hasLight(id) {
    return Boolean(WORLDS.get(id)?.spzLow);
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
    const sky = w.sky ? await skyDome(w.sky).catch((e) => (console.warn(`[worlds] ${w.id} sky:`, e), null)) : null;
    if (sky) holder.add(sky);
    // Backdrop fades `userData.mesh.opacity`: the splats and the sky behind them together.
    const fader = sky
      ? {
          get opacity() {
            return mesh.opacity;
          },
          set opacity(v) {
            mesh.opacity = v;
            sky.material.uniforms.opacity.value = v;
          },
          dispose() {
            mesh.dispose();
            sky.material.uniforms.map.value.dispose();
            sky.material.dispose();
            sky.geometry.dispose();
          },
        }
      : mesh;
    holder.userData = { id: w.id, mesh: fader, title: w.title || w.id };
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
