import { mintOrbisToken } from "../server/services.js";
import { fail, onlyPost } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ jwt: await mintOrbisToken() });
  } catch (e) {
    fail(res, e);
  }
}
