import * as THREE from "three";

// The menu: one small button that rests in the lower left of your view, like the casting symbol. It
// holds still while you look around inside a small dead zone, and glides to its spot again once you
// look beyond it. Point at it (controller ray or a hand pinch) to open a short list of what you can
// do right now. The list depends on where you are, so main.js passes it in: see menuFor().
// Sizes in metres. The button is the anchor; the list rises above it.
const MW = 0.05, MH = 0.05; // the button: a small circle you can still aim at with a controller ray or a pinch
const RW = 0.25, RH = 0.042, RG = 0.008; // list rows, stacked above the button
const CW_TOTAL = 0.9, CH = 0.075, GAP = 0.01; // "what happens next" cards, above the button while the list is shut
const DIST = 0.7; // it rests this far ahead of you...
const LEFT = 0.2, DROP = 0.16; // ...this far to the left of your gaze and this far below it
const DEAD = 0.45; // radians (about 26°): while you look within this, it stays still
const GLIDE = 0.04; // how far it closes the gap to its spot each frame (smaller = slower)
const MENU = "__menu";

/**
 * The list's entries for where you are. Pure, so it can be tested without a headset.
 *   inside:   you're stepped inside a window
 *   world:    "stanford" or "moon" when that world is on, else null
 *   loading:  a world is still loading (its entry glows)
 *   armed:    "reset" when Reset is waiting for its second tap
 * Returns [{ id, icon, label, state? }]; main.js attaches what each one does.
 */
export function menuFor({ inside = false, world = null, loading = false, armed = null, wideOn = false, cameraOn = false, shared = false } = {}) {
  if (inside) {
    return [
      { id: "exitwin", icon: "↩", label: "Exit window" },
      resetEntry(armed),
      { id: "cheat", icon: "?", label: "Cheat sheet" },
      { id: "exitvr", icon: "⏏", label: "Exit VR" },
    ];
  }
  // Each world has one entry: enter it from your room, or exit it while you are in it. From one world you
  // can also enter the other, so Stanford and Moon always show one of each.
  const state = loading ? "active" : "idle";
  const stanford = world === "stanford"
    ? { id: "exit-stanford", icon: "↩", label: "Exit Stanford" }
    : { id: "stanford", icon: "🏛", label: "Stanford", state };
  const moon = world === "moon"
    ? { id: "exit-moon", icon: "↩", label: "Exit Moon" }
    : { id: "moon", icon: "🌙", label: "Moon", state };
  const wide = { id: "wide", icon: "🔭", label: wideOn ? "Wide: on" : "Wide view" };
  // Share to the community page: anyone can watch, suggest and vote. Lit while it's on.
  const share = { id: "share", icon: "🌐", label: shared ? "Shared: on" : "Share story", state: shared ? "active" : "idle" };
  return [
    resetEntry(armed),
    stanford,
    moon,
    wide,
    share,
    { id: "invite", icon: "👥", label: "Invite friends" },
    { id: "cheat", icon: "?", label: "Cheat sheet" },
    { id: "exitvr", icon: "⏏", label: "Exit VR" },
  ];
}

function resetEntry(armed) {
  const confirm = armed === "reset";
  return { id: "reset", icon: "↺", label: confirm ? "Tap to confirm" : "Reset", state: confirm ? "warn" : "idle" };
}

