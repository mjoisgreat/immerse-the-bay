// Is a drawn stroke a heart? Pure maths (arrays in, a verdict out), so it can be tested without a headset.
//
// The stroke (world points from a pinch in the headset, or a finger on a phone) is flattened onto an
// upright plane facing you, resampled to N evenly spaced points, centred and scaled, then compared with
// outlines of a heart, a circle and a rectangle. A closed shape can be drawn from any starting point and
// in either direction, so every start and both directions are tried. It is a heart when it is close to
// the heart outline and clearly closer to it than to a circle or a rectangle (so drawing a window frame
// still opens a window, and a round loop isn't mistaken for a heart).

const N = 64;
const MIN_SIZE = 0.08; // metres: smaller is a twitch, not a drawing
const MAX_SCORE = 0.085; // mean distance to the heart outline, as a fraction of the drawing's size
const MARGIN = 0.65; // the heart must fit this much better than the circle and the rectangle

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World points → [x, y] on an upright plane facing `eye` (x to your right, y up). */
export function flatten(points, eye) {
  const c = [0, 0, 0];
  for (const p of points) (c[0] += p[0]), (c[1] += p[1]), (c[2] += p[2]);
  c[0] /= points.length, c[1] /= points.length, c[2] /= points.length;
  let nx = eye[0] - c[0], nz = eye[2] - c[2];
  const nl = Math.hypot(nx, nz);
  if (nl < 0.05) return null; // drawn overhead
  (nx /= nl), (nz /= nl);
  const right = [-nz, 0, nx];
  return points.map((p) => {
    const d = sub(p, c);
    return [dot(d, right), d[1]];
  });
}

/** `pts` resampled to `n` points evenly spaced along the path. */
function resample(pts, n = N) {
  const out = [pts[0]];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total === 0) return null;
  const step = total / (n - 1);
  let acc = 0, prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
      out.push(q);
      prev = q;
      d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push(pts.at(-1));
  return out;
}

/** Centred on its centroid and scaled so its larger side is 1 (keeps the aspect: hearts aren't circles). */
function normalise(pts) {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) (cx += x), (cy += y);
  (cx /= pts.length), (cy /= pts.length);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  return pts.map(([x, y]) => [(x - cx) / size, (y - cy) / size]);
}

/** A closed outline from a parametric curve, as N points. */
const outline = (f) => normalise(resample(Array.from({ length: 400 }, (_, i) => f((i / 399) * Math.PI * 2))));
const TEMPLATES = {
  // The classic heart curve: dip at the top, point at the bottom.
  heart: outline((t) => [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]),
  circle: outline((t) => [Math.cos(t), Math.sin(t)]),
  rect: outline((t) => {
    // A 1.6 × 1 rectangle's perimeter, walked evenly.
    const u = (t / (Math.PI * 2)) * 5.2;
    return u < 1.6 ? [u - 0.8, 0.5] : u < 2.6 ? [0.8, 0.5 - (u - 1.6)] : u < 4.2 ? [0.8 - (u - 2.6), -0.5] : [-0.8, -0.5 + (u - 4.2)];
  }),
};

/** Mean distance from the stroke to a closed template, at the best start point and direction. */
function score(stroke, tpl) {
  let best = Infinity;
  for (const dir of [1, -1])
    for (let s = 0; s < N; s++) {
      let sum = 0;
      for (let i = 0; i < N && sum < best * N; i++) {
        const q = tpl[(((s + dir * i) % N) + N) % N];
        sum += Math.hypot(stroke[i][0] - q[0], stroke[i][1] - q[1]);
      }
      best = Math.min(best, sum / N);
    }
  return best;
}

/**
 * points: [[x, y, z], ...] world positions of the stroke; eye: [x, y, z].
 * Returns { heart: boolean, scores: { heart, circle, rect }, center: [x, y, z] | null }.
 */
export function analyzeHeart(points, eye) {
  const no = { heart: false, scores: null, center: null };
  if (!points || points.length < 12) return no;
  const flat = flatten(points, eye);
  if (!flat) return no;
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  if (Math.max(w, h) < MIN_SIZE) return no;
  // Closed: ends near where it started.
  const gap = Math.hypot(flat[0][0] - flat.at(-1)[0], flat[0][1] - flat.at(-1)[1]);
  if (gap > 0.35 * Math.max(w, h)) return no;
  const rs = resample(flat);
  if (!rs) return no;
  const stroke = normalise(rs);
  const scores = { heart: score(stroke, TEMPLATES.heart), circle: score(stroke, TEMPLATES.circle), rect: score(stroke, TEMPLATES.rect) };
  const heart = scores.heart < MAX_SCORE && scores.heart < MARGIN * Math.min(scores.circle, scores.rect);
  const c = [0, 0, 0];
  for (const p of points) (c[0] += p[0]), (c[1] += p[1]), (c[2] += p[2]);
  return { heart, scores, center: [c[0] / points.length, c[1] / points.length, c[2] / points.length] };
}
