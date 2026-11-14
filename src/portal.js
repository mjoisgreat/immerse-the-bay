import * as THREE from "three";

const W = 1.6, H = 0.9; // metres, 16:9 like Orbis output

const screenVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Live video when available, a swirling "world forming" effect while connecting,
// an iris that opens on creation, and feathered edges so it reads as a window.
const screenFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float time; uniform float reveal; uniform float focus;
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
  col *= 0.92 + 0.08 * focus;
  gl_FragColor = vec4(col, feather * iris);
}`;

const glowFrag = /* glsl */ `
uniform vec3 color; uniform float strength; uniform float time;
varying vec2 vUv;
float sdRoundRect(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(${((W + 0.5) / (H + 0.5)).toFixed(4)}, 1.0);
  float d = sdRoundRect(p, vec2(${(W / (H + 0.5) / 2).toFixed(4)}, ${(H / (H + 0.5) / 2).toFixed(4)}), 0.02);
  float g = exp(-max(d, 0.0) * 28.0) * step(0.0, d);
  float pulse = 0.85 + 0.15 * sin(time * 2.2);
  gl_FragColor = vec4(color, g * strength * pulse);
}`;

function textCanvas() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 192;
  return c;
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
      uniforms: { color: { value: new THREE.Color(0xffb36b) }, strength: { value: 0.6 }, time: { value: 0 } },
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, H + 0.5), this.glowMat);
    glow.position.z = -0.005;
    this.group.add(glow);

    // Caption panel under the portal (status, then the storyteller's line).
    this.caption = textCanvas();
    this.captionTex = new THREE.CanvasTexture(this.caption);
    this.captionTex.colorSpace = THREE.SRGBColorSpace;
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(W, W * (192 / 1024)),
      new THREE.MeshBasicMaterial({ map: this.captionTex, transparent: true, depthWrite: false }),
    );
    cap.position.y = -H / 2 - 0.2;
    this.group.add(cap);
    this.setCaption("The world is forming…", "status");

    this.listener = listener;
    this.sound = null;
  }

  attachVideo(video) {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace; // shader passes sRGB through untouched
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
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
  }

  setFocused(f) {
    this.focused = f;
    this.screenMat.uniforms.focus.value = f ? 1 : 0;
    this.glowMat.uniforms.color.value.set(f ? 0xffd08a : 0x6aa8ff);
    this.glowMat.uniforms.strength.value = f ? 0.9 : 0.35;
  }

  setCaption(text, kind = "story") {
    const c = this.caption, g = c.getContext("2d");
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
    this.captionTex.needsUpdate = true;
  }

  update(t) {
    this.screenMat.uniforms.time.value = t;
    this.glowMat.uniforms.time.value = t;
    const age = (performance.now() - this.created) / 1000;
    this.screenMat.uniforms.reveal.value = Math.min(1, age / 1.4);
  }

  dispose() {
    this.group.removeFromParent();
    this.sound?.disconnect?.();
    if (this._audioEl) this._audioEl.srcObject = null;
    this.texture.dispose();
    this.captionTex.dispose();
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
