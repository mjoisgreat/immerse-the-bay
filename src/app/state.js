// app/state.js: the mutable variables that more than one module reads or writes. ES module `let`s can't be assigned from
// an importer, so they live on this one object: `state.wideOn = ...`.
export const state = {
  started: false, // true once every module has loaded (see main.js)
  wideOn: false,
  retired: false,
  joined: false, // the server has accepted this page as the room's renderer ("hello" answered)
  roomState: null,
  talking: false,
  wantTalk: false, // the button is held (the mic may still be starting)
  buddyWait: 0,
  guideStep: -1,
  asking: null, // { kind: "story" | "window" }: the world question being asked
  pendingSeed: "", // a world chosen ahead of time for the next window (also kept by the server)
  armed: null, // "reset" | "newstory" | "close"
  yaw: 0,
  pitch: 0,
};
