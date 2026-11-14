// Stereo test world (?test=1): stands in for an Orbis stream without spending credits.
//
// A small 3D scene is rendered to a hidden canvas and fed through the very same path as Orbis video
// (canvas -> MediaStream -> <video> -> VideoTexture -> depth model), from an eye-level camera with the
// 84 degree view the step-inside mode expects. Because the scene is real geometry, its exact depth is
// known too: `depthTexture` holds it in the encoding the relief shaders read, so the headset can be
// switched between the model's depth and the true depth. If true depth looks right and the model's
// doesn't, the model (or its lag) is the problem; if both look wrong, the rendering is.
import * as THREE from "three";
import { DEPTH_RANGE } from "./immersion.js";

const W = 1280, H = 720, FPS = 30;
const HFOV = 84; // must match immersion.js
const VFOV = (2 * Math.atan(Math.tan((HFOV / 2) * Math.PI / 180) * (H / W)) * 180) / Math.PI;
// Each window looks at the same world from a different spot.
const VIEWS = { A: [0, 0, 0], B: [-7, -14, -0.95], C: [6, -34, 2.5] }; // x, z, yaw

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Procedural textures give the depth model real surface detail to work with.
function canvasTexture(size, draw, repeat = 1) {
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size });
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
function speckle(g, n, r, colours, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colours[Math.floor(r() * colours.length)];
    g.fillRect(r() * size, r() * size, 1 + r() * 3, 1 + r() * 3);
  }
}
const tiles = () =>
  canvasTexture(512, (g, n) => {
    const r = rng(7);
    g.fillStyle = "#8f8676"; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 120 + Math.floor(r() * 40);
      g.fillStyle = `rgb(${v + 14},${v + 6},${v - 8})`;
      g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
    }
    speckle(g, 5000, r, ["rgba(40,34,28,.25)", "rgba(230,222,205,.2)"], n);
  }, 90);
const stone = () =>
  canvasTexture(256, (g, n) => {
    const r = rng(11);
    g.fillStyle = "#c9c1b3"; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 8; y++) { g.fillStyle = "rgba(70,62,52,.35)"; g.fillRect(0, y * 32, n, 2); }
    speckle(g, 2500, r, ["rgba(60,52,44,.22)", "rgba(255,250,240,.25)"], n);
  }, 1);
const wood = () =>
  canvasTexture(256, (g, n) => {
    const r = rng(23);
    g.fillStyle = "#8a5a2c"; g.fillRect(0, 0, n, n);
    for (let x = 0; x < 6; x++) { g.fillStyle = "rgba(40,22,8,.5)"; g.fillRect(x * 43, 0, 3, n); }
    g.strokeStyle = "rgba(40,22,8,.6)"; g.lineWidth = 8; g.strokeRect(4, 4, n - 8, n - 8);
    speckle(g, 1500, r, ["rgba(30,16,6,.25)", "rgba(220,170,110,.2)"], n);
  }, 1);

