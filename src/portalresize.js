// Two-hand resize of a window: pinch it with both hands and move the hands apart / together.
// The window's size follows the distance between the hands, relative to where they started.
export const MIN_SCALE = 0.4, MAX_SCALE = 2.5;

/** New window scale from the hand distance now (`dist`) against when the second hand pinched (`startDist`). */
export function resizedScale(startScale, startDist, dist, min = MIN_SCALE, max = MAX_SCALE) {
  if (!(startDist > 0.02) || !Number.isFinite(dist)) return startScale; // hands touching or tracking lost: leave it
  return Math.min(max, Math.max(min, startScale * (dist / startDist)));
}
