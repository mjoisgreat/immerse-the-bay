// Drawing a window: pinch in empty space and draw a circle in the air, round and round (at least twice,
// like a sorcerer opening a portal), then let go. analyzeStroke() decides whether the stroke was such a
// circle and where the window goes. It is pure (arrays in, plain objects out) so it can be tested without
// a headset.
//
// The stroke is flattened onto an upright plane facing you, and must be:
//   - big enough (a diameter of at least MIN_SIDE), and round (every point about the same distance from
//     the middle, so a squiggle or a square doesn't count),
//   - drawn all the way round MIN_ROUNDS times in one direction.
// The window is then "projected" onto the wall: placed DISTANCE metres away along your line of sight
// through the middle of the circle, as wide as the circle looked.
import { MIN_SCALE, MAX_SCALE } from "./portalresize.js";

const MIN_SIDE = 0.12; // the circle's diameter, metres
const MIN_POINTS = 24;
export const MIN_ROUNDS = 2; // full turns of the circle
const ROUND_SLACK = 0.95; // a hand that stops a touch short of the second round still counts
const MAX_SPREAD = 0.25; // how far a point may stray from the circle's radius (relative std. deviation)
export const DISTANCE = 1.8; // where windows sit (metres from your eyes)
const PORTAL_W = 1.6; // a window's width at scale 1

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * points: [[x, y, z], ...] in world space (the pinch path); eye: [x, y, z].
 * Returns { ok: true, position, scale, size: [w, h], rounds } or { ok: false, reason }.
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
  // The middle of the circle: the average of the points (many full turns, so the bias is small).
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const rm = radii.reduce((a, r) => a + r, 0) / radii.length;
  if (rm * 2 < MIN_SIDE) return { ok: false, reason: "small" };
  const spread = Math.sqrt(radii.reduce((a, r) => a + (r - rm) ** 2, 0) / radii.length) / rm;
  if (spread > MAX_SPREAD) return { ok: false, reason: "round" };

  // Turns: add up the angle swept around the middle, point to point (a swipe or a square's corners wobble).
  let total = 0, travelled = 0;
  for (let i = 1; i < pts.length; i++) {
    let d = Math.atan2(pts[i][1] - cy, pts[i][0] - cx) - Math.atan2(pts[i - 1][1] - cy, pts[i - 1][0] - cx);
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    travelled += Math.abs(d);
  }
  const rounds = Math.abs(total) / (2 * Math.PI);
  if (travelled > Math.abs(total) * 1.25 + 0.5) return { ok: false, reason: "round" }; // went back and forth
  if (rounds < MIN_ROUNDS * ROUND_SLACK) return { ok: false, reason: "rounds" };

  // Centre of the drawn circle, in the world.
  const center = add(add(c, scale(right, cx)), [0, cy, 0]);
  // Project onto the wall: same apparent size, DISTANCE away along your line of sight through it.
  const toCenter = sub(center, eye);
  const drawnDist = Math.max(0.2, len(toCenter));
  const k = DISTANCE / drawnDist;
  const position = add(eye, scale(toCenter, k));
  const d = rm * 2;
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (d * k) / PORTAL_W));
  return { ok: true, position, scale: s, size: [d, d], rounds };
}

/** A friendly hint for a stroke that didn't count. */
export function strokeHint(reason) {
  return (
    {
      small: "Draw it bigger: a circle about the size of your face or more.",
      round: "Draw a round circle, going round and round the same way.",
      rounds: "Keep going: draw the circle at least two full times.",
      overhead: "Draw the circle in front of you.",
    }[reason] || "Pinch and draw a circle in the air, round and round, to open a window."
  );
}