function buildWorld() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc4d6ea, 40, 320);
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x6b5a45, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
  sun.position.set(6, 10, 4);
  scene.add(sun);

  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    return m;
  };
  const lambert = (o) => new THREE.MeshLambertMaterial(o);

  // Sky: a gradient dome with a sun disc (unaffected by fog).
  add(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(vec3(0.82, 0.88, 0.95), vec3(0.25, 0.47, 0.82), pow(h, 0.55));
        c += vec3(1.0, 0.9, 0.7) * smoothstep(0.9965, 0.9985, dot(d, normalize(vec3(-0.35, 0.42, -0.84))));
        gl_FragColor = vec4(c, 1.0); }`,
    }),
    0, 0, 0,
  );

  const ground = add(new THREE.PlaneGeometry(600, 600), lambert({ map: tiles() }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;

  // An avenue of columns straight ahead: the classic receding depth cue.
  const stoneMat = lambert({ map: stone() });
  const column = new THREE.CylinderGeometry(0.34, 0.4, 4.4, 20), cap = new THREE.BoxGeometry(1, 0.3, 1);
  for (let z = -5; z > -90; z -= 6) for (const x of [-3.6, 3.6]) {
    add(column, stoneMat, x, 2.2, z);
    add(cap, stoneMat, x, 4.55, z);
    add(cap, stoneMat, x, 0.15, z);
  }
  // An arch across the avenue.
  add(new THREE.BoxGeometry(0.9, 6, 0.9), stoneMat, -2.4, 3, -17);
  add(new THREE.BoxGeometry(0.9, 6, 0.9), stoneMat, 2.4, 3, -17);
  add(new THREE.BoxGeometry(6.6, 1, 1.1), stoneMat, 0, 6.5, -17);

  // Close things, where stereo matters most.
  add(new THREE.BoxGeometry(0.6, 0.95, 0.6), stoneMat, -1.25, 0.475, -2.3, 0.3);
  add(new THREE.SphereGeometry(0.34, 32, 20), lambert({ color: 0xb8322a }), -1.25, 1.29, -2.3);
  add(new THREE.CylinderGeometry(0.05, 0.07, 3, 12), lambert({ color: 0x23272e }), 1.45, 1.5, -3.1);
  add(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), 1.45, 3.1, -3.1);
  const crate = new THREE.BoxGeometry(0.8, 0.8, 0.8), woodMat = lambert({ map: wood() });
  add(crate, woodMat, 2.1, 0.4, -5.2, 0.5);
  add(crate, woodMat, 2.5, 0.4, -6.3, 1.1);
  add(crate, woodMat, 2.25, 1.2, -5.8, 0.2);

  // Mid-distance clutter and trees either side.
  const r = rng(42);
  const trunk = new THREE.CylinderGeometry(0.18, 0.24, 2.2, 8), crown = new THREE.ConeGeometry(1.5, 4.2, 10);
  const trunkMat = lambert({ color: 0x5a3d24 }), leaves = [0x2f6b3a, 0x3d7d45, 0x27583a].map((c) => lambert({ color: c }));
  for (let i = 0; i < 70; i++) {
    const side = r() < 0.5 ? -1 : 1, x = side * (7 + r() * 45), z = 6 - r() * 130;
    const s = 0.8 + r() * 0.9;
    const t = add(trunk, trunkMat, x, 1.1 * s, z), c = add(crown, leaves[i % 3], x, (2.2 + 2.1) * s, z);
    t.scale.setScalar(s), c.scale.setScalar(s);
  }
  for (let i = 0; i < 24; i++) {
    const side = r() < 0.5 ? -1 : 1;
    add(crate, i % 3 ? woodMat : stoneMat, side * (4.8 + r() * 4), 0.4, -8 - r() * 60, r() * 3);
  }
  // Far mountains, so there is a true "infinity" layer.
  const hill = new THREE.ConeGeometry(1, 1, 7), hillMat = lambert({ color: 0x66788f });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2, d = 230 + r() * 90;
    const m = add(hill, hillMat, Math.cos(a) * d, 0, Math.sin(a) * d, r() * 3);
    m.scale.set(50 + r() * 45, 45 + r() * 80, 50 + r() * 45);
    m.position.y = m.scale.y / 2;
  }

  // Things that move, so depth has to keep up with the picture.
  const orb = add(new THREE.SphereGeometry(0.24, 28, 18), lambert({ color: 0x2f7fd6, emissive: 0x0a2040 }), 0, 1.5, -4);
  const walker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.9, 6, 14), lambert({ color: 0xd9a441 }));
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), lambert({ color: 0xe9c9a8 }));
  head.position.y = 1.55;
  walker.add(body, head);
  scene.add(walker);
  const animate = (t) => {
    orb.position.set(Math.sin(t * 0.5) * 2.3, 1.5 + Math.sin(t * 0.9) * 0.35, -4.2 + Math.cos(t * 0.5) * 2.2);
    walker.position.set(Math.sin(t * 0.22) * 5.5, 0, -9);
    walker.rotation.y = Math.cos(t * 0.22) > 0 ? Math.PI / 2 : -Math.PI / 2;
  };
  return { scene, animate };
}

// True depth, written in the relief shaders' encoding: 1 = NEAR, 0 = FAR and beyond (inverse depth between).
const depthMat = new THREE.ShaderMaterial({
  fog: false,
  side: THREE.DoubleSide,
  vertexShader: `varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vZ; void main(){
    float d = clamp((1.0 / max(vZ, 0.01) - ${(1 / DEPTH_RANGE.FAR).toFixed(6)}) / ${(1 / DEPTH_RANGE.NEAR - 1 / DEPTH_RANGE.FAR).toFixed(6)}, 0.0, 1.0);
    gl_FragColor = vec4(d, d, d, 1.0); }`,
});

export class TestStream extends EventTarget {
  constructor(id) {
    super();
    this.id = id;
    this.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    this.audioStream = null; // silent
    this.prompt = "";
    this.status = "idle";
    this.closed = false;
    this.last = -1;
  }

  _setStatus(status, detail = "") {
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: { status, detail } }));
  }

  /** Same contract as OrbisStream.start(); the prompt is ignored. */
  async start(prompt = "") {
    this.prompt = prompt || this.prompt;
    if (this.renderer || this.closed) return;
    const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(W, H, false);
    Object.assign(this, buildWorld());
    const [x, z, yaw] = VIEWS[this.id] || VIEWS.A;
    this.camera = new THREE.PerspectiveCamera(VFOV, W / H, 0.1, 700);
    this.home = { x, z, yaw };
    this.depthTarget = new THREE.WebGLRenderTarget(252, 140, { depthBuffer: true });
    this.depthTarget.texture.minFilter = this.depthTarget.texture.magFilter = THREE.LinearFilter;
    this.depthTarget.texture.generateMipmaps = false;
    this._render(0);
    this.video.srcObject = canvas.captureStream(FPS);
    this.video.play().catch(() => {});
    this.dispatchEvent(new Event("video"));
    this._setStatus("streaming");
  }

  steer(prompt) {
    this.prompt = prompt; // nothing to steer
  }

  /** Exact scene depth for the current frame (only kept current while update() is asked for it). */
  get depthTexture() {
    return this.depthTarget?.texture || null;
  }

  _render(t) {
    this.animate(t);
    const { x, z, yaw } = this.home;
    // Eye level, almost still: the same framing the director asks Orbis for inside a world.
    this.camera.position.set(x + Math.sin(t * 0.21) * 0.03, 1.6 + Math.sin(t * 0.33) * 0.008, z);
    this.camera.rotation.set(0, yaw + Math.sin(t * 0.17) * 0.006, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Call every frame. Draws the picture at 30 fps and, when `truth` is set, the matching depth map
   * with the app's own renderer (same GL context as the relief, so there is no pixel readback).
   */
  update(t, mainRenderer, truth = false) {
    if (!this.renderer || this.closed || t - this.last < 1 / FPS - 0.004) return;
    this.last = t;
    this._render(t);
    if (!truth || !mainRenderer) return;
    const xr = mainRenderer.xr.enabled, target = mainRenderer.getRenderTarget();
    mainRenderer.xr.enabled = false; // a plain off-screen pass, not a per-eye one
    this.scene.overrideMaterial = depthMat;
    const alpha = mainRenderer.getClearAlpha();
    mainRenderer.getClearColor(this._clear || (this._clear = new THREE.Color()));
    mainRenderer.setRenderTarget(this.depthTarget);
    mainRenderer.setClearColor(0x000000, 1); // nothing there (sky) = farthest
    mainRenderer.clear();
    mainRenderer.render(this.scene, this.camera);
    mainRenderer.setClearColor(this._clear, alpha);
    this.scene.overrideMaterial = null;
    mainRenderer.setRenderTarget(target);
    mainRenderer.xr.enabled = xr;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this._setStatus("closed");
    this.video.srcObject?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.depthTarget?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }

  closeOnUnload() {
    this.closed = true;
  }
}
