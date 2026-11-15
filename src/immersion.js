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

// Wide view: two more live streams of the same scene, the camera turned SIDE_YAW to the left and right.
// They overlap the main view by a few degrees and blend into it, giving about 230° of live picture.
// 0 → 1 with eased ends (smoothstep), clamped.
const smooth01 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export const SIDE_YAW = (72 * Math.PI) / 180;
// The middle of the overlap between the main view and the left one, as x in each image (right: 1 - x).
const OVERLAP_YAW = SIDE_YAW / 2; // halfway between the side's inner edge (yaw - HFOV/2) and the main's (HFOV/2)
const OVERLAP_MAIN_X = 0.5 - (0.5 * Math.tan(OVERLAP_YAW)) / TANH;
const OVERLAP_SIDE_X = 0.5 + (0.5 * Math.tan(SIDE_YAW - OVERLAP_YAW)) / TANH;

const domeFrag = /* glsl */ `
uniform sampler2D map; uniform float hasVideo; uniform float progress; uniform float time; uniform vec2 texel;
uniform sampler2D mapL; uniform sampler2D mapR; uniform float hasL; uniform float hasR; uniform float premult;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
vec2 mirror(vec2 u){ return 1.0 - abs(mod(u, 2.0) - 1.0); }
// Where direction d lands in a side camera turned by yaw (+ left, - right); z = how far in front it is.
vec3 sideUv(vec3 d, float yaw){
  vec3 f = vec3(-sin(yaw), 0.0, -cos(yaw)), r = vec3(cos(yaw), 0.0, -sin(yaw));
  float fw = dot(d, f);
  vec2 p = vec2(dot(d, r), d.y) / max(fw, 0.02);
  return vec3(0.5 + 0.5 * p / vec2(${TANH.toFixed(5)}, ${TANV.toFixed(5)}), fw);
}
float frameWeight(vec2 uv, float fw){
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return fw > 0.05 ? smoothstep(0.0, 0.15, edge) : 0.0;
}
// The side streams are separate videos, so their exposure drifts from the main one. Compare both where
// they overlap (very coarse mip levels: a stable average, the same texels for every pixel, so cheap)
// and nudge the side's colour toward the main view's there, so the seams don't show as a brightness step.
vec3 sideGain(sampler2D side, float mainX, float sideX){
  vec3 m = vec3(0.0), sd = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float v = 0.3 + 0.2 * float(i);
    m += textureLod(map, vec2(mainX, v), 7.0).rgb;
    sd += textureLod(side, vec2(sideX, v), 7.0).rgb;
  }
  return clamp((m + 0.06) / (sd + 0.06), vec3(0.8), vec3(1.25));
}
void main(){
  vec3 d = normalize(vDir);
  float fwd = -d.z;
  // Perspective-correct: where this view direction meets the image plane.
  vec2 plane = d.xy / max(fwd, 0.02);
  vec2 uv = 0.5 + 0.5 * plane / vec2(${TANH.toFixed(5)}, ${TANV.toFixed(5)});
  vec2 past = max(max(-uv, uv - 1.0), 0.0) * vec2(${(2 * TANH).toFixed(5)}, ${(2 * TANV).toFixed(5)});
  float outside = fwd > 0.05 ? min(length(past), 3.0) : 3.0;

  // A wide, soft blend from the sharp picture into the glow (no visible frame line).
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float inFrame = smoothstep(0.0, 0.12, edge) * step(outside, 0.0);

  // The picture. Explicit level 0 (textureLod): uv jumps wildly outside the frame and behind you, and
  // automatic mip selection there picks blurry levels in 2x2 pixel blocks (boxes along the edges).
  vec3 c = textureLod(map, uv, 0.0).rgb;
  vec3 sharp = c;
  if (premult < 0.5 && inFrame > 0.0) {
    // On a flat screen, lightly sharpened (contrast-adaptive) so upscaled frames stay crisp. Not in the
    // headset: sharpened edges shimmer as your head moves (and it's four more reads per pixel).
    vec3 n = textureLod(map, uv + vec2(0.0, texel.y), 0.0).rgb, s = textureLod(map, uv - vec2(0.0, texel.y), 0.0).rgb;
    vec3 e = textureLod(map, uv + vec2(texel.x, 0.0), 0.0).rgb, w = textureLod(map, uv - vec2(texel.x, 0.0), 0.0).rgb;
    vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
    float amt = sqrt(clamp(min(mn.g, 1.0 - mx.g) / max(mx.g, 0.001), 0.0, 1.0)) * 0.22;
    sharp = clamp((c + (c * 4.0 - n - s - e - w) * amt), 0.0, 1.0);
  }

  // Wide view: the left and right streams. Only one can cover a given direction.
  vec3 sl = sideUv(d, ${SIDE_YAW.toFixed(5)}), sr = sideUv(d, -${SIDE_YAW.toFixed(5)});
  float wl = frameWeight(sl.xy, sl.z) * hasL, wr = frameWeight(sr.xy, sr.z) * hasR;
  float ws = wl + wr;
  vec3 sideCol = vec3(0.0);
  if (wl > 0.0) sideCol = textureLod(mapL, sl.xy, 0.0).rgb * sideGain(mapL, ${OVERLAP_MAIN_X.toFixed(5)}, ${OVERLAP_SIDE_X.toFixed(5)});
  else if (wr > 0.0) sideCol = textureLod(mapR, sr.xy, 0.0).rgb * sideGain(mapR, ${(1 - OVERLAP_MAIN_X).toFixed(5)}, ${(1 - OVERLAP_SIDE_X).toFixed(5)});

  // Beyond the frame: a soft, ever blurrier glow of the picture fading into the scene's colour.
  // Every pixel computes it (no branch) at a fixed blur level (textureLod): mip selection inside a
  // branch, or across the frame edge where uv jumps, is undefined and showed up as boxes and seams.
  vec3 avg = textureLod(map, vec2(0.5, 0.5), 10.0).rgb;
  vec3 ext = avg;
  if (inFrame < 1.0 && ws < 1.0) { // (skipped where a picture covers it fully: most of your view)
  // Continuous with the edge: the picture reflected at its edge (seamless, no stretched-row streaks),
  // already well blurred at the frame and blurring more (higher mip level, wider taps) further out,
  // so it never reads as a copy or shows a line.
  vec2 eUv = mirror(uv);
  float lod = min(4.5 + outside * 5.0, 9.0);
  float blurR = 0.05 + min(outside, 1.5) * 0.06;
  ext = textureLod(map, eUv, lod).rgb * 0.4
    + textureLod(map, mirror(eUv + vec2(blurR, 0.0)), lod).rgb * 0.15
    + textureLod(map, mirror(eUv - vec2(blurR, 0.0)), lod).rgb * 0.15
    + textureLod(map, mirror(eUv + vec2(0.0, blurR)), lod).rgb * 0.15
    + textureLod(map, mirror(eUv - vec2(0.0, blurR)), lod).rgb * 0.15;
  // Corners are beyond two edges at once, where a reflection would show shapes: fade to the scene's colour sooner there.
  float corner = smoothstep(0.0, 0.25, min(max(-uv.x, uv.x - 1.0), max(-uv.y, uv.y - 1.0)) + 0.1);
  ext = mix(ext, avg, max(smoothstep(0.05, 0.9, outside), corner)) * mix(1.0, 0.3, smoothstep(0.0, 1.6, outside));
  }
  // Layered: glow, then the side view over it, then the main view on top. Where the main and a side
  // view overlap, the main one wins and only its soft edge crossfades into the side (a narrow band,
  // instead of the two different videos averaged over the whole overlap, which showed as ghosting).
  vec3 video = mix(mix(ext, sideCol, ws), sharp, inFrame);
  // Fine grain hides compression blocks on a flat screen. Not in the headset: per-frame noise that
  // differs between your eyes reads as sparkling and flicker.
  video += (hash(gl_FragCoord.xy + fract(time) * 91.0) - 0.5) * 0.022 * (1.0 - premult);

  // Before frames arrive: the same swirl the portal shows while a world forms.
  float sw = noise(vec2(atan(d.x, -d.z) * 2.0 + time * 0.6, d.y * 3.0 - time * 0.4));
  vec3 forming = mix(vec3(0.05,0.07,0.18), vec3(0.95,0.62,0.30), smoothstep(0.35, 0.9, sw));
  vec3 col = mix(forming, video, hasVideo);
  // Iris that opens from straight ahead on entry and closes on exit, with a warm rim.
  float ang = acos(clamp(fwd, -1.0, 1.0));
  float r = progress * 3.6; // fully open reaches all the way behind you (3.4 left a see-through spot there)
  float iris = 1.0 - smoothstep(r - 0.35, r, ang);
  float rim = smoothstep(r - 0.5, r - 0.2, ang) * iris * (1.0 - progress);
  col += vec3(1.0, 0.7, 0.4) * rim * 1.5;
  // In the headset it's drawn opaque and first (see update), writing premultiplied colour and alpha.
  gl_FragColor = premult > 0.5 ? vec4(col * iris, iris) : vec4(col, iris);
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
  vTw = 0.82 + 0.18 * sin(time * (0.6 + seed * 0.8) + seed * 30.0); // a slow, gentle shimmer, not a flicker
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(size * (0.6 + seed) / -mv.z, 2.5); // never smaller than a few pixels (tiny dots flash)
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
      mapL: { value: new THREE.Texture() },
      mapR: { value: new THREE.Texture() },
      hasL: { value: 0 },
      hasR: { value: 0 },
      premult: { value: 0 },
    };
    this.blank = new THREE.Texture();
    this.sideState = { L: { video: null, tex: null, pending: null, lastGood: 0 }, R: { video: null, tex: null, pending: null, lastGood: 0 } };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 128, 64),
      new THREE.ShaderMaterial({
        vertexShader: domeVert,
        fragmentShader: domeFrag,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false, // drawn behind your hands, Pip and the windows (wall masks are hidden while inside)
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

  /**
   * Wide view: show a side stream's video (L or R), or remove it with null.
   * Nothing pops: a new (or reconnected) video only replaces the current picture once it has frames,
   * a side fades in over a second, and on removal it fades out before its texture is let go.
   */
  setSide(side, video) {
    const st = this.sideState[side];
    st.video = video || null;
    st.pending = null;
    if (!video) return;
    if (st.tex?.image === video) return;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace; // passed through untouched, like the main view
    // Mipmaps for the cheap exposure match at the seams (sideGain); the picture itself reads level 0.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    st.pending = tex;
  }

  _updateSide(side, dt) {
    const st = this.sideState[side], u = this.uniforms[`map${side}`], h = this.uniforms[`has${side}`];
    const ready = (v) => v && v.readyState >= 2 && v.videoWidth > 0;
    if (st.pending && ready(st.pending.image)) {
      st.tex?.dispose();
      st.tex = st.pending;
      st.pending = null;
      u.value = st.tex;
    }
    const v = st.video;
    // A stream that stalls for a moment keeps its last frame on screen: only fade out after 2 s.
    if (ready(v) && st.tex?.image === v) st.lastGood = performance.now();
    const want = v && st.tex && performance.now() - st.lastGood < 2000 ? 1 : 0;
    h.value = want > h.value ? Math.min(1, h.value + dt) : Math.max(0, h.value - dt * 1.5);
    if (!v && h.value === 0 && st.tex) {
      st.tex.dispose();
      st.tex = null;
      u.value = this.blank;
    }
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
    portal.setFade(1);
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
    this.nextSample = now + (this.uniforms.premult.value ? 3000 : 500); // a pixel readback can stall the GPU: rarely in the headset
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

  update(t, dt, { presenting = false } = {}) {
    // In the headset the world is drawn first, as an opaque layer (premultiplied alpha straight into the
    // passthrough blend), so the windows' "hole in the wall" depth masks drawn after it can't punch holes
    // in it. The masks can then stay on while you step in and out (no flash of tunnel walls or room) and
    // walking through a window's surface no longer flickers. On a flat screen it stays a normal blend.
    // It still blends (premultiplied "over"), so outside the opening iris it keeps whatever is behind: the
    // sky of a 3D world you stepped in from, rather than wiping it to see-through (your room flashed there).
    // A custom blend is honoured in the opaque pass; the normal one would be switched off there.
    const opaque = presenting;
    const m = this.dome.material;
    if (m.transparent === opaque) {
      m.transparent = !opaque;
      m.blending = opaque ? THREE.CustomBlending : THREE.NormalBlending;
      m.blendSrc = m.blendSrcAlpha = THREE.OneFactor;
      m.blendDst = m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      this.dome.renderOrder = opaque ? -30 : -10;
    }
    this.uniforms.premult.value = opaque ? 1 : 0;
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
      // The window you walked through fades away as the world opens around you (and back on the way out).
      const p = this.progress;
      this.portal.setFade(1 - smooth01((p - 0.2) / 0.55));
      if (!this.inside && this.progress === 0) this.reset();
    }
    if (this.world.visible) this._sampleColour(performance.now());
    // Side views fade in over a second once they have frames, and out when removed.
    for (const side of ["L", "R"]) this._updateSide(side, dt);
  }
}
