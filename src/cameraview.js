import * as THREE from "three";

// "Camera" mode for phones and computers: the device's camera fills the background, like the Quest's
// see-through view, and the windows float over it. On a phone it uses the back camera and turning the
// phone turns your view (device orientation); on a computer it's the webcam, mirrored like a selfie view.
// (Android Chrome can also do the real thing, WebXR AR, from the Enter button; this works everywhere.)

const zee = new THREE.Vector3(0, 0, 1);
const backOfDevice = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // look out of the back, not the top
const tmpEuler = new THREE.Euler();
const tmpQ = new THREE.Quaternion();

/** Device orientation (degrees) and screen angle to a camera rotation (the standard W3C mapping). */
function orientationQuaternion(out, alpha, beta, gamma, screenDeg) {
  const d = THREE.MathUtils.DEG2RAD;
  tmpEuler.set(beta * d, alpha * d, -gamma * d, "YXZ");
  out.setFromEuler(tmpEuler);
  out.multiply(backOfDevice);
  out.multiply(tmpQ.setFromAxisAngle(zee, -screenDeg * d));
  return out;
}
const headingOf = (q) => new THREE.Euler().setFromQuaternion(q, "YXZ").y;

export class CameraView {
  constructor() {
    this.on = false;
    this._starting = false;
    this._stopRequested = false;
    this.texture = null;
    this.video = null;
    this.mirrored = false;
    this.orienting = false; // the phone's motion drives the view
    this.offset = 0; // extra yaw: keeps what was in front when you started in front, and lets you drag to adjust
    this._needOffset = true;
    this._q = new THREE.Quaternion();
    this._yawQ = new THREE.Quaternion();
    this._last = null;
    this._onOrient = (e) => {
      if (e.alpha == null) return;
      this._last = e;
    };
    this.fit = this.fit.bind(this);
  }

  static get touch() {
    return matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  }

  /** Turn it on (call from a tap or click: iPhones only ask for motion access inside one). */
  async start() {
    if (this.on || this._starting) return;
    this._starting = true;
    this._stopRequested = false;
    try {
      await this._start();
    } finally {
      this._starting = false;
    }
  }

  async _start() {
    // Ask for motion first, while the tap still counts as a user gesture (iOS).
    let motion = false;
    if (CameraView.touch && typeof DeviceOrientationEvent !== "undefined") {
      try {
        motion = typeof DeviceOrientationEvent.requestPermission === "function" ? (await DeviceOrientationEvent.requestPermission()) === "granted" : true;
      } catch {
        motion = false;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't share its camera here (it needs https).");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    if (this._stopRequested) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true, autoplay: true });
    video.setAttribute("playsinline", "");
    // Don't wait on play(): for a video that isn't on the page, browsers may hold playback back while
    // the page is busy (after loading a 3D world, say) and the promise never settles, which left the
    // camera stuck "starting" forever. The picture appears as soon as frames arrive; try again once data is in.
    video.play().catch(() => {});
    video.addEventListener("loadeddata", () => video.paused && video.play().catch(() => {}), { once: true });
    const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    // A laptop webcam usually reports nothing: it faces you, so mirror it like a mirror.
    this.mirrored = facing !== "environment" && !(CameraView.touch && facing == null);
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.matrixAutoUpdate = true;
    this.video = video;
    this.texture = tex;
    this.on = true;
    video.addEventListener("loadedmetadata", this.fit);
    addEventListener("resize", this.fit);
    this.fit();
    if (motion) {
      this.orienting = true;
      this._needOffset = true;
      this._last = null;
      addEventListener("deviceorientation", this._onOrient);
    }
  }

  stop() {
    if (this._starting) this._stopRequested = true;
    if (!this.on) return;
    this.on = false;
    this.orienting = false;
    removeEventListener("deviceorientation", this._onOrient);
    removeEventListener("resize", this.fit);
    this.video?.removeEventListener("loadedmetadata", this.fit);
    this.video?.pause();
    this.video?.srcObject?.getTracks().forEach((t) => t.stop());
    this.texture?.dispose();
    this.texture = this.video = null;
  }

  /** Fill the screen without stretching (crop the overflow), mirrored for a front camera. */
  fit() {
    const t = this.texture, v = this.video;
    if (!t || !v?.videoWidth) return;
    const screen = innerWidth / innerHeight, pic = v.videoWidth / v.videoHeight;
    let rx = 1, ry = 1;
    if (pic > screen) rx = screen / pic;
    else ry = pic / screen;
    t.repeat.set(this.mirrored ? -rx : rx, ry);
    t.offset.set(this.mirrored ? (1 + rx) / 2 : (1 - rx) / 2, (1 - ry) / 2);
  }

  /** Every frame: point `camera` the way the phone points. Returns true when it did. */
  update(camera, currentYaw) {
    if (!this.orienting || !this._last) return false;
    const e = this._last;
    const screenDeg = screen.orientation?.angle ?? globalThis.orientation ?? 0;
    orientationQuaternion(this._q, e.alpha, e.beta, e.gamma, screenDeg);
    if (this._needOffset) {
      // Start facing the way you were already looking, so the windows stay in front of you.
      this.offset = currentYaw - headingOf(this._q);
      this._needOffset = false;
    }
    this._yawQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.offset);
    camera.quaternion.copy(this._yawQ).multiply(this._q);
    return true;
  }
}

export { headingOf };
