// app/wide.js: Wide view.
import { OrbisStream } from "../orbis.js";
import { state } from "./state.js";
import { ROOM } from "./room.js";
import { flash } from "./feedback.js";
import { entryOf, immersion, portals } from "./portals.js";

// ---------- Wide view: live views to your left and right while you're inside a window ----------
// Two more Orbis streams of the same scene with the camera turned to each side, stitched around you by
// the step-inside view (see immersion.js). Only while you're inside, and only when Wide view is on.
export const sides = { L: null, R: null, for: null, triedAt: 0 };
function sidePrompt(prompt, side) {
  return `The same place at the same moment, seen from the same standing spot with the camera turned 72 degrees to the ${side}. ${prompt} This shot shows what lies to the ${side} of that view, continuing the same ground, horizon height, light, weather and time of day seamlessly. One continuous take, an almost still camera.`;
}
function startSides() {
  const entry = entryOf(immersion.portal);
  if (!entry?.stream.prompt) return; // the main view has no scene yet: try again shortly
  const { id, stream } = entry;
  stopSides();
  sides.for = id;
  for (const side of ["L", "R"]) {
    const s = new OrbisStream(`${id}${side}`, ROOM);
    s.addEventListener("video", () => immersion.setSide(side, s.video));
    sides[side] = s;
    s.start(sidePrompt(stream.prompt, side === "L" ? "left" : "right"));
  }
  flash("Wide view: live views to your left and right are on their way (about 20–30 s).", 6000);
}
function stopSides() {
  for (const side of ["L", "R"]) {
    sides[side]?.close();
    sides[side] = null;
    immersion.setSide(side, null);
  }
  sides.for = null;
  sides.leftAt = 0;
}
export function steerSides(id, prompt) {
  if (sides.for !== id) return;
  sides.L?.steer(sidePrompt(prompt, "left"));
  sides.R?.steer(sidePrompt(prompt, "right"));
}
// Called every frame: start the side views when you're inside with Wide view on, stop them otherwise.
// Stepping out keeps them for a little while, so stepping back in (or peeking out) doesn't mean
// another 20-30 s wait for the side views.
const SIDES_GRACE_MS = 15000;
export function updateSides() {
  const wantFor = state.wideOn && immersion.inside ? (entryOf(immersion.portal)?.id ?? null) : null;
  if (wantFor) sides.leftAt = 0;
  if (sides.for && sides.for !== wantFor) {
    const now = performance.now();
    const outOnly = state.wideOn && !immersion.inside && portals.has(sides.for); // stepped out, not switched or closed
    if (outOnly && !sides.leftAt) sides.leftAt = now;
    if (!outOnly || now - sides.leftAt > SIDES_GRACE_MS) stopSides();
  }
  if (wantFor && !sides.for && performance.now() - sides.triedAt > 2000) (sides.triedAt = performance.now()), startSides();
}
export function toggleWide() {
  state.wideOn = !state.wideOn;
  if (!state.wideOn) return flash("Wide view off.", 2500);
  flash(
    immersion.inside
      ? "Wide view on: two more live views (left and right) for this world."
      : "Wide view on: step inside a window and live views open to your left and right too.",
    5000,
  );
}
