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
// Or, for hand-drawn hearts that miss the textbook curve: a tip at the bottom and a dip at the top.
const TIP_MAX = 0.55; // width a sixth of the way up, as a fraction of the full width
const DIP_MIN = 0.08; // how far the middle of the top sits below the lobes, as a fraction of the height
const LOOSE_SCORE = 0.2; // and still roughly heart-like

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
 * People overshoot when closing a shape in the air: the tail runs on past the start. Cut the stroke at
 * the point of its last quarter that comes closest to the start, so the outline goes round exactly once.
 */
function trimOvershoot(pts) {
  const n = pts.length;
  let best = n - 1, bestD = Infinity;
  for (let i = Math.floor(n * 0.75); i < n; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d < bestD) (bestD = d), (best = i);
  }
  return pts.slice(0, best + 1);
}

/** x of every crossing of the closed outline with the horizontal line y = v (or vertical x = v when `vertical`). */
function crossings(pts, v, vertical) {
  const a = vertical ? 0 : 1, b = vertical ? 1 : 0, out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    if ((p[a] - v) * (q[a] - v) > 0 || p[a] === q[a]) continue;
    out.push(p[b] + ((v - p[a]) / (q[a] - p[a])) * (q[b] - p[b]));
  }
  return out;
}

/**
 * What makes a heart a heart, whatever the exact curve: a point at the bottom (the outline narrows to a
 * tip near the middle) and a dip in the top between two lobes. A window frame has neither (its bottom is
 * as wide as its top, its top is flat), a circle has neither, a point-down triangle has no dip.
 * `pts` is normalised (centred, larger side 1). Returns { tip, dip } as fractions of width / height.
 */
function heartFeatures(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = x1 - x0, H = y1 - y0;
  // Bottom: how wide the outline is a sixth of the way up (≈1 for a frame, ≈0.75 for a circle, small for a tip),
  // and whether the lowest point is near the middle.
  const c = crossings(pts, y0 + H / 6);
  const narrow = c.length ? (Math.max(...c) - Math.min(...c)) / W : 1;
  const low = pts.reduce((m, p) => (p[1] < m[1] ? p : m));
  const centred = Math.abs((low[0] - x0) / W - 0.5) < 0.25;
  // Top: the lowest top edge in the middle third vs. the highest top edge left and right of it (the lobes).
  const top = (u) => {
    const k = crossings(pts, x0 + u * W, true);
    return k.length ? Math.max(...k) : -Infinity;
  };
  let mid = Infinity, left = -Infinity, right = -Infinity;
  for (let u = 0.05; u < 0.96; u += 0.025) {
    const t = top(u);
    if (u < 0.4) left = Math.max(left, t);
    else if (u > 0.6) right = Math.max(right, t);
    if (u > 0.33 && u < 0.67) mid = Math.min(mid, t); // the bottom of the dip, wherever it is near the middle
  }
  const dip = (Math.min(left, right) - mid) / H;
  return { tip: centred ? narrow : 1, dip };
}

/**
 * points: [[x, y, z], ...] world positions of the stroke; eye: [x, y, z].
 * Returns { heart: boolean, scores: { heart, circle, rect }, features: { tip, dip }, center: [x, y, z] | null }.
 */
export function analyzeHeart(points, eye) {
  const no = { heart: false, scores: null, center: null };
  if (!points || points.length < 12) return no;
  let flat = flatten(points, eye);
  if (!flat) return no;
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  if (Math.max(w, h) < MIN_SIZE) return no;
  // Closed: ends near where it started (as forgiving as a window frame, so a heart is never "more open" than one).
  flat = trimOvershoot(flat);
  const gap = Math.hypot(flat[0][0] - flat.at(-1)[0], flat[0][1] - flat.at(-1)[1]);
  if (gap > Math.max(0.12, 0.35 * Math.max(w, h))) return no;
  // Goes round once, not a scribble.
  let path = 0;
  for (let i = 1; i < flat.length; i++) path += Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]);
  if (path > 2.6 * (w + h)) return no;
  const rs = resample(flat);
  if (!rs) return no;
  const stroke = normalise(rs);
  const scores = { heart: score(stroke, TEMPLATES.heart), circle: score(stroke, TEMPLATES.circle), rect: score(stroke, TEMPLATES.rect) };
  const features = heartFeatures(stroke);
  // Either it matches the heart outline clearly, or it has a heart's tip and dip and is roughly heart-like
  // (hand-drawn hearts are often boxy, lopsided or flat-lobed and miss the textbook curve).
  const byOutline = scores.heart < MAX_SCORE && scores.heart < MARGIN * Math.min(scores.circle, scores.rect);
  const byShape = features.tip < TIP_MAX && features.dip > DIP_MIN && scores.heart < LOOSE_SCORE;
  const heart = byOutline || byShape;
  const c = [0, 0, 0];
  for (const p of points) (c[0] += p[0]), (c[1] += p[1]), (c[2] += p[2]);
  return { heart, scores, features, center: [c[0] / points.length, c[1] / points.length, c[2] / points.length] };
}
