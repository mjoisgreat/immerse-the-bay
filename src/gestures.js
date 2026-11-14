import * as THREE from "three";

// Hand gestures (Quest hand tracking), on top of pinching:
//  - Raise a hand to your mouth like a microphone → talk; lower it → send.
//  - Clap → step into the window you're facing / step back out.
//  - Turn your LEFT palm toward your face and hold it there → show / hide the buttons.
// Detection is pure geometry on joint positions, kept separate from three.js so it can be tested.

const MIC_ON = 0.13, MIC_OFF = 0.2; // metres from the mouth (hysteresis so it doesn't flicker)
const MIC_HOLD_MS = 250;
const CLAP_CLOSE = 0.09, CLAP_OPEN = 0.2, CLAP_WINDOW_MS = 450, CLAP_COOLDOWN_MS = 1200;
const PALM_HOLD_MS = 600;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Pure gesture state machine.
 * update(frame) where frame = { now, head: {pos, up, fwd}, hands: { left?, right? } } and each hand is
 * { palm: [x,y,z], palmNormal: [x,y,z] (pointing out of the palm) }. Returns a list of events:
 * "talk-start", "talk-end", "clap", "palm".
 */
export class GestureDetector {
  constructor() {
    this.talking = false;
    this.nearSince = 0;
    this.lastApart = -Infinity;
    this.lastClap = -Infinity;
    this.palmSince = 0;
    this.palmArmed = true;
  }

  update({ now, head, hands }) {
    const events = [];
    const mouth = [
      head.pos[0] - head.up[0] * 0.08 + head.fwd[0] * 0.06,
      head.pos[1] - head.up[1] * 0.08 + head.fwd[1] * 0.06,
      head.pos[2] - head.up[2] * 0.08 + head.fwd[2] * 0.06,
    ];

    // Talk: either hand near the mouth.
    const toMouth = Math.min(...[hands.left, hands.right].filter(Boolean).map((h) => len(sub(h.palm, mouth))), Infinity);
    if (!this.talking) {
      if (toMouth < MIC_ON) {
        this.nearSince ||= now;
        if (now - this.nearSince >= MIC_HOLD_MS) (this.talking = true), events.push("talk-start");
      } else this.nearSince = 0;
    } else if (toMouth > MIC_OFF) {
      this.talking = false;
      this.nearSince = 0;
      events.push("talk-end");
    }

    // Clap: palms come together quickly (they were apart a moment ago), away from the face.
    if (hands.left && hands.right && !this.talking) {
      const apart = len(sub(hands.left.palm, hands.right.palm));
      if (apart > CLAP_OPEN) this.lastApart = now;
      const fast = now - this.lastApart < CLAP_WINDOW_MS;
      const awayFromFace = len(sub(hands.left.palm, head.pos)) > 0.22;
      if (apart < CLAP_CLOSE && fast && awayFromFace && now - this.lastClap > CLAP_COOLDOWN_MS) {
        this.lastClap = now;
        events.push("clap");
      }
    }

    // Left palm turned toward your face, in front of you, held still for a moment.
    const L = hands.left;
    let facing = false;
    if (L && !this.talking) {
      const toHead = sub(head.pos, L.palm);
      const d = len(toHead);
      facing = d > 0.2 && d < 0.6 && dot(norm(L.palmNormal), norm(toHead)) > 0.75;
    }
    if (facing && this.palmArmed) {
      this.palmSince ||= now;
      if (now - this.palmSince >= PALM_HOLD_MS) {
        events.push("palm");
        this.palmArmed = false; // turn the palm away before it can fire again
      }
    } else if (!facing) {
      this.palmSince = 0;
      this.palmArmed = true;
    }
    return events;
  }
}

/** Reads Quest hand joints from three.js each frame and feeds the detector. */
export class HandGestures {
  constructor(renderer, camera, handlers) {
    this.renderer = renderer;
    this.camera = camera;
    this.handlers = handlers;
    this.detector = new GestureDetector();
    this.hands = [0, 1].map((i) => {
      const hand = renderer.xr.getHand(i);
      hand.addEventListener("connected", (e) => {
        hand.userData.handedness = e.data.handedness;
        hand.userData.tracked = Boolean(e.data.hand);
      });
      hand.addEventListener("disconnected", () => (hand.userData.tracked = false));
      return hand;
    });
    this.seenHands = false;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  _read(hand) {
    const j = hand.joints?.["middle-finger-metacarpal"];
    if (!hand.userData.tracked || !j || !j.visible) return null;
    const palm = j.getWorldPosition(this._v).toArray();
    // WebXR hand joints: -Y points out of the palm.
    const n = new THREE.Vector3(0, -1, 0).applyQuaternion(j.getWorldQuaternion(this._q)).toArray();
    return { palm, palmNormal: n };
  }

  update() {
    if (!this.renderer.xr.isPresenting) return;
    const hands = {};
    for (const h of this.hands) {
      const data = this._read(h);
      if (data) hands[h.userData.handedness === "left" ? "left" : "right"] = data;
    }
    if (!hands.left && !hands.right) return;
    if (!this.seenHands) (this.seenHands = true), this.handlers.firstSeen?.();
    const head = {
      pos: this.camera.getWorldPosition(new THREE.Vector3()).toArray(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(this._q)).toArray(),
      fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(this._q)).toArray(),
    };
    for (const ev of this.detector.update({ now: performance.now(), head, hands })) this.handlers[ev]?.();
  }
}
