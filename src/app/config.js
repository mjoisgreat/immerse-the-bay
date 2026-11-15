// app/config.js: constants the toolbar and the gesture card need while this app starts up (leaf module).
import { BONNIE_VOICE } from "../lines.js";
export const USE_PIP = new URLSearchParams(location.search).get("companion") === "pip";
export const BUDDY = USE_PIP
  ? { id: "pip", name: "Pip", icon: "🤖", voice: "a small, bright, curious robot companion; quick and playful, warm, a little mischievous" }
  : { id: "bunny", name: "Bonnie", icon: "🐰", voice: BONNIE_VOICE };

// The hub world: the Moon by default. `?backdrop=stanford-church` (Memorial Church, from a 360° video),
// `?backdrop=stanford-golden` (golden-hour Main Quad) or `?backdrop=stanford` (the photo-based one)
// picks a Stanford splat instead (`?world=` works too).
const HUB = (() => {
  const q = new URLSearchParams(location.search);
  const id = q.get("backdrop") || q.get("world");
  return id && id !== "moon" ? id : "moon";
})();
// The world button cycles: your room → the Moon → Stanford's Memorial Church → your room.
// (A world picked in the URL comes first in the cycle.)
export const WORLD_CYCLE = [...new Set([HUB, "moon", "stanford-church"])];
export const worldInfo = (id) =>
  id === "moon"
    ? { label: "Moon", bar: "Moon", icon: "🌕", name: "the Moon", on: "on" }
    : { label: "Stanford", bar: "Stanford Quad", icon: "🏛", name: "Stanford's Main Quad", on: "in" };
