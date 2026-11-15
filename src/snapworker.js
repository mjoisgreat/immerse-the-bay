// Turns a window's frame into a small JPEG off the main thread, so taking snapshots for watchers never
// stalls a frame on the storyteller's device (in the headset a stalled frame shows as judder).
// In: { id, bitmap: ImageBitmap (already 480x270) }. Out: { id, data: "data:image/jpeg;base64,..." } or { id, error }.
const canvas = new OffscreenCanvas(480, 270);
const g = canvas.getContext("2d");

globalThis.onmessage = async ({ data: { id, bitmap } }) => {
  try {
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) (canvas.width = bitmap.width), (canvas.height = bitmap.height);
    g.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.62 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    globalThis.postMessage({ id, data: `data:image/jpeg;base64,${btoa(bin)}` });
  } catch (e) {
    globalThis.postMessage({ id, error: String(e?.message || e) });
  }
};
