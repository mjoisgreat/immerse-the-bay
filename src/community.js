import "./site.css";
import { esc } from "./identity.js";
import { hueOf } from "./chat.js";

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One stream card, Twitch style: thumbnail with LIVE and viewers, then avatar, title, room, tags, latest chat.
function card(r) {
  const chat = (r.chat || [])
    .map((c) => `<div style="--hue:${hueOf(c.by || "Someone")}"><b>${esc(c.by || "Someone")}</b>: ${esc(c.text)}<span class="v">▲ ${c.votes}</span></div>`)
    .join("");
  const more = r.ideas > (r.chat || []).length ? `<div class="more">+${r.ideas - r.chat.length} more in chat</div>` : "";
  return `<a class="card${r.live ? " live" : ""}" href="/watch.html?room=${encodeURIComponent(r.room)}" style="--hue:${hueOf(r.room)}">
    <div class="thumbWrap"><div class="thumb">${r.thumb ? `<img alt="" src="${esc(r.thumb)}">` : ""}
      ${r.live ? `<span class="tag-live">LIVE</span>` : `<span class="tag-ago">${ago(r.lastActive)}</span>`}
      ${r.watching ? `<span class="viewers">${plural(r.watching, "viewer")}</span>` : ""}</div></div>
    <div class="info"><div class="ava" aria-hidden="true">${esc((r.title || "?").trim()[0]?.toUpperCase() || "?")}</div>
      <div style="min-width:0"><h3 title="${esc(r.title)}">${esc(r.title)}</h3>
        <div class="channel">${esc(r.room)}</div>
        <p class="line">${esc(r.line) || "A story is about to begin…"}</p>
        <div class="tags"><span>${plural(r.portals, "window")}</span>${r.crowd ? `<span>Crowd Mode</span>` : ""}${r.ideas ? `<span>${plural(r.ideas, "idea")}</span>` : ""}</div>
        ${chat ? `<div class="peek">${chat}${more}</div>` : ""}</div></div></a>`;
}

let lastHtml = "";
async function load() {
  const { rooms = [] } = await fetch("/api/community", { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => ({}));
  const el = document.querySelector("#cards");
  const html = rooms.length
    ? rooms.map(card).join("")
    : `<div class="empty">No shared stories yet. <a href="/">Start one</a> and turn on “Share to community” in your console.</div>`;
  if (html !== lastHtml) el.innerHTML = lastHtml = html; // unchanged: don't reload the thumbnails
  setTimeout(load, document.hidden ? 30000 : 10000);
}
load();
