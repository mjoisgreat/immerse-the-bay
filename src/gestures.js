import * as THREE from "three";

// Hand gestures (Quest hand tracking), on top of pinching:
//  - Raise a hand to your mouth like a microphone → talk; lower it → send.
//  - Part both hands like curtains → step into the focused window; bring them back together → step out.
//  - Shake both hands in front of you (wipe away) → close the focused window (or step out when inside).
//  - Turn your LEFT palm toward your face and hold it there → show / hide the buttons.
// Detection is pure geometry on joint positions, kept separate from three.js so it can be tested.

const MIC_ON = 0.13, MIC_OFF = 0.2; // metres from the mouth (hysteresis so it doesn't flicker)
const MIC_HOLD_MS = 350;
const MIC_LOST_MS = 2500; // the talking hand went untracked this long (controllers picked up, session over): send
// Two-hand gestures share one cooldown, so the return stroke of one can never fire another.
const TWO_HAND_COOLDOWN_MS = 1500;
// Parting / closing: palms go from TOGETHER to APART (or back) within the window, then stay for a beat.
const TOGETHER = 0.2, APART = 0.42, PART_WINDOW_MS = 800, SETTLE_MS = 280;
// Shake: each hand swings sideways and turns around a few times in quick succession.
const SWING = 0.045, SHAKE_TURNS = 3, SHAKE_WINDOW_MS = 1400;
const MOVED = 0.08; // both hands must travel at least this far in a parting / closing motion
const GAP_MS = 300; // tracking gap after which half-finished two-hand motions are forgotten
const PALM_HOLD_MS = 600;

// Scratch for HandGestures.update (the detector itself takes plain arrays).
const _Y = new THREE.Vector3(), _MZ = new THREE.Vector3(), _N = new THREE.Vector3();
const SIDES = ["left", "right"];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dMouth = (h, mouth) => (h ? len(sub(h.palm, mouth)) : Infinity);
const inFront = (h, head) => {
  if (!h) return false;
  const r = sub(h.palm, head.pos);
  return dot(r, head.fwd) > 0.15 && len(r) > 0.22 && dot(r, head.up) > -0.55;
};
const moved = (at, hands) => at && len(sub(hands.left.palm, at[0])) > MOVED && len(sub(hands.right.palm, at[1])) > MOVED;
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Pure gesture state machine.
 * update(frame) where frame = { now, head: {pos, up, fwd}, hands: { left?, right? } } and each hand is
 * { palm: [x,y,z], palmNormal: [x,y,z] (pointing out of the palm) }. Returns a list of events:
 * "talk-start", "talk-end", "open", "close", "shake", "palm". `talkHand` is "left" | "right" while talking.
 */
export class GestureDetector {
  constructor() {
    this.talking = false;
    this.nearSince = 0;
    this.talkHand = null;
    this.lastTwoHand = -Infinity;
    this._resetTwoHand();
    this.palmSince = 0;
    this.palmArmed = true;
  }

  _resetTwoHand() {
    this._twoHandClean = true; // cleared by update() as soon as a two-hand gesture starts tracking
    this.lastTogether = -Infinity;
    this.lastApart = -Infinity;
    this.togetherAt = this.apartAt = null; // palm positions when last together / apart
    this.pending = null; // { ev: "open" | "close", at } waiting out SETTLE_MS
    const swing = () => ({ x: 0, last: null, dir: 0, ext: 0, turns: [] });
    this.swing = { left: swing(), right: swing() };
  }

  _fire(ev, now, events) {
    this._resetTwoHand();
    this.lastTwoHand = now;
    events.push(ev);
  }

  /** Forget everything in progress. Returns ["talk-end"] if a talk was open, so the mic is never left on. */
  reset() {
    const events = this.talking ? ["talk-end"] : [];
    if (!events.length && !this.talkHand && !this.nearSince && !this.palmSince && this._twoHandClean) return events; // already reset
    this.talking = false;
    this.talkHand = null;
    this.nearSince = 0;
    this.palmSince = 0;
    this._resetTwoHand();
    return events;
  }

