import * as THREE from "three";

// The "how do I do things with my hands" card shown at the start of a headset session: one row per
// action, with the gesture that does it. Pinch the card (or wait) to dismiss it.

/** [icon, action, gesture]. `name` is the companion's name. */
export function gestureRows(name = "Bonnie") {
  return [
    ["🎙", "Talk", "Raise a hand to your mouth like a microphone; lower it to send"],
    ["＋", "Open a window", "Pinch at a wall or empty space"],
    ["✋", "Move a window", "Pinch it and drag"],
    ["↔", "Resize a window", "Pinch it with both hands, then move your hands apart or together"],
    ["🤲", `Pick up a window or ${name}`, "Pinch it with both hands and carry it; let go to drop (or throw)"],
    ["🚪", "Step inside", "Part both hands like curtains"],
    ["↩", "Step back out", "Bring both hands together"],
    ["✕", "Close a window", "Shake both hands, like wiping it away"],
    ["👆", `Call ${name}`, "Snap your fingers"],
    ["☰", "Show / hide the buttons", "Turn your left palm toward your face and hold"],
  ];
}

const W = 1100, ROW = 92, HEAD = 120, FOOT = 78;

export class GestureCard {
  constructor(name) {
    this.rows = gestureRows(name);
    const canvas = Object.assign(document.createElement("canvas"), { width: W, height: HEAD + this.rows.length * ROW + FOOT });
    this._draw(canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const width = 0.95;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * canvas.height) / canvas.width),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    this.mesh.renderOrder = 30;
    this.mesh.userData.gestureCard = true;
    this.mesh.visible = false;
  }

  _draw(canvas) {
    const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
    g.fillStyle = "rgba(14,18,32,0.93)";
    g.strokeStyle = "rgba(255,179,107,0.7)";
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 40);
    g.fill();
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillStyle = "#ffd08a";
    g.font = "700 46px Georgia, serif";
    g.fillText("Your hands are the controls", w / 2, HEAD / 2 + 6);
    this.rows.forEach(([icon, action, how], i) => {
      const y = HEAD + i * ROW + ROW / 2;
      if (i % 2 === 0) {
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.fillRect(24, y - ROW / 2 + 4, w - 48, ROW - 8);
      }
      g.textAlign = "center";
      g.fillStyle = "#fff3e0";
      g.font = "46px system-ui, sans-serif";
      g.fillText(icon, 72, y + 2);
      g.textAlign = "left";
      g.fillStyle = "#ffb36b";
      g.font = "700 30px system-ui, sans-serif";
      g.fillText(action, 130, y - 17, w - 170);
      g.fillStyle = "#fff3e0";
      g.font = "500 26px system-ui, sans-serif";
      g.fillText(how, 130, y + 20, w - 170);
    });
    g.textAlign = "center";
    g.fillStyle = "#a9b0c6";
    g.font = "italic 28px Georgia, serif";
    g.fillText("Pinch this card to close it", w / 2, h - FOOT / 2);
  }

  get visible() {
    return this.mesh.visible;
  }

  /** Floats it `dist` metres in front of where you are looking (level, facing you). */
  show(camera, dist = 1.05) {
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    this.mesh.position.copy(eye).addScaledVector(fwd, dist);
    this.mesh.position.y = eye.y - 0.05;
    this.mesh.lookAt(eye.x, this.mesh.position.y, eye.z);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}
