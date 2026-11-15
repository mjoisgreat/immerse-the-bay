import * as THREE from "three";
import { LAYER } from "./layers.js";

const W = 1.6, H = 0.9; // metres, 16:9 like Orbis output

// A wall around the opening that only writes depth: the real room (passthrough) hides what is behind
// so the picture looks cut into your wall.
function maskGeometry() {
  const outer = new THREE.Shape([
    new THREE.Vector2(-1.6, -1.2), new THREE.Vector2(1.6, -1.2), new THREE.Vector2(1.6, 1.2), new THREE.Vector2(-1.6, 1.2),
  ]);
  outer.holes.push(new THREE.Path([
    new THREE.Vector2(-W / 2, -H / 2), new THREE.Vector2(-W / 2, H / 2), new THREE.Vector2(W / 2, H / 2), new THREE.Vector2(W / 2, -H / 2),
  ]));
  return new THREE.ShapeGeometry(outer);
}

// Sparks that burst out of a window when it opens.
const burstVert = /* glsl */ `
attribute vec3 vel; attribute float seed;
uniform float age;
varying float vA;
void main() {
  float t = age * (0.7 + seed * 0.6);
  vec3 p = position + vel * (1.0 - exp(-t * 2.2)) + vec3(0.0, -0.12 * t * t, 0.0);
  vA = clamp(1.0 - t / 1.8, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (40.0 + 60.0 * seed) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const burstFrag = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.95, 0.8), a), a * a * vA);
}`;
function burstPoints() {
  const N = 260, pos = [], vel = [], seed = [];
  for (let i = 0; i < N; i++) {
    // Start on the rim of the opening, fly outward and toward the viewer.
    const t = Math.random() * 4, side = Math.floor(t), f = t - side;
    const p = [[-W / 2 + f * W, H / 2], [W / 2, H / 2 - f * H], [W / 2 - f * W, -H / 2], [-W / 2, -H / 2 + f * H]][side];
    pos.push(p[0], p[1], 0.01);
    const out = new THREE.Vector3(p[0], p[1], 0).normalize();
    vel.push(out.x * (0.15 + Math.random() * 0.35), out.y * (0.15 + Math.random() * 0.35), 0.15 + Math.random() * 0.6);
    seed.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("vel", new THREE.Float32BufferAttribute(vel, 3));
  g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  return g;
}

// The rim: a ring of sparks racing round the edge of the opening, flung off tangentially and falling
// (a sorcerer's portal, but square). Fully on the GPU: each point loops its own short life.
const rimVert = /* glsl */ `
attribute float seed; attribute vec3 rnd;
uniform float time; uniform float reveal; uniform float fade; uniform float focus;
varying float vHeat; varying float vA;
float h1(float x){ return fract(sin(x * 91.7) * 43758.5453); }
vec4 rim(float u){ // position and clockwise tangent at u (0..1) round the W x H rectangle
  float hw = ${(W / 2).toFixed(4)}, hh = ${(H / 2).toFixed(4)};
  float d = fract(u) * ${(2 * (W + H)).toFixed(4)};
  if (d < ${W.toFixed(4)}) return vec4(-hw + d, hh, 1.0, 0.0);
  d -= ${W.toFixed(4)};
  if (d < ${H.toFixed(4)}) return vec4(hw, hh - d, 0.0, -1.0);
  d -= ${H.toFixed(4)};
  if (d < ${W.toFixed(4)}) return vec4(hw - d, -hh, -1.0, 0.0);
  d -= ${W.toFixed(4)};
  return vec4(-hw, -hh + d, 0.0, 1.0);
}
void main(){
  bool ring = rnd.y < 0.72; // most hug the rim (the bright ring); the rest fly off as sparks
  float rate = ring ? 1.6 + rnd.x * 1.6 : 0.55 + rnd.x * 0.7; // lives per second
  float k = time * rate + seed * 17.0;
  float life = fract(k), cyc = floor(k);
  float a = h1(cyc + seed * 13.0), b = h1(cyc * 1.7 + seed * 29.0), c = h1(cyc * 2.3 + seed * 7.0);
  vec4 r = rim(a + time * 0.05);
  vec2 tg = r.zw, nrm = vec2(-tg.y, tg.x);
  float T = life / rate; // seconds since this spark was born
  float speed = ring ? 0.18 + 0.3 * b : 0.45 + 0.9 * b;
  vec3 v = vec3(tg * speed + nrm * (ring ? 0.03 : 0.08 + 0.2 * c), (ring ? 0.02 : 0.05 + 0.25 * c));
  vec3 p = vec3(r.xy * reveal + nrm * (c - 0.5) * 0.012, 0.006) + v * T;
  p.y -= (ring ? 0.15 : 0.9) * T * T;
  vHeat = 1.0 - life;
  vA = smoothstep(0.0, 0.06, life) * (1.0 - life) * fade * smoothstep(0.0, 0.15, reveal) * (0.75 + 0.35 * focus);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (ring ? 9.0 + 10.0 * rnd.z : 12.0 + 16.0 * rnd.z) * (0.4 + 0.6 * vHeat) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const rimFrag = /* glsl */ `
varying float vHeat; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.85, 0.5), vHeat * vHeat) + vec3(0.4, 0.3, 0.2) * pow(a, 6.0);
  gl_FragColor = vec4(col, a * vA);
}`;
function rimPoints() {
  const N = 3000, pos = new Float32Array(N * 3), seed = [], rnd = [];
  for (let i = 0; i < N; i++) seed.push(Math.random()), rnd.push(Math.random(), Math.random(), Math.random());
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); // unused: positions come from the shader
  g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute("rnd", new THREE.Float32BufferAttribute(rnd, 3));
  return g;
}

const screenVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Live video when available, a swirling "world forming" effect while connecting,
// an iris that opens on creation, and feathered edges so it reads as a window.
const screenFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float time; uniform float reveal; uniform float focus; uniform float fade;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = (vUv - 0.5) * vec2(${(W / H).toFixed(4)}, 1.0);
  float r = length(p), a = atan(p.y, p.x);
  float sa = a + time * 0.3 - r * 3.0; // via cos/sin so there's no seam where atan wraps
  float swirl = noise(vec2(cos(sa), sin(sa)) * 1.6 + vec2(r * 4.0 - time * 0.4, 3.7));
  vec3 forming = mix(vec3(0.05,0.07,0.18), vec3(0.95,0.62,0.30), smoothstep(0.35, 0.9, swirl)) * (1.2 - r);
  vec3 col = mix(forming, texture2D(map, vUv).rgb, hasVideo);
  // Square iris that grows from the centre, its edge burning where the sparks are.
  vec2 q = abs(vUv - 0.5) * vec2(${W.toFixed(4)}, ${H.toFixed(4)});
  float e = min(${(W / 2).toFixed(4)} * reveal - q.x, ${(H / 2).toFixed(4)} * reveal - q.y); // metres inside the edge
  float n = noise(vec2((q.x + q.y) * 40.0 - time * 3.0, time * 2.0));
  float feather = smoothstep(0.0, 0.012 + 0.02 * n, e);
  float iris = step(0.0, e);
  col += vec3(1.0, 0.45, 0.12) * exp(-max(e, 0.0) * 55.0) * (0.5 + 0.7 * n);
  col *= 0.92 + 0.08 * focus;
  gl_FragColor = vec4(col, feather * iris * fade);
}`;

