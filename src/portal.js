import * as THREE from "three";
import { LAYER } from "./layers.js";
import { RimSparks } from "./sparks.js";
import { rimRadiusGLSL } from "./rimshape.js";

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

const screenVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// See-through until the world's video arrives, then it fades in (`shown`, 0..1). A square iris opens on
// creation, and the edges are feathered and burning so it reads as a hole in space.
const screenFrag = /* glsl */ `
uniform sampler2D map; uniform float shown; uniform float time; uniform float reveal; uniform float focus; uniform float fade;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
${rimRadiusGLSL(W, H)}
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec3 col = texture2D(map, vUv).rgb;
  // A wobbly oval iris (rimshape.js) that grows from the centre, its edge burning where the sparks are.
  vec2 q = (vUv - 0.5) * vec2(${W.toFixed(4)}, ${H.toFixed(4)});
  float ang = atan(q.y, q.x);
  float e = rimRadius(ang, time) * reveal - length(q); // metres inside the edge
  float n = noise(vec2(cos(ang), sin(ang)) * 6.0 + vec2(time * 2.0, -time * 1.5)); // (no seam where atan wraps)
  float feather = smoothstep(0.0, 0.012 + 0.02 * n, e);
  float iris = step(0.0, e);
  col += vec3(1.0, 0.45, 0.12) * exp(-max(e, 0.0) * 55.0) * (0.5 + 0.7 * n);
  col *= 0.92 + 0.08 * focus;
  gl_FragColor = vec4(col, feather * iris * fade * shown);
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
        shown: { value: 0 },
        time: { value: 0 },
        reveal: { value: 0 },
        focus: { value: 0 },
        fade: { value: 1 },
      },
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.screenMat);
    this.screen.userData.portal = this;
    this.group.add(this.screen);

    this.sparks = new RimSparks(this.group, W, H); // the burning rim (see sparks.js)

    // Caption panel under the portal (status, then the storyteller's line).
    this.caption = new Caption();
    const cap = this.caption.mesh;
    cap.position.set(0, -H / 2 - 0.2, 0.01);
    cap.renderOrder = LAYER.WINDOW_CAPTION;
    this.group.add(cap);

    this.mask = new THREE.Mesh(maskGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.mask.renderOrder = LAYER.WALL_MASK; // hides what's "inside the wall"
    this.group.add(this.mask);

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
    const onFrame = () => (this._videoReady = true);
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
    // Fade the world in (about 1.2 s) once its video has frames; until then the window is see-through.
    const dt = Math.min(0.1, Math.max(0, t - (this._lastT ?? t)));
    this._lastT = t;
    this._shownK = Math.min(1, (this._shownK ?? 0) + (this._videoReady ? dt / 1.2 : 0));
    const shown = this._shownK * this._shownK * (3 - 2 * this._shownK);
    this.screenMat.uniforms.shown.value = shown;
    this.sparks.set(reveal, this.group.visible ? this.screenMat.uniforms.fade.value * (0.8 + 0.3 * this.screenMat.uniforms.focus.value) : 0, t);
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
    this.sparks.dispose();
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
