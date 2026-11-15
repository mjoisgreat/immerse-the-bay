import * as THREE from "three";

// A floating button panel for the headset. It rests below your gaze, follows you lazily when you
// turn or walk away, and is pressed by pointing (controller trigger or hand pinch).
const BW = 0.135, BH = 0.08, GAP = 0.01;

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

    // "What happens next?" cards in a row above the buttons.
    this.choiceMeshes = [];
    this.choices = [];
    const CW = (total - 2 * GAP) / 3, CH = 0.07;
    for (let i = 0; i < 3; i++) {
      const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 140 });
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(CW, CH),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
      );
      mesh.renderOrder = 20;
      mesh.position.set(-total / 2 + CW / 2 + i * (CW + GAP), BH / 2 + GAP + CH / 2, 0);
      mesh.userData.choice = i;
      mesh.userData.canvas = canvas;
      mesh.userData.tex = tex;
      mesh.visible = false;
      this.group.add(mesh);
      this.choiceMeshes.push(mesh);
    }

    // When hidden, only a small "☰ Buttons" handle remains; point at it to bring them back.
    this.collapsed = false;
    this.handleCanvas = Object.assign(document.createElement("canvas"), { width: 360, height: 110 });
    this.handleTex = new THREE.CanvasTexture(this.handleCanvas);
    this.handleTex.colorSpace = THREE.SRGBColorSpace;
    this.handle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.04),
      new THREE.MeshBasicMaterial({ map: this.handleTex, transparent: true, depthTest: false, opacity: 0.85 }),
    );
    this.handle.renderOrder = 20;
    this.handle.userData.button = "__show";
    this.handle.visible = false;
    this.group.add(this.handle);
    this._drawHandle();
  }

  _drawHandle() {
    const g = this.handleCanvas.getContext("2d"), w = 360, h = 110;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(16,20,34,0.8)";
    g.strokeStyle = "rgba(255,179,107,0.6)";
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(3, 3, w - 6, h - 6, 50);
    g.fill();
    g.stroke();
    g.fillStyle = "#fff3e0";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const n = this.choices.length;
    g.font = "600 40px system-ui, sans-serif";
    g.fillText(n ? `☰  ${n} choices` : "☰  Buttons", w / 2, h / 2 + 2);
    this.handleTex.needsUpdate = true;
  }

  setCollapsed(on) {
    this.collapsed = Boolean(on);
    for (const m of this.meshes) m.visible = !this.collapsed;
    this.choiceMeshes.forEach((m, i) => (m.visible = !this.collapsed && Boolean(this.choices[i])));
    this.handle.visible = this.collapsed;
    this._drawHandle();
  }

  /**
   * Shows up to 3 "what happens next" cards (or hides them with an empty list). Each item is the
   * director's option as a string, or an audience idea as { text, by, votes }.
   */
  setChoices(list) {
    this.choices = list || [];
    this._drawHandle();
    this.choiceMeshes.forEach((m, i) => {
      m.visible = !this.collapsed && Boolean(this.choices[i]);
      m.userData.hovered = false;
      if (m.visible) this._drawChoice(m);
    });
  }

  _drawChoice(m) {
    const item = this.choices[m.userData.choice];
    const crowd = typeof item === "object" && item !== null;
    const text = crowd ? item.text : item;
    const hovered = m.userData.hovered;
    const g = m.userData.canvas.getContext("2d");
    const w = 512, h = 140;
    g.clearRect(0, 0, w, h);
    g.fillStyle = hovered ? "rgba(255,154,90,0.95)" : crowd ? "rgba(20,34,52,0.92)" : "rgba(40,30,60,0.9)";
    g.strokeStyle = "#ffd08a";
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 28);
    g.fill();
    g.stroke();
    // An audience idea carries who suggested it and how many people want it.
    let top = 0;
    if (crowd) {
      g.textBaseline = "middle";
      g.font = "700 26px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillStyle = hovered ? "#1b1206" : "#ffb36b";
      g.fillText((item.by || "A friend").toUpperCase(), 28, 34, w - 150);
      g.textAlign = "right";
      g.fillStyle = hovered ? "#1b1206" : "#ffd08a";
      g.fillText(`▲ ${item.votes ?? 0}`, w - 28, 34);
      top = 26;
    }
    g.fillStyle = hovered ? "#1b1206" : "#fff3e0";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `italic 500 ${crowd ? 30 : 34}px Georgia, serif`;
    const words = String(text || "").split(/\s+/), lines = [];
    let line = "";
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (g.measureText(t).width > w - 50 && line) lines.push(line), (line = wd);
      else line = t;
    }
    lines.push(line);
    const gap = crowd ? 34 : 40;
    lines.slice(0, 2).forEach((l, i, a) => g.fillText(l, w / 2, h / 2 + top / 2 + (i - (a.length - 1) / 2) * gap));
    m.userData.tex.needsUpdate = true;
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
    for (const m of this.choiceMeshes) {
      const h = m.visible && meshes.includes(m);
      if (h !== m.userData.hovered) (m.userData.hovered = h), this._drawChoice(m);
    }
  }

  get targets() {
    if (this.collapsed) return [this.handle];
    return [...this.meshes, ...this.choiceMeshes.filter((m) => m.visible)];
  }

  press(id, ctrl) {
    if (id === "__show") return this.setCollapsed(false);
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
