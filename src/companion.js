import * as THREE from "three";
import { LAYER } from "./layers.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { stepBody, VelocityTracker, isTap } from "./physics.js";

// A companion who walks (or hops) around your real floor, wanders in front of you, comes when called,
// follows you, faces you to listen and talk, and gestures as it speaks. The body is a "rig":
//  - BunnyRig: the VR bunny, built from simple shapes and animated in code (hops, ears, visor glow).
//  - RobotRig: Pip, RobotExpressive by Tomás Laulhé / Quaternius (CC0), with its own animations.
// Rigs share one tiny interface: load(), play(name), current, update(dt, ctx), setFace(name, amount),
// and onFinished (called when a one-shot gesture ends).
const WALK_SPEED = 0.45; // m/s
const RUN_SPEED = 1.3; // when it has fallen behind
const RETURN_AFTER = 6000; // ms after landing from a throw before it trots back to you
const STRAY_DIST = 4; // m: farther than this from you and it comes back on its own
const LOST_DIST = 12; // m: farther than this (or NaN) and it is simply put back next to you
const GESTURES = {
  wave: "Wave", yes: "Yes", no: "No", thumbs_up: "ThumbsUp", jump: "Jump", dance: "Dance",
  // Tricks (Bonnie's arms and legs; Pip falls back to its closest clip, see RobotRig.play).
  flip: "Flip", cartwheel: "Cartwheel", spin: "Spin", clap: "Clap", moonwalk: "Moonwalk",
};
/** What she may do on her own now and then, to show off. */
export const SHOW_OFF = ["dance", "spin", "clap", "flip", "moonwalk", "cartwheel"];
const ONE_SHOT = new Set(Object.values(GESTURES));
// Grab and throw: how the throw feels.
const THROW_BOOST = 1.6; // tracked hands under-read a flick, so throws get extra oomph
const MAX_THROW = 11; // m/s
const REEL_TO = new THREE.Vector3(0, 0, -0.12); // a far grab is pulled in to just past your fingers
const UP = new THREE.Vector3(0, 1, 0);
// Scratch objects for the per-frame paths (never kept across calls; see each use).
const _eyeV = new THREE.Vector3(), _toUser = new THREE.Vector3(), _fwd = new THREE.Vector3(), _left = new THREE.Vector3();
const _spot = new THREE.Vector3(), _to = new THREE.Vector3(), _facing = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
// BunnyRig per-frame pose scratch.
const _earWave = [0, 0], _earBack = [0, 0], _hc = { hop: 0, squash: 0 };
// Limb pose scratch: arms [raise sideways, forward, elbow bend], legs [swing forward, splay sideways].
const _pose = { aL: [0, 0, 0], aR: [0, 0, 0], lL: [0, 0], lR: [0, 0], pitch: 0, roll: 0, slide: 0 };
const LEG = 0.075; // how far her legs lift the body off the floor
const setArm = (a, raise, fwd, elbow) => ((a[0] = raise), (a[1] = fwd), (a[2] = elbow));
const setLeg = (l, swing, splay = 0) => ((l[0] = swing), (l[1] = splay));
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function blobShadow(size) {
  const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

// Draw in the transparent pass after the step-inside world, so the companion can come along inside.
function afterWorld(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.depthWrite = true;
    o.renderOrder = 2;
  });
}

// One hop cycle: writes hop / squash into _hc and the ears-back amount into _earBack.
function hopCycle(t, freq, height) {
  const p = (t * freq) % 1;
  const air = Math.sin(Math.PI * p);
  _hc.hop = air * height;
  // Squash on landing / take-off, stretch in the air.
  _hc.squash = p < 0.12 ? (0.12 - p) / 0.12 : p > 0.88 ? (p - 0.88) / 0.12 : -air * 0.35;
  _earBack[0] = _earBack[1] = air * 0.5; // ears flow back in the air
}

// ---------------------------------------------------------------------------------------------
// The VR bunny (after the Stanford XR mascot): white, long ears (one tilted), a black visor with
// side straps, an "x" nose, a round tail. Everything here is code: no model file.
// ---------------------------------------------------------------------------------------------
export class BunnyRig {
  constructor() {
    this.height = 0.78 + LEG; // to the ear tips (her legs lift her a little)
    this.center = 0.19 + LEG; // middle of the round body: what you hold, and what it tumbles around
    this.radius = 0.18; // the ball it bounces as
    this.current = "Idle";
    this.t = 0; // time in the current animation
    this.onFinished = null;
    this.face = { perk: 0 };
    this.nextTwitch = 2;
  }

