// Tiny hand-rolled physics for throwing the companion around: a bouncing ball (gravity, floor,
// a rough room box, flat rectangles such as the story windows), plus the hand-velocity estimate
// and tap-vs-grab test used when you let go. Pure: plain {x, y, z} objects, no three.js, no DOM.

export const PHYSICS = {
  gravity: 9.8, // m/s²
  restitution: 0.55, // share of the normal speed kept on a bounce
  bounceFriction: 0.75, // share of the sideways speed kept on a floor bounce
  rollDrag: 2.5, // 1/s, slows it down while it rolls on the floor
  minBounce: 0.9, // m/s: slower floor hits don't bounce, it stays down
  restSpeed: 0.15, // m/s: on the floor and slower than this = at rest
  maxStep: 1 / 90, // s: longer frames are split up, so fast throws don't tunnel
};

const AXES = ["x", "y", "z"];
const NO_RECTS = [];
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** A short press that barely moved is a tap (toggle follow), anything else is a grab / throw. */
export function isTap(ms, travel, { maxMs = 300, maxTravel = 0.08 } = {}) {
  return ms < maxMs && travel < maxTravel;
}

/** Estimates the hand's velocity from its positions over the last few frames. */
export class VelocityTracker {
  constructor(windowMs = 110) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  reset() {
    this.samples.length = 0;
  }

  push(p, tMs) {
    this.samples.push({ x: p.x, y: p.y, z: p.z, t: tMs });
    while (this.samples.length > 2 && tMs - this.samples[0].t > this.windowMs) this.samples.shift();
  }

  /** Average velocity (m/s) over the window; zero until there are two samples. */
  velocity(maxSpeed = Infinity) {
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    const dt = a && b ? (b.t - a.t) / 1000 : 0;
    if (!(dt > 1e-4)) return { x: 0, y: 0, z: 0 };
    const v = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > maxSpeed) (v.x *= maxSpeed / speed), (v.y *= maxSpeed / speed), (v.z *= maxSpeed / speed);
    return v;
  }
}

function bounceAxis(body, axis, limit, sign, e) {
  // sign = +1: must stay above `limit`; -1: must stay below it.
  const edge = body.pos[axis] - sign * body.radius;
  if ((edge - limit) * sign >= 0) return 0;
  body.pos[axis] = limit + sign * body.radius;
  const into = -body.vel[axis] * sign;
  if (into <= 0) return 0;
  body.vel[axis] = sign * into * e;
  return into;
}

function bounceRect(body, r, e) {
  const rel = { x: body.pos.x - r.center.x, y: body.pos.y - r.center.y, z: body.pos.z - r.center.z };
  const d = dot(rel, r.normal);
  if (Math.abs(d) >= body.radius) return 0;
  if (Math.abs(dot(rel, r.right)) > r.halfW + body.radius * 0.5 || Math.abs(dot(rel, r.up)) > r.halfH + body.radius * 0.5) return 0;
  const side = d >= 0 ? 1 : -1;
  const into = -dot(body.vel, r.normal) * side;
  if (into <= 0) return 0; // already moving away
  const push = (body.radius - Math.abs(d)) * side;
  const k = (1 + e) * into * side;
  for (const a of AXES) (body.pos[a] += r.normal[a] * push), (body.vel[a] += r.normal[a] * k);
  return into;
}

/**
 * Advances a ball by dt. body: { pos, vel, radius }. env: { floorY = 0, bounds: { minX, maxX, minZ,
 * maxZ, maxY } | null, rects: [{ center, normal, right, up, halfW, halfH }] } (unit vectors).
 * Returns { impact, floor, resting }: the hardest hit this step (m/s into the surface, 0 = none),
 * whether that was the floor, and whether it has come to rest on the floor.
 */
export function stepBody(body, dt, env = {}, P = PHYSICS) {
  const { floorY = 0, bounds = null, rects = NO_RECTS } = env;
  const out = { impact: 0, floor: false, resting: false };
  const n = Math.max(1, Math.ceil(dt / P.maxStep));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    body.vel.y -= P.gravity * h;
    for (const a of AXES) body.pos[a] += body.vel[a] * h;

    let grounded = false;
    if (body.pos.y - body.radius <= floorY) {
      body.pos.y = floorY + body.radius;
      const into = -body.vel.y;
      if (into > P.minBounce) {
        body.vel.y = into * P.restitution;
        body.vel.x *= P.bounceFriction;
        body.vel.z *= P.bounceFriction;
        if (into > out.impact) (out.impact = into), (out.floor = true);
      } else if (into >= 0) {
        body.vel.y = 0;
        grounded = true;
      }
    }
    if (grounded) {
      const k = Math.exp(-P.rollDrag * h);
      body.vel.x *= k;
      body.vel.z *= k;
    }
    const hit = (into) => into > out.impact && ((out.impact = into), (out.floor = false));
    if (bounds) {
      hit(bounceAxis(body, "x", bounds.minX, 1, P.restitution));
      hit(bounceAxis(body, "x", bounds.maxX, -1, P.restitution));
      hit(bounceAxis(body, "z", bounds.minZ, 1, P.restitution));
      hit(bounceAxis(body, "z", bounds.maxZ, -1, P.restitution));
      if (bounds.maxY !== undefined) hit(bounceAxis(body, "y", bounds.maxY, -1, P.restitution));
    }
    for (const r of rects) hit(bounceRect(body, r, P.restitution));
    out.resting = grounded && Math.hypot(body.vel.x, body.vel.z) < P.restSpeed;
    if (out.resting) (body.vel.x = 0), (body.vel.z = 0);
  }
  return out;
}
