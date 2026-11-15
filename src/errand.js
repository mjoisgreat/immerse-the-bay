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
