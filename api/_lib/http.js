// Adapter: runs a shared handler (server/api.js) inside a Vercel Node function.
import { redisStore } from "../../server/stores.js";

let storePromise;
const getStore = () => (storePromise ??= redisStore().catch((e) => ((storePromise = undefined), Promise.reject(e))));

export async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === "object") return req.body; // already-parsed JSON
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const b = await readBody(req);
  try {
    if (Buffer.isBuffer(b)) return b.length ? JSON.parse(b.toString("utf8")) : {};
    if (typeof b === "string") return JSON.parse(b);
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
  return b || {};
}

/** routes: { GET?: (req, store) => result, POST?: ... } */
export function route(routes, { needsStore = true } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fn = routes[req.method];
    if (!fn) return res.status(405).json({ error: "method not allowed" });
    try {
      const store = needsStore ? await getStore() : null;
      if (needsStore && !store) return res.status(500).json({ error: "Redis is not configured (add Upstash in Vercel)" });
      const r = await fn(req, store);
      if (r.body === null) return res.status(r.status).end();
      if (Buffer.isBuffer(r.body)) return res.status(r.status).setHeader("Content-Type", r.type || "application/octet-stream").end(r.body);
      res.status(r.status).json(r.body);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || "error" });
    }
  };
}
