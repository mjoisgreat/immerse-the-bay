// Main-thread live depth: captures the active video at a low rate, runs it through the worker and keeps
// one Uint8 depth DataTexture per video (255 = near). Any failure leaves status "failed"; the app stays flat.
import * as THREE from "three";
import { RangeTracker, percentileRange, encodeDepth } from "./depthmath.js";

const FRESH_MS = 700;

export class DepthEstimator extends EventTarget {
  constructor({ width = 252, height = 140, hz = 10 } = {}) {
    super();
    this.width = width; this.height = height; this.hz = hz;
    this.backend = null; this.lastMs = 0;
    this._status = "idle"; this._enabled = true;
    this.worker = null; this.busy = false; this.nextId = 1; this.lastSent = 0;
    this.active = null;
    this.states = new Map(); // video -> { texture, data, prev, tracker, at }
  }

  get status() { return this._status; }
  _setStatus(s) { if (s !== this._status) { this._status = s; this.dispatchEvent(new Event("status")); } }

  get enabled() { return this._enabled; }
  set enabled(v) { this._enabled = !!v; }

  textureFor(video) {
    let s = this.states.get(video);
    if (!s) {
      const data = new Uint8Array(this.width * this.height);
      const texture = new THREE.DataTexture(data, this.width, this.height, THREE.RedFormat, THREE.UnsignedByteType);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      s = { texture, data, prev: null, tracker: new RangeTracker(), at: -Infinity };
      this.states.set(video, s);
    }
    return s.texture;
  }

  isFresh(video) {
    const s = this.states.get(video);
    return !!(this._enabled && s && performance.now() - s.at < FRESH_MS);
  }

  /** Start loading the model ahead of time, so depth is ready the moment it's needed. */
  warm() {
    if (this._enabled && this._status === "idle") this._load();
  }

  setActive(video) {
    this.active = video || null;
    if (this.active && this._enabled && this._status === "idle") this._load();
  }

  release(video) {
    if (this.pending?.video === video) this.pending = null; // drop a result still in flight
    const s = this.states.get(video);
    if (!s) return;
    s.texture.dispose();
    this.states.delete(video);
    if (this.active === video) this.active = null;
  }

  _load() {
    try {
      this._setStatus("loading");
      this.worker = new Worker(new URL("./depth.worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => this._onMessage(e.data);
      this.worker.onerror = () => this._fail();
      this.worker.postMessage({ type: "init", width: this.width, height: this.height });
    } catch { this._fail(); }
  }

  _fail() {
    this._setStatus("failed");
    this.busy = false;
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
  }

  _onMessage(m) {
    if (m.type === "ready") { this.backend = m.backend; this._setStatus("ready"); }
    else if (m.type === "failed") this._fail();
    else if (m.type === "depth") {
      this.busy = false;
      this.lastMs = m.ms;
      const video = this.pending?.id === m.id ? this.pending.video : null; // tagged: write to the video it came from
      this.pending = null;
      if (video) this.textureFor(video); // first result for this video: make its texture now
      const s = video && this.states.get(video);
      if (!s || m.width !== this.width || m.height !== this.height) return;
      const { min, max } = percentileRange(m.data);
      const range = s.tracker.update(min, max);
      const first = !s.prev;
      if (first) s.prev = new Uint8Array(s.data.length);
      encodeDepth(m.data, this.width, this.height, range, first ? null : s.prev, s.data, 0.5);
      s.prev.set(s.data);
      s.texture.needsUpdate = true;
      s.at = performance.now();
    }
  }

  update() {
    try {
      const v = this.active;
      if (!this._enabled || this._status !== "ready" || this.busy || !v || v.readyState < 2) return;
      const now = performance.now();
      if (now - this.lastSent < 1000 / this.hz) return;
      this.lastSent = now;
      this.busy = true;
      const id = this.nextId++;
      this.pending = { id, video: v };
      createImageBitmap(v, { resizeWidth: this.width, resizeHeight: this.height, resizeQuality: "low" })
        .then((bitmap) => {
          if (!this.worker) return bitmap.close();
          this.worker.postMessage({ type: "frame", id, bitmap }, [bitmap]);
        })
        .catch(() => { this.busy = false; this.pending = null; }); // transient capture failure (e.g. tainted/not ready): retry next tick
    } catch { this._fail(); }
  }

  dispose() {
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    for (const v of [...this.states.keys()]) this.release(v);
    this.active = null;
    this._setStatus("idle");
  }
}
