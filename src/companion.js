import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Pip: an animated robot (RobotExpressive by Tomás Laulhé / Quaternius, CC0) who walks around your
// real floor, wanders, comes when called, faces you to listen and talk, and gestures as it speaks.
const HEIGHT = 0.8; // metres: about thigh high, big enough to read across a room
const WALK_SPEED = 0.45; // m/s
const RUN_SPEED = 1.3; // when it has fallen behind
const GESTURES = { wave: "Wave", yes: "Yes", no: "No", thumbs_up: "ThumbsUp", jump: "Jump", dance: "Dance" };

function blobShadow() {
  const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.55),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

export class Companion {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group(); // stands on the floor (y = 0 in local-floor space)
    this.root.name = "pip";
    this.root.visible = false;
    scene.add(this.root);
    this.root.add(blobShadow());
    // Invisible capsule so you can point at / pinch Pip.
    this.hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.16, HEIGHT - 0.3, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = HEIGHT / 2;
    this.hitbox.userData.pip = true;
    this.root.add(this.hitbox);

    // Speech bubble above Pip's head ("…" while thinking, then what Pip says).
    this.bubbleCanvas = Object.assign(document.createElement("canvas"), { width: 768, height: 256 });
    this.bubbleTex = new THREE.CanvasTexture(this.bubbleCanvas);
    this.bubbleTex.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.bubbleTex, transparent: true, depthWrite: false, depthTest: false }),
    );
    this.bubble.scale.set(0.9, 0.3, 1);
    this.bubble.position.y = HEIGHT + 0.28;
    this.bubble.renderOrder = 25; // always readable, even in front of a window's caption
    this.bubble.visible = false;
    this.root.add(this.bubble);

    this.ready = false;
    this.mode = "idle"; // idle | walk | talk
    this.target = null;
    this.idleUntil = 0;
    this.talking = false; // Pip speaking
    this.listening = false; // you speaking to Pip / Pip thinking
    this.emoting = false;
    this.followUser = false;
    this.speakStart = 0;
    // How far Pip roams and where it stops when called (wider on a flat screen, so it stays in frame).
    this.range = [1.2, 2.4];
    this.comeDistance = 0.8;
    this.following = false; // walks beside you wherever you go
  }

  /** Follow you around (on), or stay where it is (off). */
  setFollowing(on) {
    this.following = Boolean(on);
    this.followUser = false;
    this.target = null;
    if (!on) (this.mode = "idle"), (this.idleUntil = performance.now() + 6000);
  }

  async load(url = "/models/RobotExpressive.glb") {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = SkeletonUtils.clone(gltf.scene);
    model.updateMatrixWorld(true); // measure the posed model, not the clone's stale transforms
    const box = new THREE.Box3().setFromObject(model, true);
    const h = box.max.y - box.min.y;
    const s = HEIGHT / (h > 0.5 && h < 20 ? h : 4.45); // 4.45 = RobotExpressive's height in its own units
    model.scale.setScalar(s);
    model.position.y = -Math.max(box.min.y, -0.1) * s;
    model.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        // Draw in the transparent pass after the step-inside world, so Pip can come along inside.
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.depthWrite = true;
        o.renderOrder = 2;
      }
    });
    this.model = model;
    this.root.add(model);
    model.traverse((o) => o.isBone && o.name === "Head" && (this.head = o));
    this.face = [];
    model.traverse((o) => o.morphTargetDictionary && this.face.push(o));
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    for (const name of Object.values(GESTURES).concat(["Jump"])) {
      const a = this.actions[name];
      if (a && name !== "Dance") (a.clampWhenFinished = true), a.setLoop(THREE.LoopOnce, 1);
    }
    this.mixer.addEventListener("finished", () => {
      this.emoting = false;
      this.play(this.mode === "walk" ? "Walking" : "Idle");
    });
    this.current = this.actions.Idle;
    this.current.play();
    this.ready = true;
  }

  /** Shows text above Pip's head for `ms` (or until replaced). Empty text hides it. */
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

  play(name, fade = 0.3) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  get visible() {
    return this.root.visible;
  }

  _eye() {
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Appear in front of you (further away on a flat screen, so it fits in view). */
  summon(distance = 1.4) {
    const eye = this._eye();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    // A little to your left, so Pip doesn't stand in front of the window you're looking at.
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.root.position.set(eye.x + fwd.x * distance + left.x * distance * 0.4, 0, eye.z + fwd.z * distance + left.z * distance * 0.4);
    this.root.lookAt(eye.x, 0, eye.z);
    this.root.visible = true;
    this.mode = "idle";
    this.idleUntil = performance.now() + 3000;
    this.gesture("wave");
  }

  dismiss() {
    this.root.visible = false;
    this.followUser = false;
    this.following = false;
  }

  /** Are you looking at Pip (so your words go to Pip instead of the story)? */
  isLookedAt() {
    if (!this.visible) return false;
    const eye = this._eye();
    const at = this.root.position.clone().setY(HEIGHT * 0.7);
    const to = at.sub(eye);
    const dist = to.length();
    if (dist > 5) return false;
    const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    // A wider cone up close, since Pip fills more of your view.
    return gaze.dot(to.normalize()) > Math.cos(THREE.MathUtils.degToRad(dist < 1.5 ? 32 : 22));
  }

  gesture(name) {
    if (name === "think") return this.setFace("Surprised", 0.35);
    const clip = GESTURES[name];
    if (!clip || !this.actions[clip]) return;
    this.emoting = true;
    this.play(clip, 0.2);
    if (name === "dance") setTimeout(() => (this.emoting = false), 4500);
  }

  setFace(name, amount, ms = 1500) {
    for (const m of this.face) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = amount;
    }
    clearTimeout(this._faceTimer);
    this._faceTimer = setTimeout(() => this.setFace(name, 0, 0), ms);
  }

  /** You started talking to Pip: stop and look at you. */
  listen() {
    this.listening = true;
    this.mode = "talk";
    if (!this.emoting) this.play("Idle");
    this.setFace("Surprised", 0.25, 30000);
  }

  /** Pip's reply arrived: gesture, maybe move, and talk while its voice plays. */
  react({ gesture, move }) {
    this.listening = false;
    this.setFace("Surprised", 0, 0);
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
    // Somewhere on the floor in front of you (within ±50° of where you're facing), 1.2–2.4 m away,
    // so Pip stays where you can see it instead of wandering behind you.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const facing = Math.atan2(fwd.x, fwd.z);
    for (let i = 0; i < 8; i++) {
      const a = facing + THREE.MathUtils.degToRad((Math.random() * 2 - 1) * 50), r = this.range[0] + Math.random() * (this.range[1] - this.range[0]);
      const p = new THREE.Vector3(eye.x + Math.sin(a) * r, 0, eye.z + Math.cos(a) * r);
      if (p.distanceTo(this.root.position) > 0.5) return p;
    }
    return null;
  }

  update(dt) {
    if (!this.ready || !this.visible) return;
    this.mixer.update(dt);
    const now = performance.now();
    const eye = this._eye();
    const toUser = new THREE.Vector3(eye.x - this.root.position.x, 0, eye.z - this.root.position.z);
    const distUser = toUser.length();

    let speed = WALK_SPEED;
    if (this.listening || this.talking) {
      this.mode = "talk";
      this._turnTowards(toUser, dt, 4);
      if (!this.emoting && this.current !== this.actions.Idle) this.play("Idle");
    } else if (this.following) {
      // Walk beside you: a little ahead and to your left, so Pip stays in view as you move.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion())).setY(0);
      if (fwd.lengthSq() > 1e-4) fwd.normalize();
      const left = new THREE.Vector3(fwd.z, 0, -fwd.x); // 90° to the left of where you face
      const spot = new THREE.Vector3(eye.x, 0, eye.z).addScaledVector(fwd, 0.9).addScaledVector(left, 0.55);
      const off = spot.distanceTo(this.root.position);
      if (distUser > 8) {
        // You walked off (another room?): pop back beside you.
        this.root.position.copy(spot);
        this.gesture("jump");
      } else if (off > (this.mode === "walk" ? 0.15 : 0.5)) {
        this.target = spot;
        this.mode = "walk";
        if (off > 1.6) speed = RUN_SPEED;
      } else if (this.mode === "walk") {
        this.mode = "idle";
        this.target = null;
      } else if (!this.emoting) {
        this._turnTowards(toUser, dt, 2); // waiting beside you: glance at you
        if (this.current !== this.actions.Idle) this.play("Idle");
      }
    } else if (this.followUser && distUser > this.comeDistance + 0.2) {
      // Come to just in front of you.
      this.target = new THREE.Vector3(eye.x, 0, eye.z).addScaledVector(toUser.clone().normalize(), -this.comeDistance);
      this.mode = "walk";
    } else if (this.mode === "talk" && now > this.idleUntil) {
      this.mode = "idle";
      this.idleUntil = now + 4000 + Math.random() * 4000;
    } else if (this.mode === "idle" && now > this.idleUntil && !this.emoting) {
      if (this.followUser) this.idleUntil = now + 2000;
      else {
        this.target = this._pickWanderTarget(eye);
        if (this.target) this.mode = "walk";
      }
    }

    if (this.mode === "walk" && this.target && !this.emoting) {
      const to = this.target.clone().sub(this.root.position).setY(0);
      const d = to.length();
      if (d < 0.08 && this.following) {
        this.mode = "idle";
        this.target = null;
        this.play("Idle");
      } else if (d < 0.08) {
        this.mode = "idle";
        this.target = null;
        this.idleUntil = now + 3000 + Math.random() * 5000;
        if (this.followUser) this.gesture("wave");
        this.followUser = false;
        this.play("Idle");
      } else {
        this.play(speed > WALK_SPEED ? "Running" : "Walking");
        this._turnTowards(to, dt, speed > WALK_SPEED ? 8 : 5);
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
        // Only move once roughly facing the way it's going.
        if (facing.dot(to.clone().normalize()) > 0.6) this.root.position.addScaledVector(to.normalize(), Math.min(d, speed * dt));
      }
    } else if (this.mode !== "walk" && !this.emoting && (this.current === this.actions.Walking || this.current === this.actions.Running)) this.play("Idle");

    // While talking, a little head bob so the words look like they come from Pip.
    if (this.head) {
      const t = (now - this.speakStart) / 1000;
      this.head.rotation.x = this.talking ? Math.sin(t * 9) * 0.06 + Math.sin(t * 3.1) * 0.04 : this.listening ? -0.12 : 0;
      this.head.rotation.z = this.listening ? 0.15 : 0;
    }
  }

  _turnTowards(dir, dt, rate) {
    if (dir.lengthSq() < 1e-4) return;
    const want = Math.atan2(dir.x, dir.z); // model faces +Z
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), want);
    this.root.quaternion.slerp(q, Math.min(1, dt * rate));
  }
}
