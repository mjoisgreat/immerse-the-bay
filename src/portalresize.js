// Two-hand resize of a window: pinch it with both hands and move the hands apart / together.
// The window's size follows the distance between the hands, relative to where they started.
export const MIN_SCALE = 0.4, MAX_SCALE = 2.5;

/**
 * Where a window held with both hands should be: where it was when the second hand pinched, moved by
 * however far the midpoint between the hands has travelled since. Points are [x, y, z].
 */
export function carriedPosition(startPos, startMid, mid) {
  return [startPos[0] + mid[0] - startMid[0], startPos[1] + mid[1] - startMid[1], startPos[2] + mid[2] - startMid[2]];
}

/** New window scale from the hand distance now (`dist`) against when the second hand pinched (`startDist`). */
export function resizedScale(startScale, startDist, dist, min = MIN_SCALE, max = MAX_SCALE) {
  if (!(startDist > 0.02) || !Number.isFinite(dist)) return startScale; // hands touching or tracking lost: leave it
  return Math.min(max, Math.max(min, startScale * (dist / startDist)));
}
