// The outline of a window's opening: a slightly squarish oval whose edge wobbles slowly, like a
// burning hole in space. The same shape in JS (the sparks) and GLSL (the picture's edge), so they agree.
// Polar: radius at angle `a` (radians, from +x) at time `t` (seconds), in metres, for a W x H window.

const N = 2.5; // superellipse exponent: 2 is an ellipse, higher is squarer
const FIT = 0.9; // leaves room for the wobble inside the W x H picture

// Each wave: [lobes round the rim, amplitude (fraction of radius), speed]. Integer lobes: no seam.
const WAVES = [
  [3, 0.035, 0.9],
  [5, 0.025, -1.3],
  [8, 0.012, 2.1],
];

export function rimRadius(a, t, W, H) {
  const c = Math.abs(Math.cos(a)) / ((W / 2) * FIT), s = Math.abs(Math.sin(a)) / ((H / 2) * FIT);
  let r = (c ** N + s ** N) ** (-1 / N);
  let w = 1;
  WAVES.forEach(([k, amp, sp], i) => (w += amp * Math.sin(k * a + sp * t + i * 1.7)));
  return r * w;
}

/** GLSL: `float rimRadius(float a, float t)`, the same function for this window size. */
export function rimRadiusGLSL(W, H) {
  const f = (x) => x.toFixed(4);
  const waves = WAVES.map(([k, amp, sp], i) => `${f(amp)} * sin(${f(k)} * a + ${f(sp)} * t + ${f(i * 1.7)})`).join(" + ");
  return /* glsl */ `
float rimRadius(float a, float t) {
  float c = abs(cos(a)) / ${f((W / 2) * FIT)}, s = abs(sin(a)) / ${f((H / 2) * FIT)};
  float r = pow(pow(c, ${f(N)}) + pow(s, ${f(N)}), ${f(-1 / N)});
  return r * (1.0 + ${waves});
}`;
}

/**
 * Maps u in 0..1 (even spacing along the rim, ignoring the small wobble) to an angle, going clockwise,
 * so sparks are spread evenly along the edge instead of bunching where it curves fastest.
 */
export function rimAngleTable(W, H, n = 512) {
  const cum = [0];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, r = rimRadius(a, 0, W, H);
    const p = [r * Math.cos(a), r * Math.sin(a)];
    if (prev) cum.push(cum[cum.length - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[n];
  return (u) => {
    const target = (((u % 1) + 1) % 1) * total;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid;
      else hi = mid;
    }
    const f = (target - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return -((lo + f) / n) * Math.PI * 2; // negative: clockwise
  };
}
