// Where the companion goes to open a window, and where the window appears. Pure maths on the floor
// plane ({ x, z }), so it can be tested without a headset.

/**
 * The spot on the floor for `place` ("here" | "ahead" | "left" | "right" | "behind"), relative to where
 * you stand (`eye`) and look (`fwd`, a unit vector on the floor plane). "here" is just beside you,
 * ahead and to the left, so she stays in view.
 */
export function spotFor(place, eye, fwd, dist = 2.2) {
  const left = { x: fwd.z, z: -fwd.x }; // 90° to the left of where you look
  let d, r = dist;
  switch (place) {
    case "ahead": d = fwd; break;
    case "left": d = left; break;
    case "right": d = { x: -left.x, z: -left.z }; break;
    case "behind": d = { x: -fwd.x, z: -fwd.z }; break;
    default: {
      d = { x: fwd.x * 0.9 + left.x * 0.45, z: fwd.z * 0.9 + left.z * 0.45 };
      const l = Math.hypot(d.x, d.z) || 1;
      d = { x: d.x / l, z: d.z / l };
      r = Math.min(dist, 1.5);
    }
  }
  return { x: eye.x + d.x * r, z: eye.z + d.z * r };
}

/** The window stands just behind her, as seen from you, at `y`. */
export function windowSpot(spot, eye, y = 1.4, behind = 0.7) {
  const dx = spot.x - eye.x, dz = spot.z - eye.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: spot.x + (dx / l) * behind, y, z: spot.z + (dz / l) * behind };
}

// ---------- Where a window she opens goes, so several sit side by side ----------
// Windows go on an arc around you at `r` metres, at the angle for `place` (0 = where you look, positive =
// to your left). If that spot is taken (another window within `gapDeg`), the next free spot is used,
// alternating sides and staying as close to the asked-for direction as possible: two or three windows
// line up neatly instead of landing on top of each other. Bonnie stands beside the window, at its edge
// nearer the middle of your view and a little in front of it, so she never hides it.
const PLACE_DEG = { here: 0, ahead: 0, left: 70, right: -70, behind: 180 };

const angleOf = (p, eye, fwd) => {
  const dx = p.x - eye.x, dz = p.z - eye.z;
  const left = { x: fwd.z, z: -fwd.x };
  return (Math.atan2(dx * left.x + dz * left.z, dx * fwd.x + dz * fwd.z) * 180) / Math.PI;
};
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * `existing`: floor positions ({ x, z }) of the windows already open. `halfWidth`: half a window's width (m).
 * Returns { window: { x, z }, stand: { x, z }, angle } — angle in degrees, positive = left of where you look.
 */
export function windowSlot(place, eye, fwd, existing = [], { r = 2.2, gapDeg = 46, halfWidth = 0.8 } = {}) {
  const base = PLACE_DEG[place] ?? 0;
  const taken = existing.map((p) => angleOf(p, eye, fwd));
  // Toward the middle of your view first when asked for a side (left/right): the next spot is nearer the front.
  const towardFront = base > 0 ? -1 : base < 0 ? 1 : 1;
  const order = [0];
  for (let k = 1; k <= 3; k++) order.push(k * towardFront, -k * towardFront);
  let angle = base;
  for (const k of order) {
    const a = base + k * gapDeg;
    if (taken.every((t) => angDiff(a, t) >= gapDeg - 1e-6)) {
      angle = a;
      break;
    }
  }
  const rad = (angle * Math.PI) / 180;
  const left = { x: fwd.z, z: -fwd.x };
  const dir = { x: fwd.x * Math.cos(rad) + left.x * Math.sin(rad), z: fwd.z * Math.cos(rad) + left.z * Math.sin(rad) };
  const win = { x: eye.x + dir.x * r, z: eye.z + dir.z * r };
  // Beside it: along the window's face toward the middle of your view, and a step toward you.
  const across = { x: -dir.z, z: dir.x }; // the window's own "left", as you face it
  const side = angle > 0 ? -1 : 1; // a window on your left: she stands on its right-hand edge (toward the middle)
  const stand = {
    x: win.x + across.x * side * (halfWidth + 0.3) - dir.x * 0.5,
    z: win.z + across.z * side * (halfWidth + 0.3) - dir.z * 0.5,
  };
  return { window: win, stand, angle };
}
