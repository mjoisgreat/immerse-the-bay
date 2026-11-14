// Where to open the live connection. Locally it's this host; when deployed on
// Firebase Hosting (which can't proxy WebSockets) the server tells us its Cloud Run URL.
let cached;
export async function wsUrl() {
  if (cached) return cached;
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  cached = cfg.wsUrl || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  return cached;
}
