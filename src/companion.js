import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Pip: an animated robot (RobotExpressive by Tomás Laulhé / Quaternius, CC0) who walks around your
// real floor, wanders, comes when called, faces you to listen and talk, and gestures as it speaks.
const HEIGHT = 0.62; // metres: about knee-to-thigh high
const WALK_SPEED = 0.45; // m/s
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

    this.ready = false;
    this.mode = "idle"; // idle | walk | talk
    this.target = null;
    this.idleUntil = 0;
    this.talking = false; // Pip speaking
    this.listening = false; // you speaking to Pip / Pip thinking
    this.emoting = false;
    this.followUser = false;
    this.speakStart = 0;
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

  /** Appear a little in front of you, with a hop. */
  summon() {
    const eye = this._eye();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    this.root.position.set(eye.x + fwd.x * 1.3, 0, eye.z + fwd.z * 1.3);
    this.root.lookAt(eye.x, 0, eye.z);
    this.root.visible = true;
    this.mode = "idle";
    this.idleUntil = performance.now() + 3000;
    this.gesture("wave");
  }

  dismiss() {
    this.root.visible = false;
    this.followUser = false;
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
    if (move === "come") this.followUser = true;
    if (move === "wander") (this.followUser = false), (this.mode = "idle"), (this.idleUntil = 0);
    if (gesture && gesture !== "none") this.gesture(gesture);
  }

  speaking(on) {
    this.talking = on;
    this.speakStart = performance.now();
    if (on) this.mode = "talk";
    else this.idleUntil = performance.now() + 2500;
  }

  _pickWanderTarget(eye) {
    // Somewhere on the floor 0.9–2.2 m from you, not right under your feet.
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.9 + Math.random() * 1.3;
      const p = new THREE.Vector3(eye.x + Math.cos(a) * r, 0, eye.z + Math.sin(a) * r);
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

    if (this.listening || this.talking) {
      this.mode = "talk";
      this._turnTowards(toUser, dt, 4);
      if (!this.emoting && this.current !== this.actions.Idle) this.play("Idle");
    } else if (this.followUser && distUser > 1.0) {
      // Come to about 80 cm in front of you.
      this.target = new THREE.Vector3(eye.x, 0, eye.z).addScaledVector(toUser.clone().normalize(), -0.8);
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
      if (d < 0.08) {
        this.mode = "idle";
        this.target = null;
        this.idleUntil = now + 3000 + Math.random() * 5000;
        if (this.followUser) this.gesture("wave");
        this.followUser = false;
        this.play("Idle");
      } else {
        this.play("Walking");
        this._turnTowards(to, dt, 5);
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
        // Only walk forward once roughly facing the way it's going.
        if (facing.dot(to.clone().normalize()) > 0.6) this.root.position.addScaledVector(to.normalize(), Math.min(d, WALK_SPEED * dt));
      }
    } else if (this.mode !== "walk" && !this.emoting && this.current === this.actions.Walking) this.play("Idle");

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
