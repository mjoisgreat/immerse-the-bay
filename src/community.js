import "./site.css";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

async function load() {
  const { rooms = [] } = await fetch("/api/community", { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => ({}));
  const el = document.querySelector("#cards");
  el.innerHTML = rooms.length
    ? rooms
        .map(
          (r) => `<a class="card" href="/watch.html?room=${encodeURIComponent(r.room)}">
        <div class="thumb">${r.thumb ? `<img alt="" src="${r.thumb}">` : ""}
          <span class="pill ${r.live ? "live" : ""}">${r.live ? "● live" : ago(r.lastActive)}</span></div>
        <div class="body"><h3>${esc(r.title)}</h3><p>${esc(r.line) || "A story is about to begin…"}</p>
          <div class="meta"><span class="pill">${r.portals} window${r.portals === 1 ? "" : "s"}</span>
          ${r.crowd ? `<span class="pill">Crowd Mode</span>` : ""}</div></div></a>`,
        )
        .join("")
    : `<div class="empty">No shared stories yet. <a href="/">Start one</a> and turn on “Share to community” in your console.</div>`;
  setTimeout(load, document.hidden ? 30000 : 10000);
}
load();
