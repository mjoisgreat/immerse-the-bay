import * as THREE from "three";
import { LAYER } from "./layers.js";

import { WIN_W as W, WIN_H as H, WIN_DEPTH as DEPTH } from "./windowplace.js"; // metres, 16:9 like Orbis output; how far the picture sits "inside" the wall

// The tunnel walls between the wall opening and the picture: light from the world spills onto them.
const tunnelVert = /* glsl */ `
attribute vec2 videoUv; attribute float front;
varying vec2 vVideoUv; varying float vFront;
void main() { vVideoUv = videoUv; vFront = front; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const tunnelFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float reveal; uniform float fade;
varying vec2 vVideoUv; varying float vFront;
void main() {
  vec3 spill = texture2D(map, vVideoUv, 3.0).rgb;
  vec3 dark = vec3(0.03, 0.035, 0.07);
  vec3 lit = mix(vec3(0.25, 0.16, 0.10), spill, hasVideo);
  vec3 col = mix(lit * 0.75, dark, smoothstep(0.0, 1.0, vFront)); // bright near the picture, dark at the rim
  col += vec3(1.0, 0.7, 0.42) * pow(vFront, 12.0) * 0.35; // warm lip at the opening
  gl_FragColor = vec4(col * (0.4 + 0.6 * reveal), fade);
}`;

function tunnelGeometry() {
  const x = W / 2, y = H / 2, d = -DEPTH, e = 0.02;
  // Each side: front-a, front-b, back-b, back-a, plus which video edge lights it.
  const sides = [
    [[-x, y], [x, y], (t) => [t, 1 - e]],
    [[x, -y], [-x, -y], (t) => [1 - t, e]],
    [[-x, -y], [-x, y], (t) => [e, t]],
    [[x, y], [x, -y], (t) => [1 - e, 1 - t]],
  ];
  const pos = [], uv = [], front = [], idx = [];
  sides.forEach(([a, b, edge], i) => {
    const N = 12; // segments along each side, so the spill follows the picture
    for (let k = 0; k <= N; k++) {
      const t = k / N, px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      pos.push(px, py, 0, px, py, d);
      uv.push(...edge(t), ...edge(t));
      front.push(1, 0);
      if (k < N) {
        const o = (i * (N + 1) + k) * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("videoUv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("front", new THREE.Float32BufferAttribute(front, 1));
  g.setIndex(idx);
  return g;
}

// A wall around the opening that only writes depth: the real room (passthrough) hides the tunnel
// and the recessed picture except through the hole, so it looks cut into your wall, with parallax.
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

const screenVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Live video when available, a swirling "world forming" effect while connecting,
// an iris that opens on creation, and feathered edges so it reads as a window.
const screenFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float time; uniform float reveal; uniform float fade;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = (vUv - 0.5) * vec2(${(W / H).toFixed(4)}, 1.0);
  float r = length(p), a = atan(p.y, p.x);
  float swirl = noise(vec2(a * 2.0 + time * 0.6 - r * 6.0, r * 4.0 - time * 0.4));
  vec3 forming = mix(vec3(0.05,0.07,0.18), vec3(0.95,0.62,0.30), smoothstep(0.35, 0.9, swirl)) * (1.2 - r);
  vec3 col = mix(forming, texture2D(map, vUv).rgb, hasVideo);
  float edge = min(min(vUv.x, 1.0 - vUv.x) * ${(W / H).toFixed(4)}, min(vUv.y, 1.0 - vUv.y));
  float feather = smoothstep(0.0, 0.035, edge);
  float iris = 1.0 - smoothstep(reveal * 1.2 - 0.05, reveal * 1.2, r);
  gl_FragColor = vec4(col, feather * iris * fade);
}`;

const glowFrag = /* glsl */ `
uniform vec3 color; uniform float strength; uniform float time; uniform float fade;
varying vec2 vUv;
float sdRoundRect(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(${((W + 0.5) / (H + 0.5)).toFixed(4)}, 1.0);
  float d = sdRoundRect(p, vec2(${(W / (H + 0.5) / 2).toFixed(4)}, ${(H / (H + 0.5) / 2).toFixed(4)}), 0.02);
  float g = exp(-max(d, 0.0) * 28.0) * step(0.0, d);
  float pulse = 0.95 + 0.05 * sin(time * 1.4); // a slow breath; a stronger, faster pulse reads as flicker in a headset
  gl_FragColor = vec4(color, g * strength * pulse * fade);
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
  constructor(listener) {
    this.group = new THREE.Group();
    this.group.name = "window";
    this.created = performance.now();

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
        fade: { value: 1 },
      },
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.screenMat);
    this.screen.userData.portal = this;
    this.group.add(this.screen);

    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: screenVert,
      fragmentShader: glowFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(0xffd08a) }, strength: { value: 0.9 }, time: { value: 0 }, fade: this.screenMat.uniforms.fade },
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, H + 0.5), this.glowMat);
    glow.position.z = 0.004; // just in front of the wall opening
    glow.renderOrder = LAYER.WINDOW_GLOW; // fixed order: glow, then caption (see layers.js)
    this.group.add(glow);

    // Caption panel under the portal (status, then the storyteller's line).
    this.caption = new Caption();
    const cap = this.caption.mesh;
    cap.position.set(0, -H / 2 - 0.2, 0.01);
    cap.renderOrder = LAYER.WINDOW_CAPTION;
    this.group.add(cap);

    // Depth: the picture sits inside the wall, behind an opening, with lit tunnel walls.
    this.screen.position.z = -DEPTH;
    this.backMat = new THREE.MeshBasicMaterial({ color: 0x05060c, transparent: true });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.backMat);
    back.position.z = -DEPTH - 0.005;
    back.renderOrder = LAYER.WINDOW_BACK; // transparent (to fade), but always drawn before the picture
    this.group.add(back);
    this.tunnelMat = new THREE.ShaderMaterial({
      vertexShader: tunnelVert,
      fragmentShader: tunnelFrag,
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        map: this.screenMat.uniforms.map, hasVideo: this.screenMat.uniforms.hasVideo, reveal: this.screenMat.uniforms.reveal,
        fade: this.screenMat.uniforms.fade,
      },
    });
    const tunnel = new THREE.Mesh(tunnelGeometry(), this.tunnelMat);
    tunnel.renderOrder = LAYER.WINDOW_BACK;
    this.group.add(tunnel);
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

  setCaption(text, kind = "story") {
    this.caption.set(text, kind);
  }

  update(t) {
    this.screenMat.uniforms.time.value = t;
    this.glowMat.uniforms.time.value = t;
    const age = (performance.now() - this.created) / 1000;
    this.screenMat.uniforms.reveal.value = Math.min(1, age / 1.4);
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
