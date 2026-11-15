import * as THREE from "three";

// The Moon hub: a lunar landscape built in code (no big download), lit by a low sun with long
// baked shadows, under a black sky with stars, the Sun and the Earth.
// Real data: the ground's large-scale tone comes from NASA's LRO camera colour map of the Moon
// (CGI Moon Kit, public domain) and the Earth is NASA's Blue Marble (public domain).
// Everything stays within ~98 m because the camera's far plane is 100 m; the sky is drawn "at
// infinity" with a shader trick, so it never gets clipped and has no parallax.
// Lighting is baked into vertex colours once at build time (no lights, no shadow maps), which
// keeps it cheap on the Quest and independent of the lights the rest of the scene uses.

const R = 98; // terrain radius, metres
const GRID = 400; // heightmap cells per side
const CELL = (2 * R + 4) / GRID;
const HALF = (GRID * CELL) / 2;
const SUN = new THREE.Vector3(-0.55, Math.sin(THREE.MathUtils.degToRad(19)), 0.83).normalize(); // behind-left of you
const EARTH_DIR = (() => {
  const el = THREE.MathUtils.degToRad(24), az = THREE.MathUtils.degToRad(12);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
})();
const SKY_DIST = 90;

// ---------- noise ----------
function hash(ix, iz, seed = 0) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, z, seed = 0, period = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const w = (i) => (period ? ((i % period) + period) % period : i);
  const a = hash(w(ix), w(iz), seed), b = hash(w(ix + 1), w(iz), seed);
  const c = hash(w(ix), w(iz + 1), seed), d = hash(w(ix + 1), w(iz + 1), seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct = 4, seed = 0, period = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * noise(x * f, z * f, seed + i * 17, period ? period * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- heightmap ----------
function buildHeights() {
  const H = new Float32Array((GRID + 1) * (GRID + 1));
  const at = (i, j) => i + j * (GRID + 1);
  // Rolling ground, flat where you start, rising into hills/crater walls at the edge (the horizon).
  for (let j = 0; j <= GRID; j++)
    for (let i = 0; i <= GRID; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const r = Math.hypot(x, z);
      const flat = smooth(3, 16, r);
      let h = flat * ((fbm(x / 35, z / 35, 4, 1) - 0.5) * 2.4 + (fbm(x / 7, z / 7, 3, 2) - 0.5) * 0.35);
      h += (fbm(x / 2, z / 2, 2, 3) - 0.5) * 0.06;
      const rim = Math.pow(smooth(42, 96, r), 1.6);
      h += rim * (3 + 12 * fbm(x / 22 + 40, z / 22, 5, 4));
      H[at(i, j)] = h;
    }
  // Craters: a few big ones out in the field, many medium and small ones; none right under you.
  const rand = rng(1969);
  const craters = [];
  const place = (n, rMin, rMax, dMin, dMax, depthK) => {
    for (let k = 0; k < n; k++) {
      const cr = rMin + (rMax - rMin) * Math.pow(rand(), 2);
      const d = dMin + (dMax - dMin) * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      if (d < cr + 5) continue;
      craters.push({ cx, cz, cr, depth: cr * depthK * (0.4 + 0.6 * rand()) });
    }
  };
  place(3, 10, 20, 32, 70, 0.18);
  place(45, 2, 8, 10, 90, 0.2);
  place(380, 0.35, 1.8, 3, 95, 0.16);
  for (const { cx, cz, cr, depth } of craters) {
    const ext = cr * 2;
    const i0 = Math.max(0, Math.floor((cx - ext + HALF) / CELL)), i1 = Math.min(GRID, Math.ceil((cx + ext + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - ext + HALF) / CELL)), j1 = Math.min(GRID, Math.ceil((cz + ext + HALF) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const d = Math.hypot(x - cx, z - cz) / cr;
        let h = d < 1 ? (d * d - 1) * depth : 0; // bowl
        h += 0.35 * depth * Math.exp(-((d - 1) * (d - 1)) / 0.06); // raised rim
        if (d > 1) h += 0.12 * depth * Math.exp(-(d - 1) * 2.5) * (d < 2 ? 1 : 0); // ejecta apron
        H[at(i, j)] += h;
      }
  }
  // Exactly level where you stand.
  const c = H[at(GRID / 2, GRID / 2)];
  for (let k = 0; k < H.length; k++) H[k] -= c;
  return (x, z) => {
    const fx = Math.min(GRID - 1e-4, Math.max(0, (x + HALF) / CELL)), fz = Math.min(GRID - 1e-4, Math.max(0, (z + HALF) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = H[at(i, j)], b = H[at(i + 1, j)], c2 = H[at(i, j + 1)], d = H[at(i + 1, j + 1)];
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
}

// ---------- textures ----------
function detailTexture() {
  const N = 256, P = 16; // tileable noise with period P cells
  const data = new Uint8Array(N * N * 4);
  const rand = rng(7);
  const pits = Array.from({ length: 40 }, () => ({ x: rand() * N, y: rand() * N, r: 1.5 + rand() * 7 }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = fbm((x / N) * P, (y / N) * P, 5, 11, P);
      v = 0.55 + (v - 0.5) * 0.9 + (hash(x, y, 5) - 0.5) * 0.18; // grain
      for (const p of pits) {
        let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
        dx = Math.min(dx, N - dx);
        dy = Math.min(dy, N - dy);
        const d = Math.hypot(dx, dy) / p.r;
        if (d < 1.4) v *= d < 1 ? 0.78 + 0.2 * d : 1 + 0.15 * (1.4 - d);
      }
      const k = (x + y * N) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.max(0, Math.min(255, v * 255));
      data[k + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---------- sky (drawn at infinity: rotation only, depth pinned to the far plane) ----------
const SKY_VERT_HEAD = /* glsl */ `
  vec4 skyPosition(vec3 p) {
    vec3 dir = mat3(modelMatrix) * p;
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
    clip.z = clip.w * 0.99999;
    return clip;
  }
`;

function stars() {
  const n = 3500, rand = rng(42);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const band = new THREE.Vector3(0.3, 0.8, 0.5).normalize(); // Milky Way plane normal
  const v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    for (;;) {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      const l = v.length();
      if (l > 1 || l < 0.1) continue;
      v.divideScalar(l);
      if (k % 3 === 0 && Math.abs(v.dot(band)) > 0.18 * rand()) continue; // a third of them crowd into a band
      break;
    }
    v.multiplyScalar(SKY_DIST).toArray(pos, k * 3);
    const b = Math.pow(rand(), 3);
    const tint = rand();
    const c = 0.35 + 0.65 * b;
    col.set([c * (tint < 0.2 ? 0.8 : 1), c * 0.95, c * (tint > 0.8 ? 0.75 : 1)], k * 3);
    size[k] = 1.0 + 2.6 * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 } },
    vertexShader: SKY_VERT_HEAD + /* glsl */ `
      attribute float size; attribute vec3 color; varying vec3 vColor;
      void main() { vColor = color; gl_PointSize = size; gl_Position = skyPosition(position); }`,
    fragmentShader: /* glsl */ `
      uniform float opacity; varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vColor * smoothstep(1.0, 0.3, d) * opacity, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -20;
  return p;
}

function earth(tex) {
  const g = new THREE.SphereGeometry(3.4, 64, 32);
  g.rotateY(-1.9); // Africa and the Atlantic towards you
  g.rotateZ(0.35);
  g.translate(...EARTH_DIR.clone().multiplyScalar(SKY_DIST - 6).toArray());
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sun: { value: SUN }, opacity: { value: 1 } },
    vertexShader: SKY_VERT_HEAD + /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vUv = uv; vN = normal; vView = normalize(position);
        gl_Position = skyPosition(position);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 sun; uniform float opacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 n = normalize(vN);
        float lit = smoothstep(-0.05, 0.25, dot(n, sun));
        vec3 c = texture2D(map, vUv).rgb * 1.25;
        float rim = pow(1.0 - max(dot(n, -vView), 0.0), 3.0);
        c = c * lit + vec3(0.3, 0.55, 1.0) * rim * (0.15 + 0.85 * lit);
        gl_FragColor = vec4(c * opacity, opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -19;
  return mesh;
}

function sunDisc() {
  const g = new THREE.PlaneGeometry(26, 26);
  const center = SUN.clone().multiplyScalar(SKY_DIST - 2);
  g.applyMatrix4(new THREE.Matrix4().lookAt(center, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
  g.translate(center.x, center.y, center.z);
  const m = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 } },
    vertexShader: SKY_VERT_HEAD + /* glsl */ `
      varying vec2 vUv; void main() { vUv = uv; gl_Position = skyPosition(position); }`,
    fragmentShader: /* glsl */ `
      uniform float opacity; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = smoothstep(0.085, 0.07, d);
        float glow = exp(-d * 9.0) * 0.9 + exp(-d * 3.5) * 0.12;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * (core + glow) * opacity, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -18;
  return mesh;
}

// ---------- lander (an original, simple descent + ascent stage) ----------
function bake(geometry, color, matrix) {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
  g.computeVertexNormals();
  const n = g.attributes.normal, cols = new Float32Array(n.count * 3), v = new THREE.Vector3();
  for (let k = 0; k < n.count; k++) {
    v.fromBufferAttribute(n, k);
    const l = Math.max(0, v.dot(SUN)) * 1.05 + 0.04 + 0.05 * Math.max(0, v.y); // sun + earthshine + ground bounce
    cols.set([color[0] * l, color[1] * l, color[2] * l], k * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute("uv");
  return g;
}

function lander(groundY) {
  const parts = [];
  const add = (geo, color, pos, rot = [0, 0, 0]) => parts.push({ geo, color, m: new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)) });
  const gold = [0.78, 0.55, 0.16], foil = [0.55, 0.42, 0.2], grey = [0.62, 0.62, 0.6], dark = [0.08, 0.08, 0.1];
  add(new THREE.CylinderGeometry(1.75, 1.75, 1.5, 8), gold, [0, 1.55, 0], [0, Math.PI / 8, 0]);
  add(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 8), foil, [0, 0.6, 0], [0, Math.PI / 8, 0]);
  add(new THREE.CylinderGeometry(0.45, 0.7, 0.6, 12), dark, [0, 0.55, 0]); // engine bell
  add(new THREE.CylinderGeometry(1.25, 1.45, 1.6, 6), grey, [0, 3.1, 0.15]);
  add(new THREE.BoxGeometry(1.0, 0.9, 1.4), grey, [0, 3.2, 1.2], [0.15, 0, 0]);
  add(new THREE.BoxGeometry(0.34, 0.34, 0.1), dark, [-0.33, 3.4, 1.92], [0.15, 0, 0]); // windows
  add(new THREE.BoxGeometry(0.34, 0.34, 0.1), dark, [0.33, 3.4, 1.92], [0.15, 0, 0]);
  add(new THREE.BoxGeometry(0.9, 0.9, 0.08), dark, [0, 1.6, 1.78]); // hatch
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), grey, [0.9, 4.4, -0.6], [0, 0, 0.3]); // antenna mast
  add(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), grey, [1.1, 5.05, -0.6], [Math.PI, 0, 0.6]); // dish
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const top = new THREE.Vector3(Math.cos(a) * 1.6, 1.8, Math.sin(a) * 1.6);
    const foot = new THREE.Vector3(Math.cos(a) * 3.3, 0.12, Math.sin(a) * 3.3);
    const mid = top.clone().add(foot).multiplyScalar(0.5), len = top.distanceTo(foot);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.07, len, 8), color: grey, m: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) });
    add(new THREE.CylinderGeometry(0.45, 0.4, 0.12, 14), gold, [foot.x, 0.06, foot.z]);
    // strut back to the body
    const s = new THREE.Vector3(Math.cos(a) * 1.75, 0.8, Math.sin(a) * 1.75), e = new THREE.Vector3(Math.cos(a) * 2.6, 0.75, Math.sin(a) * 2.6);
    parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, s.distanceTo(e), 6), color: grey, m: new THREE.Matrix4().compose(s.clone().add(e).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), e.clone().sub(s).normalize()), new THREE.Vector3(1, 1, 1)) });
  }
  const place = new THREE.Matrix4().compose(new THREE.Vector3(-9, groundY - 0.05, -12), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)), new THREE.Vector3(1, 1, 1));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const group = new THREE.Group();
  for (const p of parts) group.add(new THREE.Mesh(bake(p.geo, p.color, place.clone().multiply(p.m)), mat));
  // Boxes the terrain uses to bake the lander's shadow.
  const boxes = [
    new THREE.Box3(new THREE.Vector3(-1.6, 0.4, -1.6), new THREE.Vector3(1.6, 2.3, 1.6)),
    new THREE.Box3(new THREE.Vector3(-1.2, 2.3, -1.2), new THREE.Vector3(1.2, 3.9, 1.6)),
  ].map((b) => b.applyMatrix4(place));
  return { group, mat, boxes, at: new THREE.Vector3().setFromMatrixPosition(place) };
}

