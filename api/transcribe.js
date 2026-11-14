import { transcribe } from "../server/services.js";
import { fail, onlyPost, readBody } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    const pcm = await readBody(req);
    if (!Buffer.isBuffer(pcm) || pcm.length > 8 * 1024 * 1024) return res.status(400).json({ error: "bad audio" });
    res.json({ text: await transcribe(pcm) });
  } catch (e) {
    fail(res, e);
  }
}
