// Pure depth post-processing (no DOM/three) so it can be unit-tested in Node.

// Robust min/max of a Float32Array: ignores the extreme tails so one outlier pixel can't squash the range.
export function percentileRange(values, lo = 0.02, hi = 0.98) {
  const n = values.length;
  if (!n) return { min: 0, max: 1 };
  const step = Math.max(1, Math.floor(n / 4096)); // subsample: plenty for percentiles
  const s = [];
  for (let i = 0; i < n; i += step) s.push(values[i]);
  s.sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { min: at(lo), max: at(hi) };
}

// Exponentially smoothed range across frames, so the depth scale doesn't pump.
export class RangeTracker {
  constructor() { this.min = null; this.max = null; }
  update(min, max, alpha = 0.15) {
    if (this.min === null) { this.min = min; this.max = max; }
    else { this.min += (min - this.min) * alpha; this.max += (max - this.max) * alpha; }
    return { min: this.min, max: this.max };
  }
  reset() { this.min = this.max = null; }
}

// raw: relative inverse depth (bigger = nearer), row 0 = top. out: Uint8 255 = nearest, rows flipped so
// out row 0 = image bottom (three.js texture with flipY=false sampled at video UVs). Blends with prev.
export function encodeDepth(raw, width, height, range, prev, out, blend = 0.5) {
  const span = Math.max(1e-6, range.max - range.min);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width, dst = y * width;
    for (let x = 0; x < width; x++) {
      const t = (raw[src + x] - range.min) / span;
      let v = (t < 0 ? 0 : t > 1 ? 1 : t) * 255;
      if (prev) v = prev[dst + x] + (v - prev[dst + x]) * blend;
      out[dst + x] = Math.round(v);
    }
  }
  return out;
}
