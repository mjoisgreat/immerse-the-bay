// Drawing a heart in the air (or with a finger): recognised from any start, either direction, a bit wobbly;
// squares, circles and scribbles are not hearts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeart } from "../src/heartshape.js";

const eye = [0, 1.6, 0];
// A shape drawn on an upright plane 45 cm in front of you, `size` metres across.
function stroke(f, { n = 90, size = 0.3, start = 0, dir = 1, wobble = 0, sx = 1, sy = 1, seed = 1 } = {}) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return Array.from({ length: n }, (_, i) => {
    const t = start + dir * (i / (n - 1)) * Math.PI * 2;
    const [x, y] = f(t);
    return [x * size * sx + rand() * wobble, 1.4 + y * size * sy + rand() * wobble, -0.45];
  });
}
// Heart curve scaled to about 1 across.
const heart = (t) => [(16 * Math.sin(t) ** 3) / 33, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 33];
const circle = (t) => [Math.cos(t) / 2, Math.sin(t) / 2];
const square = (t) => {
  const u = ((t / (Math.PI * 2)) % 1 + 1) % 1 * 4;
  const k = u % 1;
  return [[-0.5 + k, 0.5], [0.5, 0.5 - k], [0.5 - k, -0.5], [-0.5, -0.5 + k]][Math.floor(u)];
};

test("a heart is a heart, from the top dip, the bottom point or a lobe, in either direction", () => {
  for (const start of [0, Math.PI, Math.PI / 2, -Math.PI / 3])
    for (const dir of [1, -1]) assert.equal(analyzeHeart(stroke(heart, { start, dir }), eye).heart, true, `start ${start} dir ${dir}`);
});
test("a wobbly, stretched, small or big heart still counts", () => {
  assert.equal(analyzeHeart(stroke(heart, { wobble: 0.012 }), eye).heart, true);
  assert.equal(analyzeHeart(stroke(heart, { sx: 1.25 }), eye).heart, true);
  assert.equal(analyzeHeart(stroke(heart, { sy: 1.2 }), eye).heart, true);
  assert.equal(analyzeHeart(stroke(heart, { size: 0.15 }), eye).heart, true);
  assert.equal(analyzeHeart(stroke(heart, { size: 0.6, n: 200 }), eye).heart, true);
});
test("a square (a window frame), a circle and an upside-down heart are not hearts", () => {
  assert.equal(analyzeHeart(stroke(square), eye).heart, false);
  assert.equal(analyzeHeart(stroke(square, { sx: 1.6 }), eye).heart, false);
  assert.equal(analyzeHeart(stroke(circle), eye).heart, false);
  assert.equal(analyzeHeart(stroke(heart, { sy: -1 }), eye).heart, false);
});
test("too small, not closed, or a scribble is not a heart", () => {
  assert.equal(analyzeHeart(stroke(heart, { size: 0.05 }), eye).heart, false);
  const open = stroke(heart).slice(0, 55);
  assert.equal(analyzeHeart(open, eye).heart, false);
  const scribble = stroke((t) => [Math.sin(5 * t) / 2, Math.cos(3 * t) / 2]);
  assert.equal(analyzeHeart(scribble, eye).heart, false);
  assert.equal(analyzeHeart([], eye).heart, false);
});
test("a heart drawn the way people draw it (point, straight sides, two round lobes) counts; a triangle doesn't", () => {
  const P = (pts) => pts.map(([x, y]) => [x * 0.3, 1.4 + y * 0.3, -0.45]);
  const build = (f) => {
    const out = [];
    const seg = (a, b, n) => { for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
    const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    f(seg, arc);
    return out;
  };
  const people = build((seg, arc) => { seg([0, -0.55], [-0.5, 0.05], 20); arc(-0.25, 0.15, 0.27, Math.PI + 0.38, 0, 25); arc(0.25, 0.15, 0.27, Math.PI, -0.38, 25); seg([0.5, 0.05], [0, -0.55], 20); });
  assert.equal(analyzeHeart(P(people), eye).heart, true);
  assert.equal(analyzeHeart(P(people.map(([x, y]) => [x * 1.3, y])), eye).heart, true);
  const tri = build((seg) => { seg([-0.5, 0.4], [0.5, 0.4], 25); seg([0.5, 0.4], [0, -0.5], 25); seg([0, -0.5], [-0.5, 0.38], 25); });
  assert.equal(analyzeHeart(P(tri), eye).heart, false);
});
test("hand-drawn hearts that miss the textbook curve count (boxy, flat lobes, overshooting the start); frames still don't", () => {
  const P = (pts) => pts.map(([x, y]) => [x * 0.3, 1.4 + y * 0.3, -0.45]);
  const build = (f) => {
    const out = [];
    const seg = (a, b, n) => { for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
    const arc = (cx, cy, r, a0, a1, n, ry = r) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + r * Math.cos(a), cy + ry * Math.sin(a)]); } };
    f(seg, arc);
    return out;
  };
  // Wide, with flat lobes and a short point: used to fall through and open a window.
  const boxy = build((seg, arc) => { seg([0, -0.3], [-0.6, 0.1], 20); arc(-0.3, 0.15, 0.3, Math.PI, 0, 25, 0.15); arc(0.3, 0.15, 0.3, Math.PI, 0, 25, 0.15); seg([0.6, 0.1], [0, -0.3], 20); });
  assert.equal(analyzeHeart(P(boxy), eye).heart, true);
  // Started in the dip, lopsided, and ran on past the start.
  const over = build((seg, arc) => { arc(-0.25, 0.15, 0.27, 0, Math.PI + 0.38, 25); seg([-0.5, 0.05], [0, -0.55], 20); seg([0, -0.55], [0.55, 0.1], 20); arc(0.28, 0.15, 0.28, 0, Math.PI, 25); seg([0, 0.15], [-0.08, 0.2], 6); });
  assert.equal(analyzeHeart(P(over), eye).heart, true);
  const frame = (pts) => build((seg) => pts.forEach((p, i) => seg(p, pts[(i + 1) % pts.length], 20)));
  assert.equal(analyzeHeart(P(frame([[-0.5, 0.45], [0.5, 0.55], [0.45, -0.5], [-0.5, -0.45]])), eye).heart, false); // a sloppy square
  assert.equal(analyzeHeart(P(frame([[-0.5, 0.5], [0.5, 0.5], [0.3, -0.5], [-0.3, -0.5]])), eye).heart, false); // a trapezoid
  assert.equal(analyzeHeart(P(frame([[-0.8, 0.5], [0.8, 0.5], [0.8, -0.5], [-0.8, -0.5]])), eye).heart, false); // a wide frame
});
