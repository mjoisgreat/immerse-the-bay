// Who is in the room, and how to join it. Pure helpers (so they can be tested without a browser), plus the
// small presence sender every page uses: "here" every ~10 s tells the server this device is still around.

/** "quest" | "phone" | "computer" from what the browser says about itself. Pages that are not the app say so themselves. */
export function deviceKind({ userAgent = "", maxTouchPoints = 0, width = 1200 } = {}) {
  if (/OculusBrowser|Quest/i.test(userAgent)) return "quest";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (maxTouchPoints > 1 && width < 900)) return "phone";
  return "computer";
}
/** This browser's kind. */
export function thisDeviceKind() {
  return deviceKind({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0, width: innerWidth });
}

const WORD = { quest: ["Quest", "Quests"], phone: ["phone", "phones"], computer: ["laptop", "laptops"], screen: ["screen", "screens"] };
const ORDER = ["quest", "phone", "computer", "screen"];
const ARTICLE = { quest: "a Quest", phone: "a phone", computer: "a computer", screen: "a screen" };

/** "Quest · 2 phones · laptop", or "" when nobody is here. */
export function peopleSummary(people) {
  const n = {};
  for (const p of people || []) n[p.kind] = (n[p.kind] || 0) + 1;
  return ORDER.filter((k) => n[k])
    .map((k) => (n[k] === 1 ? WORD[k][0] : `${n[k]} ${WORD[k][1]}`))
    .join(" · ");
}
/** The names to show in a list: the name they gave, else what they are on ("A phone"). */
export function personLabel(p) {
  const base = p.name || (p.role === "owner" ? "The storyteller" : `Someone on ${ARTICLE[p.kind] || "a device"}`);
  return p.name ? `${p.name} (${WORD[p.kind]?.[0] || p.kind})` : base;
}
/** The toast the storyteller sees when someone arrives, or "" for the storyteller's own devices. */
export function joinedLine(e) {
  if (!e || e.role === "owner") return "";
  return `${e.name || "Someone"} joined on ${ARTICLE[e.kind] || "a device"}`;
}

/**
 * The link a friend scans. Audience by default (watch, suggest, vote); with `narrate` it carries the invite
 * code, which also lets them talk and pick what happens next.
 */
export function joinUrl({ origin, room, invite = "", narrate = false }) {
  return `${origin}/watch.html?room=${encodeURIComponent(room)}${narrate && invite ? `&invite=${encodeURIComponent(invite)}` : ""}`;
}

const NARRATE_KEY = "lw:joinNarrate";
export function joinersNarrate() {
  try {
    return localStorage.getItem(NARRATE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setJoinersNarrate(on) {
  try {
    localStorage.setItem(NARRATE_KEY, on ? "1" : "0");
  } catch {}
}

/** The name this browser gives itself (typed on the watch page), if any. */
export function myName() {
  try {
    return localStorage.getItem("lw:name") || "";
  } catch {
    return "";
  }
}
export function setMyName(name) {
  try {
    localStorage.setItem("lw:name", String(name || "").trim().slice(0, 20));
  } catch {}
}

/** A QR code for `text` as a data URL (loaded on demand: most pages never need it). */
export async function qrDataUrl(text, width = 320) {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(text, { margin: 1, width, color: { dark: "#07080d", light: "#ffffff" } });
}

/**
 * Says "here" now, every `every` ms, and whenever the page becomes visible again. `request` sends a message
 * to the room; `kind` and `getName` say who this is. Returns a function that stops it.
 */
export function startPresence(request, { kind, getName = () => "", every = 10_000 } = {}) {
  const ping = () => void request({ t: "here", kind, name: getName() });
  ping();
  const timer = setInterval(() => !document.hidden && ping(), every);
  const onVisible = () => !document.hidden && ping();
  document.addEventListener("visibilitychange", onVisible);
  return () => (clearInterval(timer), document.removeEventListener("visibilitychange", onVisible));
}
