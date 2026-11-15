// Who this browser is, per room. Secrets stay in this browser's localStorage.
const LS = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const params = new URLSearchParams(location.search);
/** Escapes user text for innerHTML (attributes must be double-quoted). */
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const cleanRoom = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
export const urlRoom = cleanRoom(params.get("room"));
export const urlInvite = (params.get("invite") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes (0/O, 1/I/L)
function randomCode(n, alphabet = ALPHA) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => alphabet[x % alphabet.length]).join("");
}
const WORDS1 = ["amber", "misty", "velvet", "silver", "golden", "quiet", "paper", "lunar", "coral", "hollow", "wild", "sleepy", "cobalt", "ember", "lantern"];
const WORDS2 = ["fox", "harbor", "forest", "comet", "lantern", "meadow", "island", "owl", "river", "tower", "garden", "whale", "canyon", "kite", "moth"];
const pick = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];

/** A friendly, hard-to-guess-by-accident room code like "amber-fox-42". */
export const newRoomCode = () => `${pick(WORDS1)}-${pick(WORDS2)}-${10 + (crypto.getRandomValues(new Uint8Array(1))[0] % 90)}`;

/** Secrets this browser will use to claim (own) a room. */
export function makeOwnerCreds(room) {
  const creds = { key: randomCode(32), pin: randomCode(6), invite: randomCode(10) };
  saveOwned(room, creds);
  return creds;
}

export const owned = () => LS.get("lw:owned", {});
function saveOwned(room, creds) {
  LS.set("lw:owned", { ...owned(), [room]: creds });
  LS.set("lw:lastRoom", room);
}
export const lastOwnedRoom = () => {
  const r = LS.get("lw:lastRoom", "");
  return owned()[r] ? r : "";
};

export const consolePins = () => LS.get("lw:pins", {});
export function savePin(room, pin) {
  LS.set("lw:pins", { ...consolePins(), [room]: pin });
}

/** Credentials this browser holds for a room (strongest first). */
export function credFor(room) {
  const o = owned()[room];
  if (o) return { key: o.key, pin: o.pin, invite: o.invite };
  const pin = consolePins()[room];
  if (pin) return { pin };
  if (urlInvite) return { invite: urlInvite };
  return {};
}

/** Anonymous id for suggestions and votes. */
export const voterId = (() => {
  let v = LS.get("lw:voter", "");
  if (!v) LS.set("lw:voter", (v = randomCode(12)));
  return v;
})();
