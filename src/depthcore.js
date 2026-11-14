// Depth Anything V2 Small at a tiny input size. Shared by the worker and the Node check script.
import { AutoModel, Tensor, env } from "@huggingface/transformers";

const MODEL = "onnx-community/depth-anything-v2-small";
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

// Loads on WebGPU (fp16) if possible, else wasm (q8 = model_quantized.onnx). Returns { model, backend }.
export async function loadDepthModel({ cpuDevice = "wasm", webgpu = typeof navigator !== "undefined" && !!navigator.gpu, progress_callback } = {}) {
  if (webgpu) {
    try {
      return { model: await AutoModel.from_pretrained(MODEL, { device: "webgpu", dtype: "fp16", progress_callback }), backend: "webgpu" };
    } catch (e) { console.warn("[depth] webgpu failed, using wasm:", e?.message || e); }
  }
  return { model: await AutoModel.from_pretrained(MODEL, { device: cpuDevice, dtype: "q8", progress_callback }), backend: "wasm" };
}

// RGBA bytes (width*height*4) -> normalised NCHW float tensor. We skip the image processor so the
// input is exactly width x height (multiples of 14) instead of the default 518px.
export function rgbaToTensor(rgba, width, height) {
  const n = width * height, d = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) d[c * n + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return new Tensor("float32", d, [1, 3, height, width]);
}

// Returns Float32Array(width*height) of relative inverse depth (larger = nearer), row 0 = top.
export async function inferDepth(model, rgba, width, height) {
  const { predicted_depth } = await model({ pixel_values: rgbaToTensor(rgba, width, height) });
  const [h, w] = predicted_depth.dims.slice(-2);
  const src = predicted_depth.data;
  const out = new Float32Array(width * height);
  if (w === width && h === height) { out.set(src); return out; }
  // Defensive bilinear resample if the model output differs from the input size.
  for (let y = 0; y < height; y++) {
    const fy = Math.min(h - 1, (y + 0.5) * h / height - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < width; x++) {
      const fx = Math.min(w - 1, (x + 0.5) * w / width - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      out[y * width + x] = (src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx) * (1 - ty) + (src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx) * ty;
    }
  }
  return out;
}