  async load(parent) {
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xf2c4c8, roughness: 0.9 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6 });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x07080b, roughness: 0.22, metalness: 0.1, emissive: 0x3aa0ff, emissiveIntensity: 0,
    });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.7 });
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return m;
    };

    this.model = new THREE.Group(); // hops and spins as a whole
    parent.add(this.model);
    // Flips and cartwheels turn her around the middle of her body, not her feet.
    this.tumble = new THREE.Group();
    this.tumble.position.y = this.center;
    this.model.add(this.tumble);
    this.inner = new THREE.Group();
    this.inner.position.y = -this.center;
    this.tumble.add(this.inner);
    this.body = new THREE.Group(); // squash & stretch pivot at the bottom of the body, on top of the legs
    this.body.position.y = LEG;
    this.inner.add(this.body);

    // Body: a big soft pear, wider at the bottom and flat on the floor (like the logo).
    // One smooth lathed profile (radius, height) so there are no seams between parts.
    const profile = new THREE.SplineCurve(
      [[0, 0], [0.12, 0.008], [0.168, 0.06], [0.176, 0.13], [0.16, 0.21], [0.125, 0.27], [0.08, 0.315], [0.0, 0.335]].map(
        ([x, y]) => new THREE.Vector2(x, y),
      ),
    ).getPoints(40);
    profile[0].x = 0;
    profile[profile.length - 1].x = 0;
    const torso = mesh(new THREE.LatheGeometry(profile, 56), white);
    torso.scale.set(1, 1, 0.9);
    this.body.add(torso);
    // Arms: stubby, with an elbow and a round paw. Pivots at the shoulder (arm hangs down -y).
    const limb = (r, len) => {
      const g = new THREE.CapsuleGeometry(r, len, 6, 14);
      g.translate(0, -len / 2, 0);
      return g;
    };
    this.arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.14, 0.215, 0.025);
      shoulder.add(mesh(limb(0.034, 0.085), white));
      const elbow = new THREE.Group();
      elbow.position.y = -0.1;
      elbow.add(mesh(limb(0.031, 0.075), white));
      const paw = mesh(new THREE.SphereGeometry(0.043, 18, 14), white, 0, -0.095, 0.004);
      paw.scale.set(1, 0.95, 0.9);
      const pad = mesh(new THREE.SphereGeometry(0.02, 12, 10), pink, 0, -0.104, 0.034);
      pad.scale.set(1, 0.8, 0.4);
      elbow.add(paw, pad);
      shoulder.add(elbow);
      this.body.add(shoulder);
      return { shoulder, elbow, s };
    });
    // Legs: short, under the body, with big bunny feet. Pivots at the hip (not squashed with the body).
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.075, LEG + 0.03, 0.02);
      hip.add(mesh(limb(0.036, 0.045), white));
      const foot = mesh(new THREE.SphereGeometry(0.045, 20, 14), white, 0, -LEG - 0.01, 0.035);
      foot.scale.set(0.85, 0.42, 1.45);
      const sole = mesh(new THREE.SphereGeometry(0.03, 14, 10), pink, 0, -LEG - 0.024, 0.045);
      sole.scale.set(0.8, 0.25, 1.3);
      hip.add(foot, sole);
      this.inner.add(hip);
      return { hip, s };
    });
    // The round tail at the back.
    this.tail = mesh(new THREE.SphereGeometry(0.065, 24, 18), white, 0.03, 0.1, -0.15);
    this.body.add(this.tail);

    // Head group (pivot at the neck), carrying the visor, straps, nose and ears. It sits right on
    // the body, no neck.
    this.head = new THREE.Group();
    this.head.position.set(0, 0.3, 0.01);
    this.body.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.115, 40, 28), white, 0, 0.1, 0);
    skull.scale.set(1.05, 0.96, 0.96);
    this.head.add(skull);
    // Visor: chunky black goggles, wider than the head, like the logo's headset.
    const visor = mesh(new RoundedBoxGeometry(0.255, 0.098, 0.16, 5, 0.04), this.visorMat, 0, 0.112, 0.038);
    this.head.add(visor);
    // Headset straps: white "C" loops on each side of the visor.
    for (const s of [-1, 1]) {
      const loop = mesh(new THREE.TorusGeometry(0.046, 0.009, 10, 28, Math.PI), strapMat, s * 0.128, 0.112, 0.0);
      loop.rotation.z = -s * Math.PI / 2;
      this.head.add(loop);
    }
    // The "x" nose/mouth, just under the visor.
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const bar = mesh(new THREE.BoxGeometry(0.03, 0.0065, 0.006), black, 0, 0.038, 0.108);
      bar.rotation.set(-0.35, 0, r);
      this.head.add(bar);
    }
    // Ears: long, flattened, one upright and one tilted out, like the logo. Pivots at the base.
    this.ears = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.045, 0.18, -0.01);
      const ear = mesh(new THREE.SphereGeometry(0.05, 28, 20), white, 0, 0.16, 0);
      ear.scale.set(0.72, 3.3, 0.32);
      const inner = mesh(new THREE.SphereGeometry(0.05, 24, 16), pink, 0, 0.16, 0.011);
      inner.scale.set(0.4, 2.7, 0.2);
      pivot.add(ear, inner);
      pivot.userData.rest = { z: s < 0 ? 0.1 : -0.55, x: -0.08 };
      this.head.add(pivot);
      return pivot;
    });

    afterWorld(this.model);
    this.visorMat = visor.material; // the cloned material that is actually drawn
  }

  play(name) {
    if (name === this.current) return;
    this.current = name;
    this.t = 0;
    // A different dance each time: disco, noodle arms, party hops.
    if (name === "Dance") this.routine = ((this.routine ?? Math.floor(Math.random() * 3)) + 1) % 3;
  }

  setFace(name, amount) {
    if (name === "Surprised") this.face.perk = amount; // ears up, attentive
  }

  update(dt, { talking, listening, speakT }) {
    this.t += dt;
    const t = this.t, T = performance.now() / 1000;
    let hop = 0, squash = 0, spin = 0, nodX = 0, shakeY = 0, tiltZ = 0;
    const earWave = _earWave, earBack = _earBack;
    earWave[0] = earWave[1] = earBack[0] = earBack[1] = 0;
    // Arms and legs: a relaxed rest pose with a little sway, which the moves below override.
    const P = _pose, sway = Math.sin(T * 1.3) * 0.05;
    setArm(P.aL, 0.2 + sway, 0.15, 0.3), setArm(P.aR, 0.2 - sway, 0.15, 0.3);
    setLeg(P.lL, 0), setLeg(P.lR, 0);
    P.pitch = P.roll = P.slide = 0;

    switch (this.current) {
      case "Walking": {
        hopCycle(t, 2.1, 0.03);
        (hop = _hc.hop), (squash = _hc.squash * 0.5);
        const w = Math.sin(t * Math.PI * 2.1); // one step per hop
        setLeg(P.lL, w * 0.55), setLeg(P.lR, -w * 0.55);
        setArm(P.aL, 0.2, -w * 0.45 + 0.1, 0.4), setArm(P.aR, 0.2, w * 0.45 + 0.1, 0.4);
        break;
      }
      case "Running": {
        hopCycle(t, 3.0, 0.08);
        (hop = _hc.hop), (squash = _hc.squash);
        const w = Math.sin(t * Math.PI * 3.0);
        setLeg(P.lL, w * 0.85), setLeg(P.lR, -w * 0.85);
        setArm(P.aL, 0.25, -w * 0.8 + 0.2, 1.1), setArm(P.aR, 0.25, w * 0.8 + 0.2, 1.1);
        break;
      }
      case "Wave": {
        const k = Math.min(1, t / 0.25) * Math.max(0, Math.min(1, (1.7 - t) / 0.3));
        earWave[1] = Math.sin(t * 14) * 0.45 * k; // waves its tilted ear
        setArm(P.aR, 0.2 + 2.5 * k, 0.15, 0.3 + (0.6 + Math.sin(t * 13) * 0.55) * k); // and a paw
        hop = Math.max(0, Math.sin(Math.min(t, 0.5) * Math.PI * 2)) * 0.03;
        if (t > 1.7) this._done();
        break;
      }
      case "Yes":
        nodX = Math.sin(t * 13) * 0.22 * Math.max(0, 1 - t / 1.3);
        setArm(P.aL, 0.3, 0.5, 1.2), setArm(P.aR, 0.3, 0.5, 1.2); // paws together, pleased
        if (t > 1.3) this._done();
        break;
      case "No": {
        shakeY = Math.sin(t * 12) * 0.35 * Math.max(0, 1 - t / 1.3);
        const k = Math.min(1, t / 0.2);
        setArm(P.aL, 0.9 * k, 0.4, 0.6), setArm(P.aR, 0.9 * k, 0.4, 0.6); // a little shrug
        if (t > 1.3) this._done();
        break;
      }
      case "ThumbsUp": {
        const p = Math.min(1, t / 0.7);
        hop = Math.sin(Math.PI * p) * 0.16;
        squash = p < 0.15 ? 0.6 * (1 - p / 0.15) : -Math.sin(Math.PI * p) * 0.3;
        setArm(P.aR, 0.5, 1.4 * Math.min(1, t / 0.25), 1.4); // paw up, forward
        this.face.perk = 1;
        if (t > 1.1) (this.face.perk = 0), this._done();
        break;
      }
      case "Jump": {
        const p = Math.min(1, t / 0.9);
        hop = Math.sin(Math.PI * p) * 0.32;
        spin = p * Math.PI * 2; // a full spin in the air
        squash = p < 0.12 ? 0.7 * (1 - p / 0.12) : -Math.sin(Math.PI * p) * 0.4;
        earBack[0] = earBack[1] = Math.sin(Math.PI * p) * 0.7;
        const up = Math.sin(Math.PI * p);
        setArm(P.aL, 0.2 + 2.6 * up, 0.2, 0.2), setArm(P.aR, 0.2 + 2.6 * up, 0.2, 0.2); // arms up!
        setLeg(P.lL, 0.6 * up), setLeg(P.lR, 0.6 * up); // knees tucked
        if (t > 1.05) this._done();
        break;
      }
      case "Dance": {
        const beat = t * 2.2; // beats
        const b = Math.sin(beat * Math.PI); // -1..1 every beat
        const end = Math.max(0, Math.min(1, (4.5 - t) / 0.3)); // settle at the end
        if (this.routine === 0) {
          // Disco: one paw points up to one side, then down across; the other on the hip; side steps.
          const up = Math.floor(beat) % 2 === 0;
          setArm(P.aR, up ? 2.5 : -0.2, up ? 0.3 : 0.9, 0.1);
          setArm(P.aL, 0.7, -0.2, 1.6); // hand on hip
          setLeg(P.lL, 0, Math.max(0, b) * 0.35), setLeg(P.lR, 0, Math.max(0, -b) * 0.35);
          tiltZ = b * 0.15;
          hop = Math.abs(b) * 0.03;
          spin = Math.sin(beat * 0.5) * 0.5;
        } else if (this.routine === 1) {
          // Noodle arms: a wave rolls through both arms, knees bounce, a slow turn.
          setArm(P.aL, 1.3 + Math.sin(t * 7) * 0.5, 0.2, 0.6 + Math.sin(t * 7 - 1.2) * 0.6);
          setArm(P.aR, 1.3 + Math.sin(t * 7 + 1.6) * 0.5, 0.2, 0.6 + Math.sin(t * 7 + 0.4) * 0.6);
          squash = Math.abs(b) * 0.5;
          setLeg(P.lL, Math.abs(b) * 0.3), setLeg(P.lR, Math.abs(b) * 0.3);
          spin = t * 1.4;
          nodX = b * 0.12;
        } else {
          // Party: hop on every beat and clap overhead, with a full spin in the middle.
          hopCycle(t, 2.2, 0.09);
          (hop = _hc.hop), (squash = _hc.squash);
          const clap = Math.abs(Math.sin(beat * Math.PI));
          setArm(P.aL, 2.7 - clap * 0.5, 0.25, 0.3), setArm(P.aR, 2.7 - clap * 0.5, 0.25, 0.3);
          setLeg(P.lL, 0, 0.25 * clap), setLeg(P.lR, 0, 0.25 * clap);
          spin = ease((t - 1.8) / 0.9) * Math.PI * 2;
        }
        earWave[0] = Math.sin(t * 10) * 0.4;
        earWave[1] = Math.sin(t * 10 + 1.5) * 0.4;
        if (end < 1) for (const a of [P.aL, P.aR]) (a[0] *= end), (a[1] *= end);
        if (t > 4.5) this._done();
        break;
      }
      case "Flip": {
        // A backflip: crouch, launch, tuck and rotate, land with a squash.
        const crouch = 0.25, air = 0.75;
        if (t < crouch) {
          squash = 0.6 * ease(t / crouch);
          setArm(P.aL, -0.3, -0.6, 0.4), setArm(P.aR, -0.3, -0.6, 0.4); // arms swing back
        } else {
          const p = Math.min(1, (t - crouch) / air);
          hop = Math.sin(Math.PI * p) * 0.5;
          P.pitch = -ease(p) * Math.PI * 2;
          const tuck = Math.sin(Math.PI * p);
          setArm(P.aL, 0.3 + 2.4 * tuck, 0.4, 0.3), setArm(P.aR, 0.3 + 2.4 * tuck, 0.4, 0.3);
          setLeg(P.lL, 1.0 * tuck), setLeg(P.lR, 1.0 * tuck);
          squash = p > 0.92 ? 0.6 * ((p - 0.92) / 0.08) : -tuck * 0.3;
          earBack[0] = earBack[1] = tuck * 0.8;
        }
        if (t > crouch + air + 0.25) this._done();
        break;
      }
      case "Cartwheel": {
        const p = Math.min(1, t / 1.3);
        P.roll = -ease(p) * Math.PI * 2;
        hop = Math.sin(Math.PI * p) * 0.2;
        const k = Math.sin(Math.PI * p);
        setArm(P.aL, 0.2 + 1.5 * k, 0, 0.1), setArm(P.aR, 0.2 + 1.5 * k, 0, 0.1); // arms out like a star
        setLeg(P.lL, 0, 0.7 * k), setLeg(P.lR, 0, 0.7 * k);
        if (t > 1.45) this._done();
        break;
      }
      case "Spin": {
        // A pirouette: arms out, then pulled in to spin faster, then "ta-da".
        const p = Math.min(1, t / 1.4);
        spin = ease(p) * Math.PI * 6;
        hop = Math.sin(Math.PI * p) * 0.05;
        const pull = Math.sin(Math.PI * p);
        setArm(P.aL, 1.5 - pull * 1.2, 0.3, 0.4 + pull), setArm(P.aR, 1.5 - pull * 1.2, 0.3, 0.4 + pull);
        setLeg(P.lR, 0.5 * pull, 0.2 * pull); // one foot tucked
        if (t > 1.4) {
          const ta = Math.min(1, (t - 1.4) / 0.2);
          setArm(P.aL, 2.4 * ta, 0.3, 0.2), setArm(P.aR, 2.4 * ta, 0.3, 0.2);
          this.face.perk = 1;
        }
        if (t > 2.0) (this.face.perk = 0), this._done();
        break;
      }
      case "Clap": {
        // Paws in front, clapping fast, a little bounce on each clap.
        const c = Math.abs(Math.sin(t * Math.PI * 4));
        setArm(P.aL, -0.35 + c * 0.6, 1.25, 0.5), setArm(P.aR, -0.35 + c * 0.6, 1.25, 0.5);
        hop = (1 - c) * 0.02;
        this.face.perk = 1;
        earWave[0] = earWave[1] = (1 - c) * 0.15;
        if (t > 1.6) (this.face.perk = 0), this._done();
        break;
      }
      case "Moonwalk": {
        // Gliding backwards: one foot slides back while the other stays flat, then they swap; a lean
        // forward, a little arm swing; glides back to where she started on the last beat.
        const step = t * 2.4;
        const ph = step % 1, swap = Math.floor(step) % 2 === 0;
        const back = -0.55 * ease(ph), flat = 0.25 * (1 - ease(ph));
        setLeg(P.lL, swap ? back : flat), setLeg(P.lR, swap ? flat : back);
        const glide = Math.min(1, t / 2.0), home = Math.max(0, (t - 2.0) / 0.4);
        P.slide = -0.3 * glide * (1 - ease(home));
        nodX = 0.12;
        setArm(P.aL, 0.3, Math.sin(step * Math.PI) * 0.4, 0.9), setArm(P.aR, 0.3, -Math.sin(step * Math.PI) * 0.4, 0.9);
        hop = Math.abs(Math.sin(step * Math.PI)) * 0.015;
        if (t > 2.4) this._done();
        break;
      }
      default: {
        // Idle: breathing, and a quick ear twitch every few seconds.
        squash = Math.sin(T * 2.4) * 0.025;
        this.nextTwitch -= dt;
        if (this.nextTwitch < 0) (this.twitch = 0.35), (this.nextTwitch = 2 + Math.random() * 4), (this.twitchEar = Math.random() < 0.5 ? 0 : 1);
      }
    }

    // Talking: little head bobs and a glowing, pulsing visor. Listening: head tilt, ears up.
    if (talking) nodX += Math.sin(speakT * 9) * 0.06 + Math.sin(speakT * 3.1) * 0.04;
    if (listening) (tiltZ += 0.2), (nodX -= 0.08);
    // Black at rest (like the logo); a soft blue glow while listening, pulsing while talking.
    const glow = talking ? 0.7 + Math.sin(speakT * 11) * 0.4 : listening ? 0.35 + Math.sin(T * 4) * 0.15 : 0;
    this.visorMat.emissiveIntensity += (glow - this.visorMat.emissiveIntensity) * Math.min(1, dt * 10);

    this.model.position.set(0, hop, P.slide);
    this.model.rotation.y = spin;
    this.tumble.rotation.set(P.pitch, 0, P.roll);
    for (const { shoulder, elbow, s } of this.arms) {
      const [raise, fwd, bend] = s < 0 ? P.aL : P.aR;
      shoulder.rotation.set(-fwd, 0, s * raise);
      elbow.rotation.x = -bend;
    }
    for (const { hip, s } of this.legs) {
      const [swing, splay] = s < 0 ? P.lL : P.lR;
      hip.rotation.set(-swing, 0, s * splay);
    }
    const sq = THREE.MathUtils.clamp(squash, -0.5, 0.8) * 0.18;
    this.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
    this.head.rotation.set(nodX, shakeY, tiltZ);
    const perk = Math.max(this.face.perk, listening ? 0.7 : 0);
    if (this.twitch > 0) this.twitch -= dt;
    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      const rest = ear.userData.rest;
      const twitch = this.twitch > 0 && this.twitchEar === i ? Math.sin((0.35 - this.twitch) * 40) * 0.12 : 0;
      ear.rotation.z = THREE.MathUtils.lerp(rest.z, i === 0 ? 0.05 : -0.12, perk) + earWave[i] + twitch;
      ear.rotation.x = rest.x - earBack[i];
    }
    this.tail.position.y = 0.11 + Math.sin(T * 6) * 0.004;
  }

  _done() {
    const was = this.current;
    this.current = "Idle";
    this.t = 0;
    this.onFinished?.(was);
  }
}

