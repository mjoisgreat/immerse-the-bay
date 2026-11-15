import * as THREE from "three";
import { peopleSummary, personLabel, qrDataUrl } from "./people.js";

// The headset's "Invite friends" card: a QR code a friend scans with their phone, who is here now, and a switch
// for whether joiners may also talk and pick what happens next. Pinch the lower strip to close it.

export const W = 800, H = 1080;
// Tap zones, in canvas pixels measured from the top.
const TOGGLE = { top: 800, bottom: 910 };
const CLOSE = { top: 950 };

/** Which part of the card a pinch landed on: u, v run 0..1 from the bottom-left (a three.js uv). */
export function joinCardHit(u, v) {
  const y = (1 - v) * H;
  if (y >= TOGGLE.top && y <= TOGGLE.bottom && u > 0.08 && u < 0.92) return "toggle";
  if (y >= CLOSE.top) return "close";
  return null;
}

export class JoinCard {
  constructor() {
    this.canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const width = 0.7;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * H) / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }),
    );
    this.mesh.renderOrder = 30;
    this.mesh.userData.joinCard = true;
    this.mesh.visible = false;
    this.info = { url: "", people: [], narrate: false };
    this.qr = null; // { url, img }
    this._draw();
  }

  get visible() {
    return this.mesh.visible;
  }

  /** New link, people or switch: redraw (the QR image is only rebuilt when the link changes). */
  refresh(info) {
    this.info = { ...this.info, ...info };
    this._draw();
    const { url } = this.info;
    if (url && this.qr?.url !== url) {
      this.qr = { url, img: null };
      qrDataUrl(url, 480)
        .then((data) => {
          const img = new Image();
          img.onload = () => {
            if (this.qr?.url === url) (this.qr.img = img), this._draw();
          };
          img.src = data;
        })
        .catch(() => {});
    }
  }

  _draw() {
    const g = this.canvas.getContext("2d");
    const { url, people, narrate } = this.info;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(14,18,32,0.94)";
    g.strokeStyle = "rgba(255,179,107,0.7)";
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 44);
    g.fill();
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffd08a";
    g.font = "700 52px Georgia, serif";
    g.fillText("Invite friends", W / 2, 70);
    // The QR code, on white so a phone camera reads it.
    g.fillStyle = "#fff";
    g.beginPath();
    g.roundRect(150, 130, 500, 500, 24);
    g.fill();
    if (this.qr?.img) g.drawImage(this.qr.img, 160, 140, 480, 480);
    else {
      g.fillStyle = "#555";
      g.font = "500 30px system-ui, sans-serif";
      g.fillText("making the code…", W / 2, 380);
    }
    g.fillStyle = "#fff3e0";
    g.font = "500 28px system-ui, sans-serif";
    g.fillText("Point a phone camera at this", W / 2, 668);
    g.fillStyle = "#a9b0c6";
    g.font = "500 22px system-ui, sans-serif";
    g.fillText(url.replace(/^https?:\/\//, "").replace("&invite=", " + invite=").slice(0, 60), W / 2, 704, W - 80);
    // Who is here.
    const sum = peopleSummary(people);
    g.fillStyle = "#ffb36b";
    g.font = "700 28px system-ui, sans-serif";
    g.fillText(sum ? `Here now: ${sum}` : "Nobody has joined yet", W / 2, 752, W - 80);
    g.fillStyle = "#fff3e0";
    g.font = "500 24px system-ui, sans-serif";
    const shown = (people || []).filter((p) => p.role !== "owner").slice(0, 3);
    g.fillText(shown.map(personLabel).join(" · "), W / 2, 780, W - 80);
    // The switch.
    g.fillStyle = narrate ? "#ff9a5a" : "rgba(255,255,255,0.08)";
    g.strokeStyle = "#ffd08a";
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(70, TOGGLE.top, W - 140, TOGGLE.bottom - TOGGLE.top, 30);
    g.fill();
    g.stroke();
    g.fillStyle = narrate ? "#1b1206" : "#fff3e0";
    g.font = "700 32px system-ui, sans-serif";
    g.fillText(narrate ? "Joiners can talk and choose: ON" : "Joiners can watch and vote", W / 2, TOGGLE.top + 40, W - 180);
    g.font = "500 22px system-ui, sans-serif";
    g.fillText(narrate ? "Pinch to make it watch and vote only" : "Pinch to let them talk and choose too", W / 2, TOGGLE.top + 82, W - 180);
    g.fillStyle = "#a9b0c6";
    g.font = "italic 28px Georgia, serif";
    g.fillText("Pinch here to close", W / 2, (CLOSE.top + H) / 2);
    this.tex.needsUpdate = true;
  }

  /** Floats it in front of where you look (level, facing you). */
  show(camera, dist = 1.0) {
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
