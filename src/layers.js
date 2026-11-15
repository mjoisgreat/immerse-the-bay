// Draw order (three.js `renderOrder`) of everything that must not be sorted by distance, in one place.
// Sorting by distance flips overlapping see-through things as your head moves, which shows as flicker.
//
// three.js draws the opaque pass first, then the transparent pass; within a pass, lower numbers first.
// "Opaque pass" entries below use `transparent: false` (a custom blend still lets them fade there).
export const LAYER = {
  // ---- opaque pass ----
  SKY: -40, // a 3D world's sky dome (Moon's black sky, a splat world's panorama): first of all
  INSIDE_OPAQUE: -30, // the step-inside world over passthrough: before the wall masks, so they can't cut holes in it
  WALL_MASK: -20, // each window's depth-only "hole in the wall"
  // ---- transparent pass ----
  MOON_STARS: -20,
  MOON_EARTH: -19,
  MOON_SUN: -18,
  INSIDE: -10, // the step-inside world on a flat screen: behind every window and UI element
  SPLATS: -5, // a splat world: after the step-inside world, before windows and buttons
  WINDOW_BACK: -1, // a window's back wall and tunnel: before its picture (0, the default)
  WINDOW_GLOW: 1,
  WINDOW_CAPTION: 2, // (also the companion's shadow at 1 and body at 2: see companion.js)
  COMPANION_GLOW: 3,
  MOTES: 5,
  RIPPLE: 15,
  TOOLBAR: 20,
  SPEECH_BUBBLE: 25, // readable in front of a window's caption
  TELEPORT_MARKER: 29,
  GESTURE_CARD: 30, // its close button is one above
  DRAW_TRAIL: 40,
  WRIST_POLL: 45, // the Twitch vote above the wrist
  TOAST: 50, // on top of everything
};
