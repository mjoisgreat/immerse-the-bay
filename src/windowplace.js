// Where the window may physically be. Pure maths (arrays in, plain objects out) so it is testable without a headset.
//
// The picture is recessed into the wall behind an opening. The window stays a
// minimum distance from the viewer and off the floor (the floor is y = 0), and under the ceiling.

export const WIN_W = 1.6, WIN_H = 0.9; // the opening at scale 1 (16:9, like Orbis output)
export const WIN_DEPTH = 0.32; // how far the picture sits behind the front of the frame

export const MIN_BOTTOM = 0.6; // lowest the opening's bottom edge may be above the floor (m)
export const MAX_TOP = 2.9; // highest the opening's top edge may be (m)
export const MIN_DIST = 1.1; // nearest the window's centre may be to the viewer, at scale 1 (m, horizontal)

/** Nearest allowed distance from the viewer: a bigger window needs more room to be looked at. */
export const minDistance = (scale) => MIN_DIST + 0.25 * scale;

/** Allowed height range for the window's centre at this scale. */
export function heightRange(scale) {
  return [MIN_BOTTOM + (WIN_H / 2) * scale, MAX_TOP - (WIN_H / 2) * scale];
}

/**
 * pos: [x, y, z] where the window would like to be; scale; eye: [x, y, z].
 * Returns the nearest allowed position: lifted off the floor, under the ceiling, and pushed away from you
 * if it is too close.
 */
export function resolveWindow(pos, scale, eye) {
  const [lo, hi] = heightRange(scale);
  let p = [pos[0], Math.min(hi, Math.max(lo, pos[1])), pos[2]];
  const need = minDistance(scale);
  const dx = p[0] - eye[0], dz = p[2] - eye[2], dist = Math.hypot(dx, dz);
  if (dist < need) {
    const [ux, uz] = dist > 1e-3 ? [dx / dist, dz / dist] : [0, -1]; // dead centre on you: straight ahead
    p = [eye[0] + ux * need, p[1], eye[2] + uz * need];
  }
  return p;
}