// ---------------------------------------------------------------------------------------------
// Pip, the robot (RobotExpressive), kept as an alternative body.
// ---------------------------------------------------------------------------------------------
export class RobotRig {
  constructor(url = "/models/RobotExpressive.glb") {
    this.url = url;
    this.height = 0.8;
    this.onFinished = null;
    this.current = "Idle";
  }

  async load(parent) {
    const gltf = await new GLTFLoader().loadAsync(this.url);
    const model = SkeletonUtils.clone(gltf.scene);
    model.updateMatrixWorld(true); // measure the posed model, not the clone's stale transforms
    const box = new THREE.Box3().setFromObject(model, true);
    const h = box.max.y - box.min.y;
    const s = this.height / (h > 0.5 && h < 20 ? h : 4.45); // 4.45 = RobotExpressive's height in its own units
    model.scale.setScalar(s);
    model.position.y = -Math.max(box.min.y, -0.1) * s;
    afterWorld(model);
    parent.add(model);
    model.traverse((o) => o.isBone && o.name === "Head" && (this.headBone = o));
    this.faces = [];
    model.traverse((o) => o.morphTargetDictionary && this.faces.push(o));
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    for (const name of ONE_SHOT) {
      const a = this.actions[name];
      if (a && name !== "Dance") (a.clampWhenFinished = true), a.setLoop(THREE.LoopOnce, 1);
    }
    this.mixer.addEventListener("finished", () => {
      const was = this.current;
      this.play("Idle");
      this.onFinished?.(was);
    });
    this.actions.Idle.play();
  }

