// Shared bits of the Twitch-style audience chat (watch page and director console).

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