// ---------- terrain ----------
function terrain(height, landerBoxes, maps) {
  const RINGS = 150, SEGS = 240;
  const ringR = (i) => R * Math.pow(i / RINGS, 1.6);
  const pos = new Float32Array((RINGS + 1) * SEGS * 3), light = new Float32Array((RINGS + 1) * SEGS);
  const tanE = SUN.y / Math.hypot(SUN.x, SUN.z);
  const sx = SUN.x / Math.hypot(SUN.x, SUN.z), sz = SUN.z / Math.hypot(SUN.x, SUN.z);
  const ray = new THREE.Ray(), o = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= RINGS; i++)
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2, r = ringR(i);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
      const k = i * SEGS + s;
      pos.set([x, y, z], k * 3);
      const e = 0.35;
      n.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
      let lit = Math.max(0, n.dot(SUN));
      // Terrain self-shadow: march towards the sun over the heightmap.
      for (let t = 0.3; t < 160 && lit > 0; t *= 1.12) {
        const px = x + sx * t, pz = z + sz * t;
        if (Math.abs(px) > HALF || Math.abs(pz) > HALF) break;
        if (height(px, pz) > y + t * tanE + 0.03) lit = 0;
      }
      if (lit > 0 && Math.hypot(x + 9, z + 12) < 30) {
        ray.set(o.set(x, y + 0.02, z), SUN);
        if (landerBoxes.some((b) => ray.intersectsBox(b))) lit = 0;
      }
      light[k] = lit * 1.15 + 0.03 + 0.02 * n.y; // sun + earthshine
    }
  const idx = [];
  for (let i = 0; i < RINGS; i++)
    for (let s = 0; s < SEGS; s++) {
      const a = i * SEGS + s, b = i * SEGS + ((s + 1) % SEGS), c = a + SEGS, d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("light", new THREE.BufferAttribute(light, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({
    uniforms: { detail: { value: maps.detail }, macro: { value: maps.macro }, opacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float light; varying float vLight; varying vec2 vXZ; varying float vDist;
      void main() {
        vLight = light; vXZ = position.xz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D detail; uniform sampler2D macro; uniform float opacity;
      varying float vLight; varying vec2 vXZ; varying float vDist;
      void main() {
        // NASA LRO colour of a patch around Mare Tranquillitatis, stretched over the whole field.
        vec3 tone = texture2D(macro, vec2(0.555, 0.53) + vXZ * vec2(0.00022, -0.00044)).rgb;
        tone = tone / max(0.001, dot(tone, vec3(0.333))) * 0.5;
        float d1 = texture2D(detail, vXZ / 3.1).r, d2 = texture2D(detail, vXZ / 17.3 + 0.37).r, d3 = texture2D(detail, vXZ * 1.7).r;
        float grain = d1 * 0.55 + d2 * 0.45;
        grain = mix(grain, grain * (0.75 + 0.5 * d3), smoothstep(8.0, 1.0, vDist));
        vec3 c = tone * (0.35 + 0.75 * grain) * 0.62 * vLight;
        gl_FragColor = vec4(c, opacity);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(g, m);
}

/** Builds the Moon hub. Resolves to a Group (floor at y = 0 where you start) like a splat world's. */
export async function buildMoon() {
  const loader = new THREE.TextureLoader();
  const load = (url) =>
    new Promise((res) =>
      loader.load(url, (t) => ((t.colorSpace = THREE.SRGBColorSpace), res(t)), undefined, () => res(null)),
    );
  const [earthTex, lroc] = await Promise.all([load("/moon/earth.jpg"), load("/moon/lroc_color.jpg")]);
  await new Promise((r) => setTimeout(r, 30)); // let a loading message paint before the heavy part
  const height = buildHeights();
  const lm = lander(height(-9, -12));
  const ground = terrain(height, lm.boxes, { detail: detailTexture(), macro: lroc ?? new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1) });
  const holder = new THREE.Group();
  holder.add(stars(), sunDisc(), ground, lm.group);
  if (earthTex) holder.add(earth(earthTex));
  const mats = [];
  holder.traverse((o) => o.material && !mats.includes(o.material) && mats.push(o.material));
  let current = 1;
  const fader = {
    get opacity() {
      return current;
    },
    set opacity(v) {
      if (v === current) return;
      current = v;
      for (const m of mats) {
        if (m.uniforms?.opacity) m.uniforms.opacity.value = v;
        else m.opacity = v;
        if (m.blending === THREE.AdditiveBlending) continue;
        const t = v < 1;
        if (m.transparent !== t) ((m.transparent = t), (m.needsUpdate = true));
      }
    },
    dispose() {},
  };
  fader.opacity = 0;
  holder.userData = { id: "moon", mesh: fader, title: "the Moon", sky: new THREE.Color(0x000000) };
  return holder;
}
