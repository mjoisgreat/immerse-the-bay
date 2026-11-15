import * as THREE from "three";

// The headset's button panel. It rests below your gaze, follows you lazily when you turn or walk away,
// and is pressed by pointing (controller trigger or hand pinch).
//
// Laid out for comfort and fewer mistakes:
//  - Two rows on a gentle curve around you, so every button faces you and the whole panel fits in a
//    glance (~55° wide) instead of a flat 1.3 m strip that needed a head turn to reach the ends.
//  - Top row: the five things you do all the time, Talk biggest and in the middle (the most used).
//    Bottom row: smaller, less frequent controls; the ones that throw work away (New story, Reset,
//    Close window) sit together at the far end, set apart and tinted red, and ask for a second tap.
//  - Generous gaps so a wobbly pointer doesn't hit the neighbour; a hovered button grows and lights
//    up; a press "clicks" visibly (and main.js adds a tone and a buzz); unavailable actions are dimmed
//    and say why instead of silently doing nothing.

const R = 0.6; // radius of the curve (≈ your distance to the panel)
const ROWS = {
  main: { w: 0.1, h: 0.078, gap: 0.018, y: 0 },
  more: { w: 0.1, h: 0.05, gap: 0.012, y: -0.078 / 2 - 0.022 - 0.05 / 2 },
};
const BIG = { w: 0.13, h: 0.094 }; // the Talk button
const DANGER_GAP = 0.03; // extra space before the red group
const PX_PER_M = 3600; // canvas resolution: crisp text at arm's length

const COLORS = {
  idle: { fill: "rgba(16,20,34,0.9)", line: "rgba(255,179,107,0.42)", text: "#fff3e0" },
  hover: { fill: "rgba(62,48,34,0.97)", line: "#ffd08a", text: "#fff3e0" },
  active: { fill: "#ff9a5a", line: "#ffd08a", text: "#1b1206" },
  warn: { fill: "#c8483a", line: "#ffb0a4", text: "#fff3e0" },
  disabled: { fill: "rgba(16,20,34,0.55)", line: "rgba(255,255,255,0.12)", text: "rgba(255,243,224,0.38)" },
};

function fitFont(g, text, maxW, size, weight = 600) {
  let s = size;
  do g.font = `${weight} ${s}px system-ui, sans-serif`;
  while (g.measureText(text).width > maxW && --s > 12);
  return s;
}

function drawButton(canvas, { icon, label, state, row, danger, big, pressed }) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const c = COLORS[state] ?? COLORS.idle;
  const r = Math.min(w, h) * 0.26;
  g.fillStyle = c.fill;
  g.strokeStyle = danger && state === "idle" ? "rgba(255,120,100,0.6)" : state === "hover" && danger ? "#ff8a7a" : c.line;
  g.lineWidth = state === "hover" || pressed ? 10 : 6;
  g.beginPath();
  g.roundRect(6, 6, w - 12, h - 12, r);
  g.fill();
  g.stroke();
  if (pressed) {
    g.fillStyle = "rgba(255,240,210,0.35)";
    g.fill();
  }
  g.textBaseline = "middle";
  g.fillStyle = c.text;
  if (row === "main") {
    // Icon above, label below.
    g.textAlign = "center";
    g.font = `${Math.round(h * (big ? 0.36 : 0.34))}px system-ui, sans-serif`;
    g.fillText(icon, w / 2, h * 0.39);
    fitFont(g, label, w * 0.88, Math.round(h * 0.17));
    g.fillText(label, w / 2, h * 0.77);
  } else {
    // Small row: icon on the left, label beside it.
    g.textAlign = "left";
    const iconSize = Math.round(h * 0.38);
    g.font = `${iconSize}px system-ui, sans-serif`;
    const iconW = Math.max(g.measureText(icon).width, iconSize * 0.8);
    const x0 = w * 0.07, gap = h * 0.16;
    g.fillText(icon, x0, h * 0.53);
    fitFont(g, label, w - x0 * 2 - iconW - gap, Math.round(h * 0.3));
    g.fillText(label, x0 + iconW + gap, h * 0.53);
  }
}

