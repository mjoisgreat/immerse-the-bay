// Small helpers for Vercel Node functions.
export async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === "object") return req.body; // already-parsed JSON
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const b = await readBody(req);
  if (Buffer.isBuffer(b)) return b.length ? JSON.parse(b.toString("utf8")) : {};
  if (typeof b === "string") return JSON.parse(b);
  return b;
}

export function fail(res, e) {
  res.status(e.status || 500).json({ error: e.message || "error" });
}

export function onlyPost(req, res) {
  if (req.method === "POST") return true;
  res.status(405).json({ error: "POST only" });
  return false;
}
