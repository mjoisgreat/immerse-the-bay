import { MAX_PORTALS } from "../server/core.js";

export default function handler(_req, res) {
  const claude = Boolean(process.env.ANTHROPIC_API_KEY);
  res.setHeader("Cache-Control", "no-store");
  res.json({ maxPortals: MAX_PORTALS, director: claude ? "claude" : "template", transport: "poll" });
}
