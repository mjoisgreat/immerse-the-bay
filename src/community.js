import "./site.css";
import { esc } from "./identity.js";

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

let lastHtml = "";
async function load() {
  const { rooms = [] } = await fetch("/api/community", { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => ({}));
  const el = document.querySelector("#cards");
  const html = rooms.length
    ? rooms
        .map(
          (r) => `<a class="card" href="/watch.html?room=${encodeURIComponent(r.room)}">
        <div class="thumb">${r.thumb ? `<img alt="" src="${esc(r.thumb)}">` : ""}
          <span class="pill ${r.live ? "live" : ""}">${r.live ? "● live" : ago(r.lastActive)}</span></div>
        <div class="body"><h3>${esc(r.title)}</h3><p>${esc(r.line) || "A story is about to begin…"}</p>
          <div class="meta">${r.crowd ? `<span class="pill">Crowd Mode</span>` : ""}</div></div></a>`,
        )
        .join("")
    : `<div class="empty">No shared stories yet. <a href="/">Start one</a> and turn on “Share to community” in your console.</div>`;
  if (html !== lastHtml) el.innerHTML = lastHtml = html; // unchanged: don't reload the thumbnails
  setTimeout(load, document.hidden ? 30000 : 10000);
}
load();
