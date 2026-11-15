// Drawing a window: pinch in empty space, draw a square or rectangle in the air, let go.
// analyzeStroke() decides whether the stroke was a frame and where the window goes. It is pure
// (arrays in, plain objects out) so it can be tested without a headset.
//
// The stroke is flattened onto an upright plane facing you, and must be:
//   - big enough (each side at least MIN_SIDE), closed (it ends near where it started),
//   - long enough to go round (not a flick), and touch all four sides of its bounding box.
// The window is then "projected" onto the wall: placed DISTANCE metres away along your line of
// sight through the drawing, scaled so it looks exactly as big as what you drew.
import { MIN_SCALE, MAX_SCALE } from "./portalresize.js";

const MIN_SIDE = 0.12; // metres
const MIN_POINTS = 10;
export const DISTANCE = 1.8; // where windows sit (metres from your eyes)
const PORTAL_W = 1.6, PORTAL_H = 0.9; // a window's size at scale 1

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * points: [[x, y, z], ...] in world space (the pinch path); eye: [x, y, z].
 * Returns { ok: true, position, scale, size: [w, h] } or { ok: false, reason }.
 */
export function analyzeStroke(points, eye) {
  if (!points || points.length < MIN_POINTS) return { ok: false, reason: "short" };
  const c = scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
  // Upright plane facing you: normal = horizontal direction from the drawing to your eyes.
  let n = sub(eye, c);
  n[1] = 0;
  const nl = len(n);
  if (nl < 0.05) return { ok: false, reason: "overhead" };
  n = scale(n, 1 / nl);
  const right = [-n[2], 0, n[0]]; // up × n
  const pts = points.map((p) => {
    const d = sub(p, c);
    return [dot(d, right), d[1]];
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < MIN_SIDE || h < MIN_SIDE) return { ok: false, reason: "small" };

  // Closed: it ends near where it started.
  const gap = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  if (gap > Math.max(0.12, 0.35 * Math.max(w, h))) return { ok: false, reason: "open" };

  // Goes all the way round: path length close to the frame's perimeter.
  let path = 0;
  for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (path < 1.5 * (w + h)) return { ok: false, reason: "scribble" };

  // Touches all four sides of its box (a frame, not a blob in one corner).
  const tol = 0.2 * Math.min(w, h) + 0.02;
  const near = [
    pts.filter((p) => p[0] - minX < tol).length,
    pts.filter((p) => maxX - p[0] < tol).length,
    pts.filter((p) => p[1] - minY < tol).length,
    pts.filter((p) => maxY - p[1] < tol).length,
  ];
  if (near.some((k) => k < Math.max(2, pts.length * 0.06))) return { ok: false, reason: "shape" };

  // Centre of the drawn frame (its box centre, not the point average).
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const center = add(add(c, scale(right, cx)), [0, cy, 0]);
  // Project onto the wall: same apparent size, DISTANCE away along your line of sight through it.
  const toCenter = sub(center, eye);
  const drawnDist = Math.max(0.2, len(toCenter));
  const k = DISTANCE / drawnDist;
  const position = add(eye, scale(toCenter, k));
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.max((w * k) / PORTAL_W, (h * k) / PORTAL_H)));
  return { ok: true, position, scale: s, size: [w, h] };
}

/** A friendly hint for a stroke that didn't count. */
export function strokeHint(reason) {
  return (
    {
      small: "Draw it bigger: a square about the size of your face or more.",
      open: "Close the square: end where you started.",
      scribble: "Draw all four sides of a square.",
      shape: "Draw a square or rectangle, all four sides.",
      overhead: "Draw the square in front of you.",
    }[reason] || "Pinch and draw a square in the air to open a window."
  );
}