/** A rounded text panel (a window's caption, the in-headset toast). `mesh` is what you add to the scene. */
export class Caption {
  constructor() {
    this.canvas = Object.assign(document.createElement("canvas"), { width: 1024, height: 192 });
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, W * (192 / 1024)),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
  }

  set(text, kind = "story") {
    const c = this.canvas, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (text) {
      g.font = `${kind === "story" ? "italic 500" : "500"} 44px Georgia, serif`;
      const lines = wrap(g, text, c.width - 80).slice(0, 2);
      g.fillStyle = "rgba(10,12,20,0.55)";
      roundRect(g, 20, 20, c.width - 40, c.height - 40, 30);
      g.fill();
      g.fillStyle = kind === "story" ? "#ffe9c7" : "#bcd3ff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * 52));
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class Portal {
  constructor(id, listener) {
    this.id = id;
    this.group = new THREE.Group();
    this.group.name = `portal-${id}`;
    this.created = performance.now();
    this.focused = false;

    this.texture = new THREE.Texture(); // replaced by a VideoTexture once frames arrive
    this.screenMat = new THREE.ShaderMaterial({
      vertexShader: screenVert,
      fragmentShader: screenFrag,
      transparent: true,
      uniforms: {
        map: { value: this.texture },
        hasVideo: { value: 0 },
        time: { value: 0 },
        reveal: { value: 0 },
        focus: { value: 0 },
        fade: { value: 1 },
      },
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.screenMat);
    this.screen.userData.portal = this;
    this.group.add(this.screen);

    this.rimMat = new THREE.ShaderMaterial({
      vertexShader: rimVert,
      fragmentShader: rimFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: this.screenMat.uniforms.time, reveal: this.screenMat.uniforms.reveal,
        fade: this.screenMat.uniforms.fade, focus: this.screenMat.uniforms.focus,
      },
    });
    this.rim = new THREE.Points(rimPoints(), this.rimMat);
    this.rim.frustumCulled = false;
    this.rim.renderOrder = LAYER.WINDOW_GLOW; // fixed order: sparks, then caption (see layers.js)
    this.group.add(this.rim);

    // Caption panel under the portal (status, then the storyteller's line).
    this.caption = new Caption();
    const cap = this.caption.mesh;
    cap.position.set(0, -H / 2 - 0.2, 0.01);
    cap.renderOrder = LAYER.WINDOW_CAPTION;
    this.group.add(cap);

    // The picture sits flush in the opening (no frame or tunnel), over a dark backing that opens with it.
    this.backMat = new THREE.MeshBasicMaterial({ color: 0x05060c, transparent: true });
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.backMat);
    this.back.position.z = -0.005;
    this.back.scale.setScalar(0.001);
    this.back.renderOrder = LAYER.WINDOW_BACK; // transparent (to fade), but always drawn before the picture
    this.group.add(this.back);
    this.mask = new THREE.Mesh(maskGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.mask.renderOrder = LAYER.WALL_MASK; // hides what's "inside the wall"
    this.group.add(this.mask);

    this.burstMat = new THREE.ShaderMaterial({
      vertexShader: burstVert,
      fragmentShader: burstFrag,
      uniforms: { age: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.burst = new THREE.Points(burstPoints(), this.burstMat);
    this.burst.frustumCulled = false;
    this.group.add(this.burst);
    this.setCaption("The world is forming…", "status");

    this.listener = listener;
    this.sound = null;
  }

  attachVideo(video) {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace; // shader passes sRGB through untouched
    // Mipmaps let the step-inside dome blur the picture softly past its edges.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    this.texture = tex;
    this.screenMat.uniforms.map.value = tex;
    const onFrame = () => (this.screenMat.uniforms.hasVideo.value = 1);
    if (video.readyState >= 2) onFrame();
    else video.addEventListener("loadeddata", onFrame, { once: true });
  }

  attachAudio(stream) {
    if (!this.listener) return;
    // Chrome only feeds remote WebRTC audio into Web Audio if an element is also playing it.
    const el = Object.assign(new Audio(), { srcObject: stream, muted: true });
    el.play().catch(() => {});
    this._audioEl = el;
    if (this.sound) this.group.remove(this.sound);
    this.sound = new THREE.PositionalAudio(this.listener);
    this.sound.setMediaStreamSource(stream);
    this.sound.setRefDistance(1.2);
    this.sound.setRolloffFactor(1.6);
    this.sound.setDirectionalCone(200, 320, 0.35);
    this.group.add(this.sound);
    this.setImmersed(this.immersed);
  }

  // Inside the world its sound surrounds you instead of coming from the window. Eased in update(),
  // so the sound swells around you as you step through rather than jumping.
  setImmersed(on) {
    this.immersed = Boolean(on);
    this._audioK ??= on ? 1 : 0;
    this._applyAudio();
  }

  _applyAudio() {
    if (!this.sound) return;
    const k = this._audioK ?? 0;
    this.sound.setRefDistance(1.2 + (60 - 1.2) * k * k);
    this.sound.setDirectionalCone(200 + 160 * k, 320 + 40 * k, 0.35 + 0.65 * k);
  }

  /** 1 = the window as normal, 0 = gone (used while stepping in and out, so it fades rather than pops). */
  setFade(k) {
    k = Math.max(0, Math.min(1, k));
    this.screenMat.uniforms.fade.value = k;
    this.caption.mesh.material.opacity = k;
    this.backMat.opacity = k;
    this.group.visible = k > 0.001;
  }

  setFocused(f) {
    this.focused = f;
    this.screenMat.uniforms.focus.value = f ? 1 : 0;
  }

  setCaption(text, kind = "story") {
    this.caption.set(text, kind);
  }

  update(t) {
    this.screenMat.uniforms.time.value = t;
    const age = (performance.now() - this.created) / 1000;
    const reveal = 1 - (1 - Math.min(1, age / 1.4)) ** 3; // ease out: bursts open, then settles
    this.screenMat.uniforms.reveal.value = reveal;
    this.back.scale.setScalar(Math.max(0.001, reveal * 0.99));
    this.burstMat.uniforms.age.value = age;
    if (this.burst.visible && age > 3) this.burst.visible = false;
    // Ease the sound between "from the window" and "all around you" (about half a second).
    const want = this.immersed ? 1 : 0;
    if (this.sound && this._audioK !== want) {
      this._audioK = (this._audioK ?? want) + Math.sign(want - (this._audioK ?? want)) * 0.035;
      if (Math.abs(this._audioK - want) < 0.04) this._audioK = want;
      this._applyAudio();
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.sound?.disconnect?.();
    if (this._audioEl) this._audioEl.srcObject = null;
    this.texture.dispose();
    this.caption.dispose();
    this.rim.geometry.dispose();
    this.rimMat.dispose();
  }
}

function wrap(g, text, max) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) lines.push(line), (line = w);
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const PORTAL_SIZE = { W, H };
