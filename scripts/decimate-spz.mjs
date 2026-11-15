// Makes a lighter copy of a Gaussian-splat world (.spz, version 2 or 3) for weak hardware:
// keeps the splats that cover the most of the picture and grows them a little to close the gaps.
//   node scripts/decimate-spz.mjs public/worlds/stanford.spz public/worlds/stanford-low.spz 0.3
import fs from "node:fs";
import zlib from "node:zlib";

const [src, dst, keepArg = "0.3"] = process.argv.slice(2);
if (!src || !dst) throw new Error("usage: decimate-spz.mjs <in.spz> <out.spz> [fraction to keep]");
const raw = zlib.gunzipSync(fs.readFileSync(src));
if (raw.readUInt32LE(0) !== 0x5053474e) throw new Error("not an .spz file");
const version = raw.readUInt32LE(4), n = raw.readUInt32LE(8), shDegree = raw[12];
if (version !== 2 && version !== 3) throw new Error(`unsupported spz version ${version}`);
const shDim = [0, 3, 8, 15][shDegree] * 3;
// Per-splat arrays, in file order: [bytes per splat].
const sizes = [9, 1, 3, 3, version === 3 ? 4 : 3, shDim];
const offsets = [];
let at = 16;
for (const s of sizes) offsets.push(at), (at += s * n);
if (at !== raw.length) throw new Error(`unexpected length ${raw.length}, expected ${at}`);

const keep = Math.max(1, Math.round(n * Number(keepArg)));
const [, aOff, , sOff] = offsets;
// Importance: opacity times footprint (the two largest axes). Scales are stored as (ln s + 10) * 16.
const score = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const ln = [0, 1, 2].map((k) => raw[sOff + i * 3 + k] / 16 - 10).sort((a, b) => b - a);
  score[i] = (raw[aOff + i] / 255) * Math.exp(ln[0] + ln[1]);
}
const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b] - score[a]).slice(0, keep).sort((a, b) => a - b);

const out = Buffer.alloc(16 + sizes.reduce((sum, s) => sum + s * keep, 0));
raw.copy(out, 0, 0, 16);
out.writeUInt32LE(keep, 8);
const grow = Math.round(Math.log(Math.sqrt(n / keep)) * 0.5 * 16); // part of the lost coverage back
let w = 16;
sizes.forEach((s, k) => {
  for (const i of order) {
    raw.copy(out, w, offsets[k] + i * s, offsets[k] + (i + 1) * s);
    if (k === 3) for (let j = 0; j < 3; j++) out[w + j] = Math.min(255, out[w + j] + grow);
    w += s;
  }
});
fs.writeFileSync(dst, zlib.gzipSync(out, { level: 9 }));
console.log(`${src}: ${n} splats -> ${dst}: ${keep} splats, ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