export class Toolbar {
  /**
   * buttons: [{ id, icon, label, press(ctrl), release?(ctrl), row?: "main" | "more", big?, danger? }]
   * opts.onPress(id, ctrl): feedback for a press (tone, buzz); opts.onDisabled(why): a dimmed button was pressed.
   */
  constructor(camera, buttons, opts = {}) {
    this.camera = camera;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = "toolbar";
    this.buttons = new Map();
    this.meshes = [];

    // Lay each row out along the curve, centred.
    const rowWidth = {};
    for (const row of ["main", "more"]) {
      const list = buttons.filter((b) => (b.row ?? "main") === row);
      const spec = ROWS[row];
      const widths = list.map((b) => (b.big ? BIG.w : spec.w));
      let total = widths.reduce((a, b) => a + b, 0) + spec.gap * Math.max(0, list.length - 1);
      const firstDanger = list.findIndex((b) => b.danger);
      if (firstDanger > 0) total += DANGER_GAP;
      rowWidth[row] = total;
      let s = -total / 2; // arc length from the centre
      list.forEach((b, i) => {
        if (i === firstDanger && i > 0) s += DANGER_GAP;
        const bw = widths[i], bh = b.big ? BIG.h : spec.h;
        const mid = s + bw / 2;
        s += bw + spec.gap;
        const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bw * PX_PER_M), height: Math.round(bh * PX_PER_M) });
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
        mesh.renderOrder = 20; // always readable, even inside a world
        const a = mid / R; // on the curve, turned to face you
        mesh.position.set(R * Math.sin(a), spec.y + (b.big ? (BIG.h - spec.h) / 2 : 0), R * (1 - Math.cos(a)));
        mesh.rotation.y = -a;
        mesh.userData.button = b.id;
        this.group.add(mesh);
        this.meshes.push(mesh);
        this.buttons.set(b.id, { row: "main", ...b, canvas, tex, mesh, state: "idle", hovered: false, disabled: false, why: "", pressedUntil: 0, scale: 1 });
        this._draw(b.id);
      });
    }
    this.width = rowWidth.main;
    this.anchor = new THREE.Vector3();
    this.placed = false;

    // "What happens next?" cards in a row above the buttons.
    this.choiceMeshes = [];
    this.choices = [];
    const CW = (this.width - 2 * 0.012) / 3, CH = 0.072;
    const choiceY = ROWS.main.y + BIG.h - ROWS.main.h / 2 + 0.018 + CH / 2;
    for (let i = 0; i < 3; i++) {
      const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 180 });
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
      mesh.renderOrder = 20;
      const a = (-this.width / 2 + CW / 2 + i * (CW + 0.012)) / R;
      mesh.position.set(R * Math.sin(a), choiceY, R * (1 - Math.cos(a)));
      mesh.rotation.y = -a;
      mesh.userData.choice = i;
      mesh.userData.canvas = canvas;
      mesh.userData.tex = tex;
      mesh.visible = false;
      this.group.add(mesh);
      this.choiceMeshes.push(mesh);
    }

    // When hidden, only a small "☰ Buttons" handle remains; point at it to bring them back.
    this.collapsed = false;
    this.handleCanvas = Object.assign(document.createElement("canvas"), { width: 480, height: 140 });
    this.handleTex = new THREE.CanvasTexture(this.handleCanvas);
    this.handleTex.colorSpace = THREE.SRGBColorSpace;
    this.handle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.044),
      new THREE.MeshBasicMaterial({ map: this.handleTex, transparent: true, depthTest: false, opacity: 0.9 }),
    );
    this.handle.renderOrder = 20;
    this.handle.userData.button = "__show";
    this.handle.visible = false;
    this.handleHovered = false;
    this.group.add(this.handle);
    this._drawHandle();
  }

  _drawHandle() {
    const g = this.handleCanvas.getContext("2d"), w = 480, h = 140;
    g.clearRect(0, 0, w, h);
    g.fillStyle = this.handleHovered ? "rgba(62,48,34,0.97)" : "rgba(16,20,34,0.85)";
    g.strokeStyle = this.handleHovered ? "#ffd08a" : "rgba(255,179,107,0.6)";
    g.lineWidth = this.handleHovered ? 9 : 5;
    g.beginPath();
    g.roundRect(5, 5, w - 10, h - 10, 64);
    g.fill();
    g.stroke();
    g.fillStyle = "#fff3e0";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const n = this.choices.length;
    g.font = "600 50px system-ui, sans-serif";
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
   * director's option as a string, or an audience idea as { text, by, votes, to } (to = the window it will steer, when there are several).
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
    const w = 640, h = 180;
    g.clearRect(0, 0, w, h);
    g.fillStyle = hovered ? "rgba(255,154,90,0.97)" : crowd ? "rgba(20,34,52,0.93)" : "rgba(40,30,60,0.92)";
    g.strokeStyle = "#ffd08a";
    g.lineWidth = hovered ? 9 : 6;
    g.beginPath();
    g.roundRect(5, 5, w - 10, h - 10, 36);
    g.fill();
    g.stroke();
    // An audience idea carries who suggested it and how many people want it.
    let top = 0;
    if (crowd) {
      g.textBaseline = "middle";
      g.font = "700 32px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillStyle = hovered ? "#1b1206" : "#ffb36b";
      // With several windows open the card also says which one the idea will steer.
      const right = `${item.to ? `→ WINDOW ${item.to}   ` : ""}▲ ${item.votes ?? 0}`;
      g.fillText((item.by || "A friend").toUpperCase(), 34, 42, w - 100 - g.measureText(right).width);
      g.textAlign = "right";
      g.fillStyle = hovered ? "#1b1206" : "#ffd08a";
      g.fillText(right, w - 34, 42);
      top = 32;
    }
    g.fillStyle = hovered ? "#1b1206" : "#fff3e0";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `italic 500 ${crowd ? 38 : 43}px Georgia, serif`;
    const words = String(text || "").split(/\s+/), lines = [];
    let line = "";
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (g.measureText(t).width > w - 60 && line) lines.push(line), (line = wd);
      else line = t;
    }
    lines.push(line);
    const gap = crowd ? 42 : 50;
    lines.slice(0, 2).forEach((l, i, a) => g.fillText(l, w / 2, h / 2 + top / 2 + (i - (a.length - 1) / 2) * gap));
    m.userData.tex.needsUpdate = true;
  }

  /** Change a button: { icon, label, state: "idle" | "active" | "warn", disabled, why }. */
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
    const pressed = performance.now() < b.pressedUntil;
    const state = b.disabled ? "disabled" : b.state !== "idle" ? b.state : b.hovered ? "hover" : "idle";
    drawButton(b.canvas, { icon: b.icon, label: b.label, state, row: b.row, danger: b.danger, big: b.big, pressed });
    b.tex.needsUpdate = true;
  }

  /** Which panel parts are pointed at. Returns true when a button (or card) just became hovered. */
  hover(meshes) {
    let entered = false;
    for (const [id, b] of this.buttons) {
      const h = meshes.includes(b.mesh);
      if (h && !b.hovered && !b.disabled) entered = true;
      this.set(id, { hovered: h });
    }
    for (const m of this.choiceMeshes) {
      const h = m.visible && meshes.includes(m);
      if (h && !m.userData.hovered) entered = true;
      if (h !== m.userData.hovered) (m.userData.hovered = h), this._drawChoice(m);
    }
    const hh = this.handle.visible && meshes.includes(this.handle);
    if (hh !== this.handleHovered) {
      if (hh) entered = true;
      this.handleHovered = hh;
      this._drawHandle();
    }
    return entered;
  }

  get targets() {
    if (this.collapsed) return [this.handle];
    return [...this.meshes, ...this.choiceMeshes.filter((m) => m.visible)];
  }

  press(id, ctrl) {
    if (id === "__show") return this.opts.onPress?.(id, ctrl), this.setCollapsed(false);
    const b = this.buttons.get(id);
    if (!b) return;
    if (b.disabled) return void this.opts.onDisabled?.(b.why || "Not available right now.");
    b.pressedUntil = performance.now() + 160; // a visible "click"
    this._draw(id);
    this.opts.onPress?.(id, ctrl);
    b.press?.(ctrl);
  }

  release(id, ctrl) {
    this.buttons.get(id)?.release?.(ctrl);
  }

  // Bring it back in front of you now.
  recenter() {
    this.placed = false;
  }

  update() {
    // Hover grows a button a little; a press dips it, then it springs back.
    const now = performance.now();
    for (const [id, b] of this.buttons) {
      const pressed = now < b.pressedUntil;
      if (!pressed && b._wasPressed) this._draw(id);
      b._wasPressed = pressed;
      const want = pressed ? 0.92 : b.hovered && !b.disabled ? 1.07 : 1;
      b.scale += (want - b.scale) * 0.35;
      b.mesh.scale.setScalar(b.scale);
    }

    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) return;
    fwd.normalize();
    // Where it wants to be: just under arm's length ahead, below your eyes, tilted toward you.
    const want = eye.clone().addScaledVector(fwd, 0.5);
    want.y -= 0.38;
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
    this.group.rotateX(-0.42);
  }
}
