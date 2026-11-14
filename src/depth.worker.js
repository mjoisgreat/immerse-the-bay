// Depth worker: loads the model once, then turns ImageBitmap frames into raw relative-depth maps.
import { loadDepthModel, inferDepth } from "./depthcore.js";

let model = null, W = 252, H = 140, canvas = null, ctx = null, busy = false;

self.onmessage = async ({ data: m }) => {
  if (m.type === "init") {
    try {
      W = m.width || W; H = m.height || H;
      canvas = new OffscreenCanvas(W, H);
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      const r = await loadDepthModel();
      model = r.model;
      self.postMessage({ type: "ready", backend: r.backend });
    } catch (e) { self.postMessage({ type: "failed", error: String(e?.message || e) }); }
  } else if (m.type === "frame") {
    const bitmap = m.bitmap;
    if (!model || busy) { bitmap?.close?.(); return; }
    busy = true;
    try {
      const t0 = performance.now();
      ctx.drawImage(bitmap, 0, 0, W, H);
      const data = await inferDepth(model, ctx.getImageData(0, 0, W, H).data, W, H);
      self.postMessage({ type: "depth", id: m.id, width: W, height: H, data, ms: performance.now() - t0 }, [data.buffer]);
    } catch (e) { self.postMessage({ type: "failed", error: String(e?.message || e) }); }
    finally { bitmap.close?.(); busy = false; }
  }
};
