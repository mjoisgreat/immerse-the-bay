// app/state.js: the mutable variables that more than one module reads or writes. ES module `let`s can't be assigned from
// an importer, so they live on this one object: `state.focusId = ...`.
export const state = {
  focusId: null,
  maxPortals: 3,
  wideOn: false,
  retired: false,
  roomState: null,
  talking: false,
  wantTalk: false, // the button is held (the mic may still be starting)
  buddyWait: 0,
  guideStep: -1,
  asking: null, // { kind: "story" | "portal", id }
  pendingSeed: "", // a world chosen ahead of time for the next window (also kept by the server)
  armed: null, // "reset" | "newstory" | "close"
  yaw: 0,
  pitch: 0,
};
