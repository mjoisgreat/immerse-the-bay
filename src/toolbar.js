import * as THREE from "three";

// A floating button panel for the headset. It rests below your gaze, follows you lazily when you
// turn or walk away, and is pressed by pointing (controller trigger or hand pinch).
const BW = 0.15, BH = 0.085, GAP = 0.012;

function drawButton(canvas, { icon, label, state }) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const fill = { idle: "rgba(16,20,34,0.86)", hover: "rgba(52,44,36,0.95)", active: "#ff9a5a", warn: "#c8483a" }[state];
  g.fillStyle = fill;
  g.strokeStyle = state === "idle" ? "rgba(255,179,107,0.45)" : "#ffd08a";
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 34);
  g.fill();
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = state === "active" ? "#1b1206" : "#fff3e0";
  g.font = "64px system-ui, sans-serif";
  g.fillText(icon, w / 2, h * 0.38);
  g.font = `600 ${label.length > 12 ? 30 : 36}px system-ui, sans-serif`;
  g.fillText(label, w / 2, h * 0.76);
}

export class Toolbar {
  /** buttons: [{ id, icon, label, press(ctrl), release?(ctrl) }] */
  constructor(camera, buttons) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = "toolbar";
    this.buttons = new Map();
    this.meshes = [];
    const total = buttons.length * BW + (buttons.length - 1) * GAP;
    buttons.forEach((b, i) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 360, height: 204 });
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(BW, BH),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
      );
      mesh.renderOrder = 20; // always readable, even inside a world
      mesh.position.x = -total / 2 + BW / 2 + i * (BW + GAP);
      mesh.userData.button = b.id;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.buttons.set(b.id, { ...b, canvas, tex, mesh, state: "idle", hovered: false });
      this._draw(b.id);
    });
    this.anchor = new THREE.Vector3();
    this.placed = false;
  }

  set(id, patch) {
    const b = this.buttons.get(id);
    if (!b) return;
    const changed = Object.entries(patch).some(([k, v]) => b[k] !== v);
    if (!changed) return;
    Object.assign(b, patch);
    this._draw(id);
  }

  _draw(id) {
    const b = this.buttons.get(id);
    const state = b.state !== "idle" ? b.state : b.hovered ? "hover" : "idle";
    drawButton(b.canvas, { icon: b.icon, label: b.label, state });
    b.tex.needsUpdate = true;
  }

  hover(meshes) {
    for (const [id, b] of this.buttons) this.set(id, { hovered: meshes.includes(b.mesh) });
  }

  press(id, ctrl) {
    this.buttons.get(id)?.press?.(ctrl);
  }

  release(id, ctrl) {
    this.buttons.get(id)?.release?.(ctrl);
  }

  // Bring it back in front of you now.
  recenter() {
    this.placed = false;
  }

  update() {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) return;
    fwd.normalize();
    // Where it wants to be: 55 cm ahead, 40 cm below your eyes, tilted toward you.
    const want = eye.clone().addScaledVector(fwd, 0.55);
    want.y -= 0.4;
    const toPanel = this.anchor.clone().sub(eye).setY(0);
    const off = !this.placed || toPanel.length() > 1.0 || toPanel.length() < 0.25 || toPanel.normalize().dot(fwd) < 0.55;
    if (off) this.target = want;
    if (this.target) {
      this.anchor.lerp(this.target, this.placed ? 0.08 : 1);
      if (this.anchor.distanceTo(this.target) < 0.01) this.target = null;
      this.placed = true;
    }
    this.group.position.copy(this.anchor);
    this.group.lookAt(eye.x, this.anchor.y, eye.z);
    this.group.rotateX(-0.45);
  }
}
