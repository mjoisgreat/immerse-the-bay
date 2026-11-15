// A window's rim of sparks, after the sorcerers' portals in the films but square: a white-hot band
// round the edge, streaks flung off where three "heads" race round it, and slow embers drifting down.
// Built on three.quarks (CPU-simulated, batched into a few draw calls for every window together).
import * as THREE from "three";
import {
  ApplyForce, BatchedRenderer, Bezier, ColorOverLife, ConstantColor, ConstantValue, Gradient, IntervalValue,
  ParticleSystem, PiecewiseBezier, RenderMode, SizeOverLife, SpeedOverLife, Vector3, Vector4,
} from "three.quarks";
import { LAYER } from "./layers.js";
import { rimAngleTable, rimRadius } from "./rimshape.js";

/** One renderer for every window's sparks: add it to the scene and call update(dt) each frame. */
export const sparkRenderer = new BatchedRenderer();

// A soft round glow with a hot core: the look of every spark (stretched into a streak when moving).
function glowTexture() {
  const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.25)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let material = null; // shared by all windows, so their sparks batch into the same draw calls
function sparkMaterial() {
  material ??= new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return material;
}

// Emits from the wobbly oval edge of the opening (rimshape.js), moving tangentially (clockwise) with some outward and
// toward-you spread. `heads` concentrate emission just behind points racing round the rim.
class RimEmitter {
  constructor({ w, h, heads = 0, headBias = 0, headSpeed = 0.3, out = [0, 0.2], z = [0, 0.2], back = 0.05 }) {
    Object.assign(this, { w, h, heads, headBias, headSpeed, out, z, back });
    this.type = "rim";
    this.phase = Math.random();
    this.reveal = 1; // the rim grows from the centre while the window opens
    this.time = 0; // the wobble's clock, kept in step with the picture's edge
    this.angleAt = rimAngleTable(w, h);
  }

  update(_system, dt) {
    this.phase = (this.phase + this.headSpeed * dt) % 1;
  }

  initialize(p) {
    let u;
    if (this.heads && Math.random() < this.headBias) {
      const k = Math.floor(Math.random() * this.heads);
      u = this.phase + k / this.heads - Math.random() ** 2 * this.back; // a tail just behind the head
    } else u = Math.random();
    u = ((u % 1) + 1) % 1;
    const { w, h, time } = this, a = this.angleAt(u), e = 0.002;
    const at = (ang) => {
      const r = rimRadius(ang, time, w, h);
      return [r * Math.cos(ang), r * Math.sin(ang)];
    };
    const [x, y] = at(a), p0 = at(a + e), p1 = at(a - e); // clockwise: from a+e towards a-e
    const tl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const tx = (p1[0] - p0[0]) / tl, ty = (p1[1] - p0[1]) / tl;
    const nx = -ty, ny = tx; // outward normal
    const jitter = (Math.random() - 0.5) * 0.01;
    p.position.set(x * this.reveal + nx * jitter, y * this.reveal + ny * jitter, 0.004);
    const o = this.out[0] + Math.random() * (this.out[1] - this.out[0]);
    const z = this.z[0] + Math.random() * (this.z[1] - this.z[0]);
    p.velocity.set(tx + nx * o, ty + ny * o, z).normalize().multiplyScalar(p.startSpeed);
  }

  toJSON() {
    return { type: "rim" };
  }

  clone() {
    return new RimEmitter(this);
  }
}

const v3 = (r, g, b) => new Vector3(r, g, b);
const curve = (a, b, c, d) => new PiecewiseBezier([[new Bezier(a, b, c, d), 0]]);

function system({ emitter, rate, life, speed, size, colors, alphas, sizeCurve, mode, stretch, gravity, drag }) {
  const emission = new ConstantValue(rate);
  const behaviors = [new ColorOverLife(new Gradient(colors, alphas)), new SizeOverLife(sizeCurve)];
  if (gravity) behaviors.push(new ApplyForce(new Vector3(0, -1, 0), new ConstantValue(gravity)));
  if (drag) behaviors.push(new SpeedOverLife(drag));
  const sys = new ParticleSystem({
    looping: true,
    duration: 5,
    worldSpace: true, // sparks keep flying where they were flung, even if the window is moved
    shape: emitter,
    startLife: new IntervalValue(...life),
    startSpeed: new IntervalValue(...speed),
    startSize: new IntervalValue(...size),
    startColor: new ConstantColor(new Vector4(1, 1, 1, 1)),
    emissionOverTime: emission,
    behaviors,
    material: sparkMaterial(),
    renderMode: mode,
    rendererEmitterSettings: stretch,
    renderOrder: LAYER.WINDOW_GLOW,
  });
  return { sys, emission, rate, emitter };
}

// White-hot to gold to orange to a dull red as each spark cools.
const HOT = [[v3(1, 1, 0.9), 0], [v3(1, 0.82, 0.4), 0.2], [v3(1, 0.45, 0.08), 0.55], [v3(0.75, 0.12, 0.02), 1]];

export class RimSparks {
  constructor(parent, w, h) {
    this.layers = [
      // The band: dense, short-lived, barely leaving the edge.
      system({
        emitter: new RimEmitter({ w, h, out: [-0.3, 0.6], z: [0, 0.3] }),
        rate: 3600, life: [0.15, 0.4], speed: [0.08, 0.3], size: [0.025, 0.055],
        colors: HOT, alphas: [[1, 0], [0.8, 0.4], [0, 1]], sizeCurve: curve(1, 0.8, 0.5, 0.2),
        mode: RenderMode.BillBoard,
      }),
      // Streaks: flung off tangentially behind the racing heads, slowing and falling as they cool.
      system({
        emitter: new RimEmitter({ w, h, heads: 3, headBias: 0.75, headSpeed: 0.28, out: [0.05, 0.7], z: [0, 0.6] }),
        rate: 520, life: [0.45, 1.2], speed: [0.7, 1.9], size: [0.009, 0.018],
        colors: HOT, alphas: [[1, 0], [1, 0.5], [0, 1]], sizeCurve: curve(1, 0.9, 0.6, 0.1),
        mode: RenderMode.StretchedBillBoard, stretch: { speedFactor: 4.5, lengthFactor: 1 } /* length = size × (speed × 4.5 + 1) */,
        gravity: 1.6, drag: curve(1, 0.6, 0.4, 0.3),
      }),
      // Embers: a few big soft ones drifting down from the rim.
      system({
        emitter: new RimEmitter({ w, h, out: [0.2, 1.2], z: [0, 0.5] }),
        rate: 35, life: [0.9, 1.8], speed: [0.05, 0.2], size: [0.02, 0.045],
        colors: [[v3(1, 0.6, 0.2), 0], [v3(0.9, 0.25, 0.05), 1]], alphas: [[0, 0], [0.7, 0.15], [0, 1]],
        sizeCurve: curve(0.6, 1, 0.8, 0.3), mode: RenderMode.BillBoard, gravity: 0.25,
      }),
    ];
    for (const { sys } of this.layers) {
      parent.add(sys.emitter);
      sparkRenderer.addSystem(sys);
    }
  }

  /** reveal 0..1 grows the rim from the centre; level scales emission (0 = stop, sparks die out). */
  set(reveal, level, time) {
    const opening = reveal < 1 ? 2.5 : 1; // a flurry while the window bursts open
    for (const l of this.layers) {
      l.emitter.reveal = reveal;
      l.emitter.time = time;
      l.emission.value = l.rate * level * opening;
    }
  }

  dispose() {
    for (const { sys } of this.layers) {
      sys.emitter.removeFromParent();
      sys.dispose();
    }
  }
}
