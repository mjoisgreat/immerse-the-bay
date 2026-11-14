import { endOrbisSession } from "../server/services.js";
import { fail, onlyPost, readJson } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    const { sessionId, jwt } = await readJson(req);
    await endOrbisSession(sessionId, jwt);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
}