function drawEntry(canvas, { icon, label, state }) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const fill = { idle: "rgba(16,20,34,0.86)", hover: "rgba(52,44,36,0.95)", active: "#ff9a5a", warn: "#c8483a" }[state];
  g.fillStyle = fill;
  g.strokeStyle = state === "idle" ? "rgba(255,179,107,0.45)" : "#ffd08a";
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, (h - 8) / 2);
  g.fill();
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = state === "active" ? "#1b1206" : "#fff3e0";
  g.font = `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
  g.fillText(label ? `${icon}  ${label}` : icon, w / 2, h / 2 + 2, w - 36);
}

function texturedPlane(w, h, canvas, renderOrder = 20) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.renderOrder = renderOrder; // always readable, even inside a world
  return { mesh, tex };
}

export class Toolbar {
  /** The group goes in the scene; update() places it in your view. */
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = "menu";
    this.anchor = new THREE.Vector3(); // where the button rests, in the world
    this.target = null; // where it is gliding to, when it has been moved
    this.dir = new THREE.Vector3(); // the gaze direction its dead zone is centred on
    this.placed = false;
    this.settle = 0; // frames left to snap into place after a session starts

    this.open = false;
    this._sig = "";

    // The button itself.
    this.buttonCanvas = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
    this.buttonHover = false;
    const button = texturedPlane(MW, MH, this.buttonCanvas);
    this.button = button.mesh;
    this.button.position.set(0, 0, 0);
    this.button.userData.button = MENU;
    this.buttonTex = button.tex;
    this.group.add(this.button);
    this._drawButton();

    // A dot where your pointing ray lands on the menu, so you can see what you are aiming at (as in other headset apps).
    this.cursor = new THREE.Mesh(
      new THREE.CircleGeometry(0.0065, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3e0, transparent: true, depthTest: false }),
    );
    this.cursor.renderOrder = 30;
    this.cursor.visible = false;
    this.group.add(this.cursor);

    // The list, stacked above the button. Rows are made as the list needs them (see setItems).
    this.rows = [];

    // "What happens next?" cards in a row above the button. They step aside while the list is open.
    this.choiceMeshes = [];
    this.choices = [];
    const CW = (CW_TOTAL - 2 * GAP) / 3;
    for (let i = 0; i < 3; i++) {
      const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 140 });
      const { mesh, tex } = texturedPlane(CW, CH, canvas);
      mesh.position.set(-CW_TOTAL / 2 + CW / 2 + i * (CW + GAP), MH / 2 + GAP + CH / 2, 0);
      mesh.userData.choice = i;
      mesh.userData.canvas = canvas;
      mesh.userData.tex = tex;
      mesh.userData.hovered = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.choiceMeshes.push(mesh);
    }
    this._layout();
  }

  _drawButton() {
    // A round button: the same colours as the list rows, with the ☰ icon centred.
    const canvas = this.buttonCanvas, g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, r = w / 2 - 6;
    const hover = this.buttonHover;
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    g.fillStyle = hover ? "rgba(52,44,36,0.95)" : "rgba(16,20,34,0.86)";
    g.fill();
    g.strokeStyle = hover ? "#ffd08a" : "rgba(255,179,107,0.45)";
    g.lineWidth = 5;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff3e0";
    g.font = `600 ${Math.round(h * 0.45)}px system-ui, sans-serif`;
    g.fillText("☰", w / 2, h / 2 + 2);
    this.buttonTex.needsUpdate = true;
  }

  /** Makes one more list row, stacked above the rows before it. */
  _addRow(i) {
    const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 86 });
    const { mesh, tex } = texturedPlane(RW, RH, canvas);
    mesh.position.set(0, MH / 2 + RG + RH / 2 + i * (RH + RG), 0);
    mesh.visible = false;
    this.group.add(mesh);
    this.rows.push({ canvas, tex, mesh, item: null, hovered: false });
  }

  _drawRow(row) {
    if (!row.item) return;
    const state = row.item.state && row.item.state !== "idle" ? row.item.state : row.hovered ? "hover" : "idle";
    drawEntry(row.canvas, { ...row.item, state });
    row.tex.needsUpdate = true;
  }

  /** Sets the list's entries. Each row is redrawn only when its text or state changes. */
  setItems(items) {
    if (items === this._items) return; // the same list as last frame: nothing to do (no per-frame garbage)
    this._items = items;
    const sig = JSON.stringify(items.map(({ id, icon, label, state }) => [id, icon, label, state]));
    while (this.rows.length < items.length) this._addRow(this.rows.length);
    this.rows.forEach((row, i) => {
      row.item = items[i] || null;
      row.mesh.userData.button = row.item?.id;
    });
    if (sig !== this._sig) {
      this._sig = sig;
      this.rows.forEach((row) => this._drawRow(row));
      this._layout();
    }
  }

  setOpen(on) {
    this.open = Boolean(on);
    this._layout();
  }

  toggleOpen() {
    this.setOpen(!this.open);
  }

  _layout() {
    this.rows.forEach((row) => (row.mesh.visible = this.open && Boolean(row.item)));
    this.choiceMeshes.forEach((m, i) => (m.visible = !this.open && Boolean(this.choices[i])));
  }

  /**
   * Shows up to 3 "what happens next" cards (or hides them with an empty list). Each item is the
   * director's option as a string, or an audience idea as { text, by, votes, to } (to = the window it will steer, when there are several).
   */
  setChoices(list) {
    this.choices = list || [];
    this.choiceMeshes.forEach((m, i) => {
      m.userData.hovered = false;
      if (this.choices[i]) this._drawChoice(m);
    });
    this._layout();
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
      // With several windows open the card also says which one the idea will steer.
      const right = `▲ ${item.votes ?? 0}`;
      g.fillText((item.by || "A friend").toUpperCase(), 28, 34, w - 80 - g.measureText(right).width);
      g.textAlign = "right";
      g.fillStyle = hovered ? "#1b1206" : "#ffd08a";
      g.fillText(right, w - 28, 34);
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

  /** Highlights whatever the pointing rays are on. */
  hover(meshes) {
    const over = meshes.includes(this.button);
    if (over !== this.buttonHover) (this.buttonHover = over), this._drawButton();
    for (const row of this.rows) {
      const h = row.mesh.visible && meshes.includes(row.mesh);
      if (h !== row.hovered) (row.hovered = h), this._drawRow(row);
    }
    for (const m of this.choiceMeshes) {
      const h = m.visible && meshes.includes(m);
      if (h !== m.userData.hovered) (m.userData.hovered = h), this._drawChoice(m);
    }
  }

  /**
   * The menu part nearest to a point on the menu's face, if that point is within `pad` metres of the part.
   * This is the magnet: a ray that passes close to an item zones in on it.
   */
  nearestPart(p, pad) {
    let best = null, bestD = Infinity;
    for (const m of this.targets) {
      const { width, height } = m.geometry.parameters;
      const dx = Math.max(Math.abs(p.x - m.position.x) - width / 2, 0);
      const dy = Math.max(Math.abs(p.y - m.position.y) - height / 2, 0);
      const d = Math.hypot(dx, dy);
      if (d <= pad && d < bestD) (best = m), (bestD = d);
    }
    return best;
  }

  /** Puts the pointer dot where the ray hits the menu (a world-space point), or hides it when nothing is hit. */
  pointAt(point) {
    this.cursor.visible = Boolean(point);
    if (!point) return;
    const p = this.group.worldToLocal(point.clone());
    this.cursor.position.set(p.x, p.y, 0.002); // just in front of the list
  }

  /** Brings the menu back to its resting place (a new headset session). */
  recenter() {
    this.placed = false;
    this.target = null;
    this.settle = 60; // about a second of frames to snap into place
  }

  /**
   * Places the menu in the lower left of your view. Inside the dead zone it stays where it is. When you
   * look beyond the zone, the zone moves to where you are looking and the menu glides to its spot there.
   */
  update() {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const q = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const want = eye.clone().addScaledVector(fwd, DIST).addScaledVector(right, -LEFT).addScaledVector(up, -DROP);

    if (!this.placed || this.settle > 0) {
      // The first frames of a session can carry a stale head pose, so keep snapping to the right spot for a moment.
      this.anchor.copy(want);
      this.dir.copy(fwd);
      this.target = null;
      this.placed = true;
      this.settle = Math.max(0, this.settle - 1);
    } else if (fwd.angleTo(this.dir) > DEAD) {
      this.dir.copy(fwd);
      this.target = want;
    }
    if (this.target) {
      this.anchor.lerp(this.target, GLIDE); // a slow glide, so it drifts rather than snaps
      if (this.anchor.distanceTo(this.target) < 0.005) this.target = null;
    }
    this.group.position.copy(this.anchor);
    this.group.quaternion.copy(q); // flat to your view, so it reads straight on
  }

  get targets() {
    return [this.button, ...this.rows.filter((r) => r.mesh.visible).map((r) => r.mesh), ...this.choiceMeshes.filter((m) => m.visible)];
  }

  /**
   * The button opens or shuts the list. An entry runs its action and shuts the list, unless the
   * action returns true (Reset keeps the list open while it waits for its second tap).
   */
  press(id) {
    if (id === MENU) return this.toggleOpen();
    const row = this.rows.find((r) => r.item?.id === id);
    if (!row) return;
    if (!row.item.press?.()) this.setOpen(false);
  }
}