  /**
   * Counts recent left-right direction changes of one hand. Sideways travel is summed from the palm's own
   * movement in the room, so shaking your head with your hands held still does not count.
   */
  _turns(side, palm, right, now) {
    const s = this.swing[side];
    if (s.last) s.x += dot(sub(palm, s.last), right);
    s.last = palm;
    const x = s.x;
    if (s.dir === 0) {
      if (Math.abs(x - s.ext) > SWING) (s.dir = Math.sign(x - s.ext)), (s.ext = x);
    } else if ((x - s.ext) * s.dir > 0) s.ext = x;
    else if ((s.ext - x) * s.dir > SWING) (s.dir = -s.dir), (s.ext = x), s.turns.push(now);
    while (s.turns.length && now - s.turns[0] > SHAKE_WINDOW_MS) s.turns.shift();
    return s.turns.length;
  }

  update({ now, head, hands }) {
    const events = [];
    const mouth = [
      head.pos[0] - head.up[0] * 0.08 + head.fwd[0] * 0.06,
      head.pos[1] - head.up[1] * 0.08 + head.fwd[1] * 0.06,
      head.pos[2] - head.up[2] * 0.08 + head.fwd[2] * 0.06,
    ];

    // Talk: either hand near the mouth.
    // While talking only the hand that started it counts; if it drops out of tracking (it is right
    // under the headset) keep listening for a while rather than cutting the speaker off.
    const talkHand = this.talking ? hands[this.talkHand] : null;
    if (talkHand || !this.talking) this.talkSeen = now;
    const toMouth = this.talking
      ? talkHand ? dMouth(talkHand, mouth) : now - this.talkSeen > MIC_LOST_MS ? Infinity : 0
      : Math.min(dMouth(hands.left, mouth), dMouth(hands.right, mouth));
    if (!this.talking) {
      if (toMouth < MIC_ON) {
        this.nearSince ||= now;
        if (now - this.nearSince >= MIC_HOLD_MS) {
          this.talking = true;
          this.talkHand = dMouth(hands.left, mouth) < dMouth(hands.right, mouth) ? "left" : "right";
          events.push("talk-start");
        }
      } else this.nearSince = 0;
    } else if (toMouth > MIC_OFF) {
      this.talking = false;
      this.talkHand = null;
      this.nearSince = 0;
      events.push("talk-end");
    }

    // Two-hand gestures: both hands raised in front of you, and not while talking.
    const right = cross(head.fwd, head.up);
    if (now - (this.lastNow ?? now) > GAP_MS) this._resetTwoHand();
    this.lastNow = now;
    const cooled = now - this.lastTwoHand > TWO_HAND_COOLDOWN_MS;
    if (this.talking) this._resetTwoHand();
    else if (inFront(hands.left, head) && inFront(hands.right, head)) {
      this.lastFront = now;
      this._twoHandClean = false;
      const lt = this._turns("left", hands.left.palm, right, now);
      const rt = this._turns("right", hands.right.palm, right, now);
      const sep = len(sub(hands.left.palm, hands.right.palm));
      const at = [hands.left.palm, hands.right.palm];
      if (sep < TOGETHER) (this.lastTogether = now), (this.togetherAt = at);
      if (sep > APART) (this.lastApart = now), (this.apartAt = at);
      const shaking = lt >= 2 || rt >= 2; // a wipe is under way: it must not read as parting
      if (shaking) this.pending = null;
      if (lt >= SHAKE_TURNS && rt >= SHAKE_TURNS) {
        if (cooled) this._fire("shake", now, events);
      } else if (this.pending) {
        // The hands must stay where the motion ended for a beat (a shake swings straight back).
        const held = this.pending.ev === "open" ? sep > APART * 0.85 : sep < TOGETHER + 0.05;
        if (!held) this.pending = null;
        else if (now >= this.pending.at) this._fire(this.pending.ev, now, events);
      } else if (cooled && !shaking) {
        if (sep > APART && now - this.lastTogether < PART_WINDOW_MS && moved(this.togetherAt, hands)) this.pending = { ev: "open", at: now + SETTLE_MS };
        else if (sep < TOGETHER && now - this.lastApart < PART_WINDOW_MS && moved(this.apartAt, hands)) this.pending = { ev: "close", at: now + SETTLE_MS };
      }
    } else if (this.pending && now - this.lastFront < GAP_MS) {
      if (now >= this.pending.at) this._fire(this.pending.ev, now, events); // hands dropped right after the motion
    } else this._resetTwoHand();

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
    // Feedback, added to the scene by the caller: a glow on each palm when a gesture registers,
    // and a small mic badge by the hand you are talking into.
    this.fx = new THREE.Group();
    this.glows = ["left", "right"].map(() => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false }),
      );
      m.visible = false;
      m.renderOrder = 998;
      this.fx.add(m);
      return m;
    });
    this.glowAt = -Infinity;
    this.mic = new THREE.Sprite(new THREE.SpriteMaterial({ map: micTexture(), transparent: true, depthTest: false }));
    this.mic.renderOrder = 999;
    this.mic.visible = false;
    this.fx.add(this.mic);
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    _Y.set(0, 1, 0), _MZ.set(0, 0, -1), _N.set(0, -1, 0);
    this._hands = {}; // reused every frame; the detector does not keep it
    this._head = { pos: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] }; // likewise
    this._none = {};
  }

  _read(hand) {
    const j = hand.joints?.["middle-finger-metacarpal"];
    if (!hand.userData.tracked || !j || !j.visible) return null;
    // The detector keeps palm arrays between frames, so each frame gets a fresh one.
    const palm = j.getWorldPosition(this._v).toArray();
    // WebXR hand joints: -Y points out of the palm. (It never keeps palmNormal, so that is reused.)
    const d = (hand.userData.data ??= { palm, palmNormal: [0, 0, 0] });
    d.palm = palm;
    this._v.copy(_N).applyQuaternion(j.getWorldQuaternion(this._q)).toArray(d.palmNormal);
    return d;
  }

  /** Flash both palms in a colour: "this gesture registered". */
  pulse(color = 0xffd08a) {
    for (const g of this.glows) g.material.color.set(color);
    this.glowAt = performance.now();
  }

  _fx(now, hands, head) {
    const k = (now - this.glowAt) / 550; // 0 → 1 over the pulse
    for (let i = 0; i < 2; i++) {
      const g = this.glows[i], h = hands[SIDES[i]];
      g.visible = Boolean(h) && k < 1;
      if (!g.visible) continue;
      g.position.fromArray(h.palm);
      g.scale.setScalar(1 + 1.8 * k);
      g.material.opacity = 0.85 * (1 - k);
    }
    const h = hands[this.detector.talkHand];
    this.mic.visible = Boolean(h && head);
    if (this.mic.visible) {
      // Just above and beyond the hand, so it sits at the bottom of your view rather than under your chin.
      this.mic.position.fromArray(h.palm).addScaledVector(this._v.fromArray(head.fwd), 0.1).addScaledVector(this._v.fromArray(head.up), 0.06);
      this.mic.scale.setScalar(0.045 * (1 + 0.12 * Math.sin(now / 140)));
    }
  }

  update() {
    if (!this.renderer.xr.isPresenting) {
      for (const ev of this.detector.reset()) this.handlers[ev]?.(); // session over mid-sentence: send it
      return this._fx(0, this._none, null);
    }
    const hands = this._hands;
    hands.left = hands.right = undefined;
    for (const h of this.hands) {
      const data = this._read(h);
      if (data) hands[h.userData.handedness === "left" ? "left" : "right"] = data;
    }
    const head = this._head;
    this.camera.getWorldPosition(this._v).toArray(head.pos);
    this.camera.getWorldQuaternion(this._q);
    this._v.copy(_Y).applyQuaternion(this._q).toArray(head.up);
    this._v.copy(_MZ).applyQuaternion(this._q).toArray(head.fwd);
    const now = performance.now();
    for (const ev of this.detector.update({ now, head, hands })) this.handlers[ev]?.();
    this._fx(now, hands, head);
  }
}

function micTexture() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e5392b";
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = g.fillStyle = "#fff";
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath(); // capsule
  g.roundRect(50, 26, 28, 48, 14);
  g.fill();
  g.beginPath(); // cradle and stand
  g.arc(64, 62, 26, 0.15 * Math.PI, 0.85 * Math.PI);
  g.moveTo(64, 88);
  g.lineTo(64, 104);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
