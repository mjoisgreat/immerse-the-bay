import * as THREE from "three";

// Moving around a 3D world beyond your real room: smooth walking with the left thumbstick,
// snap turning with the right, and teleporting by pointing at the ground and pinching (or the
// trigger). It works by offsetting the XR reference space, so your real steps still count too.
// Only active while a world background is on; reset() puts you back where your real room is.
const SPEED = 2.0; // m/s at full stick
const SNAP = THREE.MathUtils.degToRad(30);
const MAX_TELEPORT = 12; // metres

export class Locomotion {
  constructor(renderer, camera, scene) {
    this.renderer = renderer;
    this.camera = camera;
    this.base = null; // the session's local-floor reference space
    this.m = new THREE.Matrix4(); // physical (room) -> world
    this.moved = false;
    this.turnHeld = [false, false];
    this.enabled = false;

    // Landing marker for teleports: a glowing ring on the floor.
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.27, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.9, depthTest: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.06, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.8, depthTest: false }),
    );
    for (const m of [ring, dot]) (m.rotation.x = -Math.PI / 2), (m.renderOrder = 30), this.marker.add(m);
    this.marker.position.y = 0.01;
    this.marker.visible = false;
    scene.add(this.marker);
    this.aim = null; // floor point being aimed at, or null
  }

  /** Call when an XR session starts (after setSession). */
  start() {
    this.base = this.renderer.xr.getReferenceSpace();
    this.m.identity();
    this.moved = false;
  }

  stop() {
    this.base = null;
    this.m.identity();
    this.moved = false;
    this.marker.visible = false;
  }

  /** Back to your real room (identity offset), so windows line up with your real walls again. */
  reset() {
    if (!this.moved) return;
    this.m.identity();
    this.moved = false;
    this._apply();
  }

  _apply() {
    if (!this.base || !window.XRRigidTransform) return;
    // The offset space's origin, expressed in the base space, is the inverse of physical -> world.
    const inv = this.m.clone().invert();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    inv.decompose(p, q, s);
    const t = new XRRigidTransform({ x: p.x, y: p.y, z: p.z, w: 1 }, { x: q.x, y: q.y, z: q.z, w: q.w });
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(t));
  }

  _head() {
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Moves you by a world-space offset (y ignored). */
  translate(dx, dz) {
    this.m.premultiply(new THREE.Matrix4().makeTranslation(dx, 0, dz));
    this.moved = true;
    this._apply();
  }

  /** Turns you in place, around your head. */
  turn(angle) {
    const h = this._head();
    const t = new THREE.Matrix4().makeTranslation(h.x, 0, h.z);
    const r = new THREE.Matrix4().makeRotationY(angle);
    const tInv = new THREE.Matrix4().makeTranslation(-h.x, 0, -h.z);
    this.m.premultiply(tInv).premultiply(r).premultiply(t);
    this.moved = true;
    this._apply();
  }

  /** Puts your head right above a floor point. */
  teleport(point) {
    const h = this._head();
    this.translate(point.x - h.x, point.z - h.z);
  }

  /** Where a ray meets the floor (y = 0), if it points down and lands close enough. */
  floorHit(ray) {
    if (ray.direction.y > -0.12) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return null;
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    return p.distanceTo(ray.origin) <= MAX_TELEPORT ? p.setY(0) : null;
  }

  /**
   * Per frame: thumbsticks, and the teleport marker for whichever pointer aims at the floor.
   * `rays` are the controllers'/hands' pointing rays (null where not tracked).
   */
  update(dt, rays) {
    const session = this.renderer.xr.getSession();
    this.aim = null;
    if (!session || !this.enabled) return void (this.marker.visible = false);
    for (const ray of rays) {
      const p = ray && this.floorHit(ray);
      if (p) {
        this.aim = p;
        break;
      }
    }
    this.marker.visible = Boolean(this.aim);
    if (this.aim) this.marker.position.set(this.aim.x, 0.01, this.aim.z), this.marker.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.05);

    for (const src of session.inputSources) {
      const axes = src.gamepad?.axes;
      if (!axes || axes.length < 4) continue;
      const x = axes[2], y = axes[3];
      if (src.handedness === "left") {
        // Walk where you're looking (flattened), strafe sideways.
        if (Math.hypot(x, y) < 0.15) continue;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const move = fwd.multiplyScalar(-y).add(right.multiplyScalar(x)).multiplyScalar(SPEED * dt);
        this.translate(move.x, move.z);
      } else if (src.handedness === "right") {
        // Snap turn: one step per push.
        const i = 1;
        if (Math.abs(x) > 0.7 && !this.turnHeld[i]) (this.turnHeld[i] = true), this.turn(x > 0 ? -SNAP : SNAP);
        if (Math.abs(x) < 0.3) this.turnHeld[i] = false;
      }
    }
  }
}
