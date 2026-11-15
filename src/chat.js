// Shared bits of the Twitch-style audience chat (watch page and director console).
// Kept free of browser-only imports (identity.js reads the page URL): the headset tests load this file in Node.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A steady colour per name, so the same person always looks the same. */
export function hueOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

/** "2:06 PM": the time stamp at the start of a chat line. */
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The most-voted idea, only when it clearly leads (more than one vote and no tie). */
export function topIdeaOf(sug) {
  const byVotes = [...sug].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  const [a, b] = byVotes;
  return a && a.voters.length > 1 && a.voters.length > (b?.voters.length || 0) ? a : null;
}

/**
 * A chat log that sticks to its newest edge like a stream chat: new lines come into view unless the
 * reader has scrolled away to read, in which case the jump button appears instead. Redraws only on
 * change. With `newestFirst` the newest line is at the top (and the log sticks to the top).
 */
export function stickyLog(log, jump, { newestFirst = false } = {}) {
  let html = "", first = true;
  const atEdge = () => (newestFirst ? log.scrollTop < 40 : log.scrollHeight - log.scrollTop - log.clientHeight < 40);
  const toEdge = (behavior) => log.scrollTo({ top: newestFirst ? 0 : log.scrollHeight, behavior });
  if (newestFirst) jump.classList.add("top");
  log.addEventListener("scroll", () => atEdge() && (jump.hidden = true));
  jump.addEventListener("click", () => {
    toEdge("smooth");
    jump.hidden = true;
  });
  return function update(next, { hasNew = false, toBottom = false } = {}) {
    if (next === html) return;
    const stick = first || toBottom || atEdge();
    const keep = log.scrollTop, height = log.scrollHeight;
    log.innerHTML = html = next;
    if (stick) toEdge("instant");
    else {
      // Keep what the reader is looking at in place: with the newest on top, new lines push it down.
      log.scrollTop = newestFirst ? keep + (log.scrollHeight - height) : keep;
      if (hasNew) jump.hidden = false;
    }
    first = false;
  };
}

/** The idea Crowd Mode plays next: the most-voted one, the oldest on a tie (the server's own pick). */
export function nextIdeaOf(sug) {
  return [...sug].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at)[0] || null;
}

/** Seconds left until Crowd Mode plays the next idea (0 once it's due). */
export const secondsLeft = (at) => Math.max(0, Math.ceil((at - Date.now()) / 1000));

/**
 * A Crowd Mode countdown: "⏭ Up next in 7s" with a bar that drains over the round. Markup only; the
 * ticker below keeps every countdown on the page current, so the chat isn't redrawn every second.
 */
