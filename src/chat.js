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
 * A chat log that sticks to the bottom like a stream chat: new lines scroll into view unless the
 * reader has scrolled up, in which case the jump button appears instead. Redraws only on change.
 */
export function stickyLog(log, jump) {
  let html = "", first = true;
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.addEventListener("scroll", () => atBottom() && (jump.hidden = true));
  jump.addEventListener("click", () => {
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    jump.hidden = true;
  });
  return function update(next, { hasNew = false, toBottom = false } = {}) {
    if (next === html) return;
    const stick = first || toBottom || atBottom();
    const keep = log.scrollTop;
    log.innerHTML = html = next;
    if (stick) log.scrollTop = log.scrollHeight;
    else {
      log.scrollTop = keep;
      if (hasNew) jump.hidden = false;
    }
    first = false;
  };
}