  play(name, fade = 0.3) {
    // Bonnie's tricks, on Pip's closest clips.
    name = { Flip: "Jump", Cartwheel: "Jump", Spin: "Dance", Clap: "ThumbsUp", Moonwalk: "Dance" }[name] ?? name;
    const next = this.actions?.[name], prev = this.actions?.[this.current];
    if (!next || name === this.current) return;
    clearTimeout(this._danceTimer); // a stale Dance timeout must not end a later dance early
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    prev?.fadeOut(fade);
    this.current = name;
    if (name === "Dance") this._danceTimer = setTimeout(() => this.current === "Dance" && (this.play("Idle"), this.onFinished?.("Dance")), 4500);
  }

  setFace(name, amount) {
    for (const m of this.faces) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = amount;
    }
  }

  update(dt, { talking, listening, speakT }) {
    this.mixer.update(dt);
    if (this.headBone) {
      this.headBone.rotation.x = talking ? Math.sin(speakT * 9) * 0.06 + Math.sin(speakT * 3.1) * 0.04 : listening ? -0.12 : 0;
      this.headBone.rotation.z = listening ? 0.15 : 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The companion's behaviour: wandering, following, coming when called, talking, speech bubble.
// ---------------------------------------------------------------------------------------------
export class Companion {
  constructor(scene, camera, { name = "Bonnie", rig = new BunnyRig() } = {}) {
    this.name = name;
    this.scene = scene;
    this.camera = camera;
    this.rig = rig;
    this.height = rig.height;
    this.root = new THREE.Group(); // stands on the floor (y = 0 in local-floor space)
    this.root.name = name.toLowerCase();
    this.root.visible = false;
    scene.add(this.root);
    this.shadow = blobShadow(0.5);
    this.root.add(this.shadow);
    // The body hangs in a pivot at its middle, so it can tumble when thrown (physics.js).
    this.centerY = rig.center ?? this.height * 0.4;
    this.radius = rig.radius ?? 0.2;
    this.pivot = new THREE.Group();
    this.pivot.position.y = this.centerY;
    this.inner = new THREE.Group();
    this.inner.position.y = -this.centerY;
    this.pivot.add(this.inner);
    this.root.add(this.pivot);
    this.phys = null; // null | { state: "held" | "flying" | "getup", ... }
    this.tracker = new VelocityTracker();
    this.physicsEnv = () => ({}); // main.js: room box and windows to bounce off
    this.onPhysics = null; // (event: "grab" | "throw" | "bounce" | "landed", amount) => {}
    // Invisible capsule so you can point at / pinch the companion.
    this.hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.17, this.height - 0.3, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = this.height / 2;
    this.hitbox.userData.companion = true;
    this.root.add(this.hitbox);

    // Speech bubble above its head ("…" while thinking, then what it says).
    this.bubbleCanvas = Object.assign(document.createElement("canvas"), { width: 768, height: 256 });
    this.bubbleTex = new THREE.CanvasTexture(this.bubbleCanvas);
    this.bubbleTex.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.bubbleTex, transparent: true, depthWrite: false, depthTest: false }),
    );
    this.bubble.center.set(0.5, 0); // grows up from the tail, which stays just over her head
    this.bubble.position.y = this.height + 0.08;
    this._sizeBubble(2.5);
    this.bubble.renderOrder = LAYER.SPEECH_BUBBLE; // always readable, even in front of a window's caption
    this.bubble.visible = false;
    this.root.add(this.bubble);

    // A warm glow around it while a hand or controller is aimed at it: "pinch now and you'll catch it".
    const glowCanvas = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
    {
      const g = glowCanvas.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,208,138,0.55)");
      grad.addColorStop(0.6, "rgba(255,154,90,0.25)");
      grad.addColorStop(1, "rgba(255,154,90,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    this.aimGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.aimGlow.scale.setScalar(this.height * 1.25);
    this.aimGlow.renderOrder = LAYER.COMPANION_GLOW;
    this.aimGlow.visible = false;
    this.scene.add(this.aimGlow);

    this.ready = false;
    this.mode = "idle"; // idle | walk | talk
    this.target = null;
    this._goal = new THREE.Vector3(); // owned storage for the walk target (see update)
    this.idleUntil = 0;
    this.talking = false; // it is speaking
    this.listening = false; // you are speaking to it / it is thinking
    this.emoting = false;
    this.followUser = false;
    this.speakStart = 0;
    // How far it roams and where it stops when called (wider on a flat screen, so it stays in frame).
    this.range = [1.2, 2.4];
    this.comeDistance = 0.8;
    this.following = false; // walks beside you wherever you go
    this.errand = null; // { point, done, until }: walking somewhere to do something (see goTo)
    this.attendUntil = 0; // you are talking: she comes over and faces you until then (see attend)
    this.nextShowOff = performance.now() + 40000; // now and then, when idle, she does a trick on her own
    this.wanderDeg = 50; // how far to either side of where you look she wanders (narrower on a phone screen)
    this.returnAt = 0; // when to walk back to you after a throw (0 = not pending)
    this.strayT = 0; // ms spent too far away
    rig.onFinished = () => {
      this.emoting = false;
      this.rig.play(this.mode === "walk" ? "Walking" : "Idle");
    };
  }

  async load() {
    await this.rig.load(this.inner);
    this.ready = true;
  }

  /** Follow you around (on), or stay where it is (off). */
  setFollowing(on) {
    this.following = Boolean(on);
    this.followUser = false;
    this.target = null;
    if (!on) (this.mode = "idle"), (this.idleUntil = performance.now() + 6000);
  }

  /**
   * An errand: walk (run) to `point` on the floor, then call `done`. It waits while it is talking, gives
   * up after `timeoutMs` (and still calls `done`), and is dropped if you pick it up or send it away.
   */
  goTo(point, done, timeoutMs = 15000) {
    this.errand = { point: new THREE.Vector3(point.x, 0, point.z), done, until: performance.now() + timeoutMs };
  }

  /**
   * Keeps the bubble readable at any distance: its world size grows with distance almost as fast as the view
   * shrinks it (apparent size ~ distance^-0.15), within limits, so it looks nearly the same size near or far.
   */
  _sizeBubble(dist) {
    const k = THREE.MathUtils.clamp(Math.pow(dist / 2.5, 0.85), 0.5, 3);
    this.bubble.scale.set(0.9 * k, 0.3 * k, 1);
  }

  /** Shows text above its head for `ms` (or until replaced). Empty text hides it. */
  say(text, ms = 9000) {
    clearTimeout(this._bubbleTimer);
    if (!text) return void (this.bubble.visible = false);
    const g = this.bubbleCanvas.getContext("2d"), w = 768, h = 256;
    g.clearRect(0, 0, w, h);
    g.font = "500 34px system-ui, sans-serif";
    const words = text.split(/\s+/), lines = [];
    let line = "";
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (g.measureText(t).width > w - 80 && line) lines.push(line), (line = wd);
      else line = t;
    }
    lines.push(line);
    const shown = lines.slice(0, 4);
    if (lines.length > 4) shown[3] = shown[3].replace(/\s*\S*$/, "…");
    const bh = 36 + shown.length * 42;
    const top = h - bh - 26;
    g.fillStyle = "rgba(255,248,236,0.95)";
    g.strokeStyle = "#ff9a5a";
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(10, top, w - 20, bh, 30);
    g.moveTo(w / 2 - 22, top + bh);
    g.lineTo(w / 2, h - 4);
    g.lineTo(w / 2 + 22, top + bh);
    g.fill();
    g.stroke();
    g.fillStyle = "#1b1206";
    g.textAlign = "center";
    g.textBaseline = "middle";
    shown.forEach((l, i) => g.fillText(l, w / 2, top + 18 + 21 + i * 42));
    this.bubbleTex.needsUpdate = true;
    this.bubble.visible = true;
    this._bubbleTimer = setTimeout(() => (this.bubble.visible = false), ms);
  }

  get visible() {
    return this.root.visible;
  }

  _eye() {
    return this.camera.getWorldPosition(_eyeV); // scratch: copy it if you keep it
  }

  /** Appear in front of you (further away on a flat screen, so it fits in view). */
  summon(distance = 1.4, { side = 0.4 } = {}) {
    const eye = this._eye();
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q1));
    fwd.y = 0;
    fwd.normalize();
    // A little to your left, so it doesn't stand in front of the window you're looking at.
    const left = _left.set(fwd.z, 0, -fwd.x);
    this._endPhysics();
    this.returnAt = 0;
    this.strayT = 0;
    this.root.position.set(eye.x + fwd.x * distance + left.x * distance * side, 0, eye.z + fwd.z * distance + left.z * distance * side);
    this.root.lookAt(eye.x, 0, eye.z);
    this.root.visible = true;
    this.mode = "idle";
    this.idleUntil = performance.now() + 3000;
    this.gesture("wave");
  }

  dismiss() {
    this.errand = null;
    this._endPhysics();
    this.root.visible = false;
    this.followUser = false;
    this.following = false;
  }

  /** Are you looking at it (so your words go to it instead of the story)? */
  isLookedAt() {
    if (!this.visible) return false;
    const eye = this._eye();
    const at = _v1.copy(this.root.position).setY(this.height * 0.6);
    const to = at.sub(eye);
    const dist = to.length();
    if (dist > 5) return false;
    const gaze = _v2.set(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q1));
    // A wider cone up close, since it fills more of your view.
    return gaze.dot(to.normalize()) > Math.cos(THREE.MathUtils.degToRad(dist < 1.5 ? 32 : 22));
  }

  gesture(name) {
    if (name === "think") return this._face(0.35, 1500);
    const clip = GESTURES[name];
    if (!clip) return;
    this.emoting = true;
    this.rig.play(clip, 0.2);
  }

  _face(amount, ms) {
    this.rig.setFace("Surprised", amount);
    clearTimeout(this._faceTimer);
    if (amount) this._faceTimer = setTimeout(() => this.rig.setFace("Surprised", 0), ms);
  }

  /** You started talking to it: stop and look at you. */
  listen() {
    this.listening = true;
    this.mode = "talk";
    if (!this.emoting) this.rig.play("Idle");
    this._face(0.25, 30000);
  }

  /**
   * You started (on) or stopped (off) talking. While you talk she comes over and faces you, whoever you
   * are talking to: she is listening, not answering (that is `listen()`). Does nothing while she is held
   * or flying, and gives up by itself after 90 s in case the "stopped" never arrives.
   */
  attend(on) {
    this.attendUntil = on && this.visible && !this.phys ? performance.now() + 90000 : 0;
  }

  /** Its reply arrived: gesture, maybe move, and talk while its voice plays. */
  react({ gesture, move }) {
    this.listening = false;
    this._face(0, 0);
    if (move === "follow") this.setFollowing(true);
    if (move === "come") (this.following = false), (this.followUser = true);
    if (move === "stay") this.setFollowing(false);
    if (move === "wander") this.setFollowing(false), (this.idleUntil = 0);
    if (gesture && gesture !== "none") this.gesture(gesture);
  }

  speaking(on) {
    this.talking = on;
    this.speakStart = performance.now();
    if (on) this.mode = "talk";
    else this.idleUntil = performance.now() + 2500;
  }

  _pickWanderTarget(eye) {
    // Somewhere on the floor in front of you (within ±wanderDeg of where you're facing), so it stays
    // where you can see it instead of wandering behind you.
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q1));
    const facing = Math.atan2(fwd.x, fwd.z);
    for (let i = 0; i < 8; i++) {
      const a = facing + THREE.MathUtils.degToRad((Math.random() * 2 - 1) * this.wanderDeg);
      const r = this.range[0] + Math.random() * (this.range[1] - this.range[0]);
      const p = new THREE.Vector3(eye.x + Math.sin(a) * r, 0, eye.z + Math.cos(a) * r);
      if (p.distanceTo(this.root.position) > 0.5) return p;
    }
    return null;
  }

  update(dt) {
    if (!this.ready || !this.visible) return;
    const now = performance.now();
    this.rig.update(dt, { talking: this.talking, listening: this.listening, speakT: (now - this.speakStart) / 1000 });
    const eye = this._eye();
    const toUser = _toUser.set(eye.x - this.root.position.x, 0, eye.z - this.root.position.z);
    const distUser = toUser.length();
    this._sizeBubble(eye.distanceTo(this.root.position));
    const moving = () => this.rig.current === "Walking" || this.rig.current === "Running";
    if (this.phys) return this._updatePhysics(dt, now, toUser);

    // It is always around: after a throw, or if it ends up far from you, it comes back by itself.
    const pos = this.root.position;
    if (!Number.isFinite(pos.x + pos.y + pos.z) || distUser > LOST_DIST) {
      this.summon(this.comeDistance + 0.6); // lost it (out of the room, bad numbers): put it back
      return;
    }
    this.strayT = distUser > STRAY_DIST ? this.strayT + dt * 1000 : 0;
    if ((this.returnAt && now > this.returnAt) || this.strayT > RETURN_AFTER) {
      this.returnAt = 0;
      this.strayT = 0;
      if (!this.following && !this.listening && !this.talking) this.followUser = true;
    }

    let speed = WALK_SPEED;
    const attending = now < this.attendUntil;
    if (attending && !this.listening && !this.talking && distUser > this.comeDistance + 0.4) {
      // You are talking and she is far: run over to just in front of you.
      this.target = this._goal.set(eye.x, 0, eye.z).addScaledVector(_v1.copy(toUser).normalize(), -this.comeDistance);
      this.mode = "walk";
      speed = RUN_SPEED;
    } else if (this.listening || this.talking || attending) {
      this.mode = "talk";
      this._turnTowards(toUser, dt, 4);
      if (!this.emoting) this.rig.play("Idle");
    } else if (this.errand) {
      const e = this.errand;
      const off = Math.hypot(e.point.x - pos.x, e.point.z - pos.z);
      if (off < 0.2 || now > e.until) {
        // Arrived (or gave up): do the thing, then carry on as before.
        this.errand = null;
        this.target = null;
        this.mode = "idle";
        this.idleUntil = now + 4000;
        this.gesture("thumbs_up");
        e.done?.();
      } else {
        this.target = e.point;
        this.mode = "walk";
        speed = RUN_SPEED;
      }
    } else if (this.following) {
      // Walk beside you: a little ahead and to your left, so it stays in view as you move.
      const fwd = _fwd.set(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q1)).setY(0);
      if (fwd.lengthSq() > 1e-4) fwd.normalize();
      const left = _left.set(fwd.z, 0, -fwd.x); // 90° to the left of where you face
      const spot = _spot.set(eye.x, 0, eye.z).addScaledVector(fwd, 0.9).addScaledVector(left, 0.55);
      const off = spot.distanceTo(this.root.position);
      if (distUser > 8) {
        // You walked off (another room?): pop back beside you.
        this.root.position.copy(spot);
        this.gesture("jump");
      } else if (off > (this.mode === "walk" ? 0.15 : 0.5)) {
        this.target = this._goal.copy(spot);
        this.mode = "walk";
        if (off > 1.6) speed = RUN_SPEED;
      } else if (this.mode === "walk") {
        this.mode = "idle";
        this.target = null;
      } else if (!this.emoting) {
        this._turnTowards(toUser, dt, 2); // waiting beside you: glance at you
        this.rig.play("Idle");
      }
    } else if (this.followUser && distUser > this.comeDistance + 0.2) {
      // Come to just in front of you.
      this.target = this._goal.set(eye.x, 0, eye.z).addScaledVector(_v1.copy(toUser).normalize(), -this.comeDistance);
      this.mode = "walk";
      if (distUser > 3) speed = RUN_SPEED;
    } else if (this.mode === "talk" && now > this.idleUntil) {
      this.mode = "idle";
      this.idleUntil = now + 4000 + Math.random() * 4000;
    } else if (this.mode === "idle" && now > this.idleUntil && !this.emoting) {
      if (now > this.nextShowOff && !this.followUser) {
        // Showing off: a dance or a trick, about once a minute, instead of wandering this time.
        this.nextShowOff = now + 50000 + Math.random() * 40000;
        this.idleUntil = now + 3500;
        this.gesture(SHOW_OFF[Math.floor(Math.random() * SHOW_OFF.length)]);
      } else if (this.followUser) this.idleUntil = now + 2000;
      else {
        this.target = this._pickWanderTarget(eye);
        if (this.target) this.mode = "walk";
      }
    }

    if (this.mode === "walk" && this.target && !this.emoting) {
      const to = _to.copy(this.target).sub(this.root.position).setY(0);
      const d = to.length();
      if (d < 0.08) {
        this.mode = "idle";
        this.target = null;
        if (!this.following) {
          this.idleUntil = now + 3000 + Math.random() * 5000;
          if (this.followUser) this.gesture("wave");
          this.followUser = false;
        }
        if (!this.emoting) this.rig.play("Idle");
      } else {
        this.rig.play(speed > WALK_SPEED ? "Running" : "Walking");
        this._turnTowards(to, dt, speed > WALK_SPEED ? 8 : 5);
        const facing = _facing.set(0, 0, 1).applyQuaternion(this.root.quaternion);
        // Only move once roughly facing the way it's going.
        if (facing.dot(to.divideScalar(d)) > 0.6) this.root.position.addScaledVector(to, Math.min(d, speed * dt));
      }
    } else if (this.mode !== "walk" && !this.emoting && moving()) this.rig.play("Idle");
    // Standing still between wanders: turn back to face you (otherwise she stayed facing wherever she last
    // walked, often with her back to you).
    if (this.mode === "idle" && !this.emoting) this._turnTowards(toUser, dt, 1.5);
  }

  // ---------- Grab and throw ----------
  /** Show the "you can grab it" glow (or hide it). Call every frame. */
  highlight(on) {
    this.aimGlow.visible = Boolean(on) && this.visible;
    if (this.aimGlow.visible) {
      this.centerWorld(this.aimGlow.position);
      this.aimGlow.material.opacity = 0.85 + Math.sin(performance.now() / 400) * 0.1; // gentle, not flickering
    }
  }

  get held() {
    return this.phys?.state === "held";
  }

  /** Where its middle is (world space): the point you hold and the centre of the bouncing ball. */
  centerWorld(out = new THREE.Vector3()) {
    return this.pivot.getWorldPosition(out);
  }

  /**
   * Pick it up: it follows `holder` (a controller / hand ray object) until release(). A grab from
   * a distance (pointing at it) reels it in to your hand; pass reel = false to keep it where it is
   * relative to the holder (the mouse on desktop).
   */
  grab(holder, { reel = true } = {}) {
    if (!this.ready || !this.visible) return false;
    this.errand = null; // picked up: the errand is off
    const from = { pos: this.root.position.clone(), quat: this.root.quaternion.clone(), fresh: !this.phys };
    // From here on the root only carries the position; the pivot carries the whole orientation.
    const q = this.pivot.getWorldQuaternion(new THREE.Quaternion());
    const center = this.centerWorld();
    this.root.quaternion.identity();
    this.pivot.quaternion.copy(q);
    holder.updateWorldMatrix(true, false);
    const hq = holder.getWorldQuaternion(new THREE.Quaternion());
    const offset = holder.worldToLocal(center.clone());
    this.phys = {
      state: "held", holder, from, offset,
      rel: hq.clone().invert().multiply(q), // its orientation in the hand
      reel: reel && offset.distanceTo(REEL_TO) > 0.3,
      at: performance.now(),
      start: holder.getWorldPosition(new THREE.Vector3()),
      travel: 0,
    };
    this.tracker.reset();
    this.returnAt = 0;
    this.strayT = 0;
    this.target = null;
    this.emoting = false;
    this.rig.play("Idle");
    this._face(1, 60000);
    this.onPhysics?.("grab", 0);
    return true;
  }

  /**
   * Hand the held body to another holder (e.g. a point midway between both hands) without it jumping.
   * Returns false if it is not being held.
   */
  rehold(holder) {
    const p = this.phys;
    if (p?.state !== "held") return false;
    holder.updateWorldMatrix(true, false);
    const q = this.pivot.getWorldQuaternion(new THREE.Quaternion());
    p.holder = holder;
    p.offset = holder.worldToLocal(this.centerWorld());
    p.rel = holder.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q);
    p.reel = false;
    p.start = holder.getWorldPosition(new THREE.Vector3());
    p.travel = Math.max(p.travel, 1); // lifted with both hands on purpose: letting go is a throw, never a "tap"
    this.tracker.reset();
    return true;
  }

  /** Let go. Returns "tap" (a short press that barely moved: nothing happened) or "throw". */
  release() {
    const p = this.phys;
    if (p?.state !== "held") return null;
    if (isTap(performance.now() - p.at, p.travel)) {
      if (p.from.fresh) {
        this.root.position.copy(p.from.pos);
        this.root.quaternion.copy(p.from.quat);
        this.pivot.quaternion.identity();
        this._endPhysics();
      } else this._fly(new THREE.Vector3()); // caught in mid-air and let go: just drop
      return "tap";
    }
    const v = this.tracker.velocity(MAX_THROW / THROW_BOOST);
    const vel = new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(THROW_BOOST);
    this._fly(vel);
    this.onPhysics?.("throw", vel.length());
    return "throw";
  }

  _fly(vel) {
    const c = this.centerWorld();
    this.phys = {
      state: "flying",
      body: { pos: { x: c.x, y: c.y, z: c.z }, vel: { x: vel.x, y: vel.y, z: vel.z }, radius: this.radius },
      env: this.physicsEnv() || {},
      spin: new THREE.Vector3(),
      hardest: 0,
      since: performance.now(),
    };
    // Tumble the way it flies, plus a little wobble so a straight-up toss spins too.
    this._rollSpin(0.5);
    this.phys.spin.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
  }

  // Spin as if rolling in the direction of travel (axis = up × velocity).
  _rollSpin(amount = 1) {
    const { body, spin } = this.phys;
    spin.set(body.vel.x, 0, body.vel.z).applyAxisAngle(UP, Math.PI / 2).multiplyScalar(amount / this.radius);
    spin.clampLength(0, 25);
  }

  _endPhysics() {
    if (!this.phys) return;
    this.phys = null;
    this.pivot.quaternion.identity();
    this.root.position.y = 0;
    this.shadow.position.y = 0.004;
    this.shadow.scale.setScalar(1);
    this._face(0, 0);
    this.mode = "idle";
    this.target = null;
    this.idleUntil = performance.now() + 1500;
  }

  _updatePhysics(dt, now, toUser) {
    const p = this.phys;
    if (p.state === "held") {
      const h = p.holder;
      if (p.reel) p.offset.lerp(REEL_TO, 1 - Math.exp(-dt * 9));
      const c = h.localToWorld(_c.copy(p.offset));
      this.root.position.set(c.x, c.y - this.centerY, c.z);
      this.pivot.quaternion.copy(h.getWorldQuaternion(_q1).multiply(p.rel));
      // The throw uses the hand's own motion, not the reeling-in.
      const hand = h.getWorldPosition(_v1);
      this.tracker.push(p.reel ? h.localToWorld(_v2.copy(REEL_TO)) : c, now);
      p.travel = Math.max(p.travel, hand.distanceTo(p.start));
    } else if (p.state === "flying") {
      const r = stepBody(p.body, dt, p.env);
      this.root.position.set(p.body.pos.x, p.body.pos.y - this.centerY, p.body.pos.z);
      if (r.impact) {
        p.hardest = Math.max(p.hardest, r.impact);
        this._rollSpin(1);
        if (r.impact > 1.2) this.onPhysics?.("bounce", r.impact);
      }
      if (p.body.vel.y === 0) this._rollSpin(1); // rolling along the floor
      const w = p.spin.length();
      if (w > 1e-3) this.pivot.quaternion.premultiply(_q1.setFromAxisAngle(_v1.copy(p.spin).divideScalar(w), w * dt));
      if (r.resting || now - p.since > 12000) {
        // Get back up, facing you.
        const yaw = toUser.lengthSq() > 1e-4 ? Math.atan2(toUser.x, toUser.z) : 0;
        this.phys = {
          state: "getup", t: -0.35, hardest: p.hardest, // lies there for a moment first
          fromQ: this.pivot.quaternion.clone(), toQ: new THREE.Quaternion().setFromAxisAngle(UP, yaw), fromY: this.root.position.y,
        };
      }
    } else {
      p.t += dt / 0.55;
      const k = THREE.MathUtils.smootherstep(p.t, 0, 1);
      this.pivot.quaternion.slerpQuaternions(p.fromQ, p.toQ, k);
      this.root.position.y = p.fromY * (1 - k) + Math.sin(Math.PI * k) * 0.12; // a little hop onto its feet
      if (p.t >= 1) {
        this.root.quaternion.copy(p.toQ);
        this._endPhysics();
        this.returnAt = performance.now() + RETURN_AFTER;
        this.onPhysics?.("landed", p.hardest);
      }
    }
    // The shadow stays on the floor, fading out as it gets higher.
    const y = this.root.position.y;
    this.shadow.position.y = 0.004 - y;
    this.shadow.scale.setScalar(THREE.MathUtils.clamp(1 - y * 0.35, 0.35, 1));
  }

  _turnTowards(dir, dt, rate) {
    if (dir.lengthSq() < 1e-4) return;
    const want = Math.atan2(dir.x, dir.z); // the body faces +Z
    const q = _q1.setFromAxisAngle(UP, want);
    this.root.quaternion.slerp(q, Math.min(1, dt * rate));
  }
}
