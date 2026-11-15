// app/trail.js: the glowing trail you leave while drawing a window.
import * as THREE from "three";
import { LAYER } from "../layers.js";
import { scene } from "./stage.js";

// The glowing trail you leave while drawing: gold dots that flash and fade when you let go.
export const trail = (() => {
  const MAX = 600;
  const pos = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const g = dot.getContext("2d"), grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,240,210,1)");
  grad.addColorStop(1, "rgba(255,180,100,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const mat = new THREE.PointsMaterial({
    size: 0.03, map: new THREE.CanvasTexture(dot), color: 0xffd08a, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = LAYER.DRAW_TRAIL;
  pts.visible = false;
  scene.add(pts);
  let n = 0, fadeFrom = 0;
  return {
    start(p) {
      n = 0;
      fadeFrom = 0;
      mat.color.set(0xffd08a);
      mat.opacity = 1;
      pts.visible = true;
      this.add(p);
    },
    add(p) {
      if (n >= MAX) return;
      pos.set(p, n * 3);
      n++;
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
    },
    end(ok) {
      mat.color.set(ok ? 0xfff0c0 : 0xff8a7a);
      fadeFrom = performance.now();
    },
    cancel() {
      pts.visible = false;
      n = 0;
    },
    update() {
      if (!fadeFrom) return;
      const k = (performance.now() - fadeFrom) / 700;
      mat.opacity = Math.max(0, 1 - k);
      mat.size = 0.03 * (1 + k * 0.6);
      if (k >= 1) (pts.visible = false), (fadeFrom = 0), (mat.size = 0.03);
    },
  };
})();
