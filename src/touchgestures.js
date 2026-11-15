// Touch gestures on a phone or tablet: the headset's hand gestures, done with fingers.
//
//   tap                      → onTap (after a short wait, so it can't be the first half of a double tap)
//   double tap               → onDoubleTap
//   press and hold, then move → onHoldStart, onHoldMove..., onHoldEnd (move a window, or draw one)
//   quick flick up           → onFlick
//   two fingers apart/together → onPinchStart, onPinch(ratio)..., onPinchEnd(ratio)
//   two-finger tap           → onTwoFingerTap
//
// While one of these is in progress `busy` is true, so the page's own one-finger handling (drag to
// look around, tap to open or touch) stays out of the way. Only touch input is handled here: the
// mouse keeps its desktop behaviour. Pure DOM-free logic: feed it pointer-like events and a clock.

export const HOLD_MS = 420; // press this long without moving to pick up / start drawing
export const MOVE_TOL = 10; // px a finger may drift and still count as still
export const DOUBLE_MS = 300; // max gap between the two taps of a double tap
export const FLICK_MS = 260, FLICK_PX = 90; // a flick: this far up, this fast

export class TouchGestureRecognizer {
  // (Timers wrapped: a browser's setTimeout called as this object's method throws "Illegal invocation".)
  constructor(handlers = {}, { now = () => performance.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this.h = handlers;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pts = new Map(); // pointerId → { x, y, x0, y0, t0 }
    this.mode = null; // null | "one" | "hold" | "pinch" | "done" | "skip"
    this.holdTimer = null;
    this.tapTimer = null;
    this.lastTap = null; // { x, y, t }
    this.pinch = null;
  }

  get busy() {
    return this.mode === "hold" || this.mode === "pinch" || this.mode === "done";
  }

  _call(name, ...args) {
    return this.h[name]?.(...args);
  }

  down(e) {
    if (e.pointerType !== "touch") return;
    const t = this.now();
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: t });
    if (this.pts.size === 1) {
      // A finger on something the page handles itself (Bonnie: pick up and throw) is left alone.
      if (this._call("claims", e.clientX, e.clientY)) return void (this.mode = "skip");
      this.mode = "one";
      this.clearTimer(this.holdTimer);
      this.holdTimer = this.setTimer(() => this._hold(e.pointerId), HOLD_MS);
    } else if (this.pts.size === 2 && this.mode !== "skip") {
      this.clearTimer(this.holdTimer);
      if (this.mode === "hold") this._call("onHoldEnd", null, true); // second finger cancels a hold
      const [a, b] = [...this.pts.values()];
      this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), t0: t, ratio: 1, moved: 0, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], a: [a.x, a.y], b: [b.x, b.y] };
      this.mode = "pinch";
      this._call("onPinchStart", this.pinch.mid, this.pinch.a, this.pinch.b);
    }
  }

  _hold(id) {
    const p = this.pts.get(id);
    if (this.mode !== "one" || !p || this.pts.size !== 1) return;
    if (this._call("onHoldStart", p.x, p.y) === false) return; // nothing to hold there: keep it a look-drag
    this.mode = "hold";
  }

  move(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.mode === "one" && Math.hypot(p.x - p.x0, p.y - p.y0) > MOVE_TOL) this.clearTimer(this.holdTimer);
    else if (this.mode === "hold") this._call("onHoldMove", p.x, p.y);
    else if (this.mode === "pinch" && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinch.ratio = d / this.pinch.d0;
      this.pinch.moved = Math.max(this.pinch.moved, ...[a, b].map((q) => Math.hypot(q.x - q.x0, q.y - q.y0)));
      this._call("onPinch", this.pinch.ratio, [(a.x + b.x) / 2, (a.y + b.y) / 2]);
    }
  }

  up(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    if (Number.isFinite(e.clientX)) (p.x = e.clientX), (p.y = e.clientY); // where it lifted
    this.pts.delete(e.pointerId);
    const t = this.now();
    const cancelled = e.type === "pointercancel";
    if (this.mode === "skip") {
      if (!this.pts.size) this.mode = null;
      return;
    }
    if (this.mode === "hold") {
      this._call("onHoldEnd", [p.x, p.y], cancelled);
      this.mode = this.pts.size ? "done" : null;
      return;
    }
    if (this.mode === "pinch") {
      const pi = this.pinch;
      if (pi.moved < MOVE_TOL * 1.5 && t - pi.t0 < 300) this._call("onTwoFingerTap");
      else this._call("onPinchEnd", pi.ratio, cancelled);
      this.mode = this.pts.size ? "done" : null;
      return;
    }
    if (this.mode === "done") {
      if (!this.pts.size) this.mode = null;
      return;
    }
    // One finger, no hold.
    this.clearTimer(this.holdTimer);
    this.mode = null;
    if (cancelled) return;
    const dx = p.x - p.x0, dy = p.y - p.y0, dt = t - p.t0;
    if (dt < FLICK_MS && -dy > FLICK_PX && Math.abs(dx) < -dy * 0.6) {
      this.lastTap = null;
      return void this._call("onFlick", "up", p.x0, p.y0);
    }
    if (Math.hypot(dx, dy) > MOVE_TOL) return; // it was a look-around drag
    const lt = this.lastTap;
    if (lt && t - lt.t < DOUBLE_MS && Math.hypot(p.x - lt.x, p.y - lt.y) < 40) {
      this.clearTimer(this.tapTimer);
      this.lastTap = null;
      return void this._call("onDoubleTap", p.x, p.y);
    }
    this.lastTap = { x: p.x, y: p.y, t };
    this.clearTimer(this.tapTimer);
    const x = p.x, y = p.y;
    this.tapTimer = this.setTimer(() => {
      this.lastTap = null;
      this._call("onTap", x, y);
    }, DOUBLE_MS);
  }
}