export function countdownHtml(s) {
  if (!s.meta?.crowd || !s.crowdAt) return "";
  return `<span class="cd" data-at="${s.crowdAt}" data-from="${s.crowdFrom || s.crowdAt - 10000}"></span>`; // filled in by the ticker
}
export function countdownBar(s) {
  if (!s.meta?.crowd || !s.crowdAt) return "";
  return `<div class="cdbar" data-at="${s.crowdAt}" data-from="${s.crowdFrom || s.crowdAt - 10000}"><i></i></div>`;
}
let ticking = false;
export function startCountdowns() {
  if (ticking) return;
  ticking = true;
  const tick = () => {
    for (const el of document.querySelectorAll(".cd[data-at]")) {
      const left = secondsLeft(Number(el.dataset.at));
      el.textContent = left ? `${left}s` : "now…";
    }
    for (const el of document.querySelectorAll(".cdbar[data-at]")) {
      const at = Number(el.dataset.at), from = Number(el.dataset.from);
      const share = Math.max(0, Math.min(1, (at - Date.now()) / Math.max(1, at - from)));
      el.firstElementChild.style.width = `${(share * 100).toFixed(1)}%`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- The story log as a stream chat (the watch page's story feed and the console's live log) ----------
// Each line gets a time, a badge and a coloured name; the newest is at the top and the log sticks there.
const ROLES = {
  director: { name: "Scene", chip: "🎬", color: "#ffb36b", title: "The scene (what the director narrated)" },
  voice: { name: "Storyteller", chip: "🎥", color: "#ff6b6b", title: "The storyteller (broadcaster)" },
  guest: { name: "Co-narrator", chip: "🎙", color: "#3ddc6a", title: "A co-narrator" },
  crowd: { name: "Crowd", chip: "👥", color: "#bf94ff", title: "The crowd's top idea" },
  choice: { name: "Chosen", chip: "✓", color: "#5cb8ff", title: "A chosen option" },
  touch: { name: "Storyteller", chip: "✋", color: "#ff6b6b", title: "The storyteller touched the world" },
};
// Only on the console: what happened to the window and the story, as system lines.
const SYSTEM = {
  world: { name: "World", chip: "🌍", color: "#4fd1c5", title: "The window's world" },
  window: { name: "Window", chip: "🪟", color: "#adadb8", title: "The window" },
  manual: { name: "Manual", chip: "✎", color: "#f6c453", title: "A prompt typed in the console" },
  story: { name: "Story", chip: "📕", color: "#f687b3", title: "New story or reset" },
};
const OTHER = { name: "System", chip: "⚙", color: "#adadb8", title: "System" };

/** Which lines belong to the story itself (the rest are the console's system lines). */
export const isStoryLine = (l) => l.kind === "speech" || Boolean(ROLES[l.kind]);

/**
 * How one log line looks in a chat: who said it, its badge and colour, the text, and for the narrator
 * the director's timing ("812 ms, new prompt") split off. Used by the pages and the headset.
 */
export function describeLine(l) {
  if (l.kind === "speech") {
    // A character speaking: "Mei: Hello". Characters get a steady colour per name.
    const i = l.text.indexOf(": ");
    const who = i > 0 ? l.text.slice(0, i) : "Someone";
    return { who, chip: "💬", title: "A character", color: `hsl(${hueOf(who)} 85% 66%)`, text: i > 0 ? l.text.slice(i + 2) : l.text };
  }
  const role = ROLES[l.kind] || SYSTEM[l.kind] || { ...OTHER, name: l.kind || OTHER.name };
  const out = { who: role.name, chip: role.chip, color: role.color, title: role.title, text: l.text, sys: !ROLES[l.kind] };
  if (l.kind === "director") {
    const m = l.text.match(/\s*\((\d+ ms.*)\)$/);
    if (m) (out.text = l.text.slice(0, m.index)), (out.note = m[1]);
    out.narr = true;
  }
  return out;
}

/**
 * A story log on `log` (with its jump button). `all` also shows the system lines and the director's
 * timings (the console); without it, only the story itself (the watch page).
 */
export function storyFeed(log, jump, { all = false, empty = "Nothing yet." } = {}) {
  const seen = new Set(), update = stickyLog(log, jump, { newestFirst: true });
  const key = (l) => `${l.at}|${l.kind}|${l.text}`;
  let first = true;
  return function render(s) {
    const lines = (s.log || []).filter((l) => all || isStoryLine(l));
    const html = lines.length
      ? [...lines]
          .reverse() // newest at the top
          .map((l) => {
            const { who, chip, color, title, text, note, narr, sys } = describeLine(l);
            const cls = narr ? " narr" : sys ? " sys" : "";
            const timing = note && all ? `<span class="note">${esc(note)}</span>` : ""; // how long the director took
            const fresh = !first && !seen.has(key(l)) ? " fresh" : "";
            return `<div class="msg${cls}${fresh}"><span class="ts">${l.at ? clock(l.at) : ""}</span><span class="chip role" title="${title}" style="background:color-mix(in srgb, ${color} 35%, #18181b)">${chip}</span><b class="who" style="color:${color}">${esc(who)}</b><span class="colon">:</span> <span class="text">${esc(text)}</span>${timing}</div>`;
          })
          .join("")
      : `<div class="chatWelcome">${esc(empty)}</div>`;
    const hasNew = lines.some((l) => !seen.has(key(l)));
    for (const l of lines) seen.add(key(l));
    update(html, { hasNew });
    first = false;
  };
}
