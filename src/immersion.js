import * as THREE from "three";

// "Step inside": one portal's live video becomes the world around you.
//
// Orbis is flat (perspective) video, so it is shown with the same perspective the camera had:
// every direction you look is mapped onto the image as if it were a window at infinity, so
// straight lines stay straight and scale feels right — you stand where the camera stood.
// It covers your natural field of view ahead; past its edges, a soft blurred extension of the
// picture fills your peripheral vision so there's no hard frame. It stays at "infinity" (follows
// your head position, not your rotation), and motes drifting at arm's length give near depth.
// A light sharpen and fine grain keep the upscaled video crisp instead of soft or blocky.
const HFOV = (84 * Math.PI) / 180; // matches the "20 mm wide-angle" view the director asks Orbis for
const TANH = Math.tan(HFOV / 2);
const TANV = TANH * (9 / 16);
const RADIUS = 30;
const FADE_S = 1.4;
const MOTES = 500;

const domeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const domeFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float progress; uniform float time; uniform vec2 texel;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
vec2 mirror(vec2 u){ return 1.0 - abs(mod(u, 2.0) - 1.0); }
void main(){
  vec3 d = normalize(vDir);
  float fwd = -d.z;
  // Perspective-correct: where this view direction meets the image plane.
  vec2 plane = d.xy / max(fwd, 0.02);
  vec2 uv = 0.5 + 0.5 * plane / vec2(${TANH.toFixed(5)}, ${TANV.toFixed(5)});
  vec2 past = max(max(-uv, uv - 1.0), 0.0) * vec2(${(2 * TANH).toFixed(5)}, ${(2 * TANV).toFixed(5)});
  float outside = fwd > 0.05 ? min(length(past), 3.0) : 3.0;

  // The picture, lightly sharpened (contrast-adaptive) so upscaled frames stay crisp.
  vec3 c = texture2D(map, uv).rgb;
  vec3 n = texture2D(map, uv + vec2(0.0, texel.y)).rgb, s = texture2D(map, uv - vec2(0.0, texel.y)).rgb;
  vec3 e = texture2D(map, uv + vec2(texel.x, 0.0)).rgb, w = texture2D(map, uv - vec2(texel.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  float amt = sqrt(clamp(min(mn.g, 1.0 - mx.g) / max(mx.g, 0.001), 0.0, 1.0)) * 0.22;
  vec3 sharp = clamp((c + (c * 4.0 - n - s - e - w) * amt), 0.0, 1.0);

  // Beyond the frame: a soft, ever blurrier extension of it fading into the scene's colour.
  vec3 avg = texture2D(map, vec2(0.5, 0.5), 14.0).rgb;
  // Edge colours smeared outward and heavily blurred (like ambient light), never a recognisable copy.
  vec2 edgeUv = clamp(uv, 0.002, 0.998);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float inFrame = outside > 0.0 ? 0.0 : smoothstep(0.0, 0.07, edge);
  vec3 video = sharp;
  if (inFrame < 1.0) {
    vec3 ext = vec3(0.0);
    float spread = 0.06 + outside * 0.08;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
      ext += texture2D(map, clamp(edgeUv + vec2(float(i), float(j)) * spread, 0.0, 1.0), 5.0 + outside * 2.0).rgb;
    ext /= 9.0;
    ext = mix(ext, avg, smoothstep(0.05, 1.0, outside)) * mix(0.85, 0.3, smoothstep(0.0, 1.6, outside));
    video = mix(ext, sharp, inFrame);
  }
  video += (hash(gl_FragCoord.xy + fract(time) * 91.0) - 0.5) * 0.022; // fine grain hides compression blocks

  // Before frames arrive: the same swirl the portal shows while a world forms.
  float sw = noise(vec2(atan(d.x, -d.z) * 2.0 + time * 0.6, d.y * 3.0 - time * 0.4));
  vec3 forming = mix(vec3(0.05,0.07,0.18), vec3(0.95,0.62,0.30), smoothstep(0.35, 0.9, sw));
  vec3 col = mix(forming, video, hasVideo);
  // Iris that opens from straight ahead on entry and closes on exit, with a warm rim.
  float ang = acos(clamp(fwd, -1.0, 1.0));
  float r = progress * 3.4;
  float iris = 1.0 - smoothstep(r - 0.35, r, ang);
  float rim = smoothstep(r - 0.5, r - 0.2, ang) * iris * (1.0 - progress);
  col += vec3(1.0, 0.7, 0.4) * rim * 1.5;
  gl_FragColor = vec4(col, iris);
}`;

const moteVert = /* glsl */ `
attribute float seed;
uniform float time; uniform float size;
varying float vTw;
void main() {
  vec3 p = position;
  p.x += sin(time * 0.21 + seed * 6.3) * 0.35;
  p.z += cos(time * 0.17 + seed * 4.1) * 0.35;
  p.y += mod(time * (0.03 + seed * 0.05) + seed * 4.0, 4.0) - 2.0; // slow rise, wraps
  vTw = 0.55 + 0.45 * sin(time * (1.5 + seed * 2.0) + seed * 30.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * (0.6 + seed) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const moteFrag = /* glsl */ `
uniform vec3 color; uniform float opacity;
varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(color * (0.6 + vTw), a * a * opacity * vTw);
}`;

export class Immersion {
  constructor(scene, camera, { onChange, audioContext } = {}) {
    this.camera = camera;
    this.onChange = onChange || (() => {});
    this.audio = audioContext;
    this.portal = null; // the Portal we're inside (or leaving)
    this.video = null;
    this.inside = false;
    this.progress = 0; // 0 = in the room, 1 = fully inside

    this.world = new THREE.Group(); // fixed where you stepped in
    this.world.visible = false;
    scene.add(this.world);

    this.uniforms = {
      map: { value: new THREE.Texture() },
      hasVideo: { value: 0 },
      progress: { value: 0 },
      time: { value: 0 },
      texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 128, 64),
      new THREE.ShaderMaterial({
        vertexShader: domeVert,
        fragmentShader: domeFrag,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: false, // paint over the windows' wall masks
      }),
    );
    this.dome.renderOrder = -10; // behind every portal and UI element
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    scene.add(this.dome); // at infinity: follows your head position, keeps the world's rotation

    // Motes in a ring around you (not right on top of your head).
    const pos = new Float32Array(MOTES * 3), seed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.pow(Math.random(), 0.7) * 7;
      pos.set([Math.cos(a) * r, Math.random() * 3.2 - 1.4, Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: moteVert,
      fragmentShader: moteFrag,
      uniforms: {
        time: this.uniforms.time,
        size: { value: 90 },
        color: { value: new THREE.Color(1, 0.8, 0.55) },
        opacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 5;
    this.world.add(this.motes);

    this.sampler = Object.assign(document.createElement("canvas"), { width: 16, height: 9 });
    this.nextSample = 0;
    this.entryEye = new THREE.Vector3();
    this.forward = new THREE.Vector3();
  }

  get active() {
    return this.progress > 0 || this.inside;
  }

  enter(portal, video) {
    if (this.inside && this.portal === portal) return;
    const switching = this.inside && this.portal;
    if (switching) this._release(this.portal);
    this.portal = portal;
    this.video = video;
    this.inside = true;
    // Share the portal's live uniforms, so reconnects and new video tracks just work.
    this.uniforms.map = portal.screenMat.uniforms.map;
    this.uniforms.hasVideo = portal.screenMat.uniforms.hasVideo;
    if (switching) this.progress = Math.min(this.progress, 0.25); // re-open the iris on the new world

    // Anchor the world where you're standing, facing where the window was.
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const at = portal.group.getWorldPosition(new THREE.Vector3());
    const dx = at.x - eye.x, dz = at.z - eye.z;
    this.world.position.copy(eye);
    this.world.rotation.set(0, Math.atan2(-dx, -dz), 0);
    this.dome.rotation.copy(this.world.rotation);
    this.forward.set(dx, 0, dz).normalize();
    this.entryEye.copy(eye);
    portal.setImmersed(true);
    this._whoosh(true);
    this.onChange(portal.id);
  }

  exit() {
    if (!this.inside) return;
    this.inside = false;
    this.entryEye.set(NaN, NaN, NaN);
    this._whoosh(false);
    this.onChange(null);
  }

  // Leave instantly (portal closed, session ended).
  reset() {
    const was = this.inside;
    if (this.portal) this._release(this.portal);
    this.portal = null;
    this.video = null;
    this.inside = false;
    this.progress = 0;
    this.world.visible = false;
    this.dome.visible = false;
    if (was) this.onChange(null);
  }

  _release(portal) {
    portal.setImmersed(false);
    portal.group.visible = true;
  }

  /** Where a world-space direction lands in the video (u right, v up), or null if past its edges. */
  uvFromDirection(dir) {
    const d = dir.clone().applyQuaternion(this.world.quaternion.clone().invert()).normalize();
    if (-d.z < 0.05) return null;
    const u = 0.5 + (0.5 * (d.x / -d.z)) / TANH;
    const v = 0.5 + (0.5 * (d.y / -d.z)) / TANV;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { x: u, y: v } : null;
  }

  // Stepped back out the way you came?
  walkedBack(eye) {
    if (!this.inside || Number.isNaN(this.entryEye.x)) return false;
    const dx = eye.x - this.entryEye.x, dz = eye.z - this.entryEye.z;
    return dx * this.forward.x + dz * this.forward.z < -0.7;
  }

  // Tint the motes with the world's average colour (cheap: a 16x9 readback twice a second).
  _sampleColour(now) {
    const v = this.video;
    if (!v || v.readyState < 2 || now < this.nextSample) return;
    this.nextSample = now + 500;
    try {
      const g = this.sampler.getContext("2d", { willReadFrequently: true });
      g.drawImage(v, 0, 0, 16, 9);
      const px = g.getImageData(0, 0, 16, 9).data;
      let r = 0, gr = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) r += px[i], gr += px[i + 1], b += px[i + 2];
      const n = px.length / 4;
      const c = new THREE.Color(r / n / 255, gr / n / 255, b / n / 255);
      const hsl = c.getHSL({});
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.4 + 0.15), 0.72); // a glowing version of the scene's hue
      this.moteMat.uniforms.color.value.lerp(c, 0.3);
    } catch {
      /* frame not readable yet */
    }
  }

  _whoosh(inward) {
    const ctx = this.audio;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime, len = 1.3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = Object.assign(ctx.createBufferSource(), { buffer: buf });
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(inward ? 250 : 1800, t);
    band.frequency.exponentialRampToValueAtTime(inward ? 1800 : 220, t + len);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + len);
  }

  update(t, dt) {
    const target = this.inside ? 1 : 0;
    const step = dt / FADE_S;
    this.progress = target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    this.uniforms.progress.value = eased;
    this.uniforms.time.value = t;
    this.moteMat.uniforms.opacity.value = Math.max(0, eased - 0.3) / 0.7;
    this.world.visible = this.progress > 0;
    this.dome.visible = this.world.visible;
    if (this.dome.visible) {
      this.camera.getWorldPosition(this.dome.position);
      const v = this.video;
      if (v?.videoWidth) this.uniforms.texel.value.set(1 / v.videoWidth, 1 / v.videoHeight);
    }
    if (this.portal) {
      // The window you walked through disappears once the world is around you.
      this.portal.group.visible = this.progress < 0.55;
      if (!this.inside && this.progress === 0) this.reset();
    }
    if (this.world.visible) this._sampleColour(performance.now());
  }
}
