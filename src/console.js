import { wsUrl } from "./ws-url.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PRESETS = [
  "A lantern-lit fishing village on a misty mountain lake at dusk, wooden boats, paper lanterns glowing amber",
  "A giant's overgrown library where the bookshelves are mossy cliffs and paper birds fly between them, warm afternoon light",
  "A tiny moon base made of tin cans and string lights on a pastel lunar plain, Earth rising on the horizon",
  "An underwater city of glowing coral towers, schools of silver fish, sunbeams slanting down through blue water",
];

let ws;
async function connect() {
  ws = new WebSocket(await wsUrl());
  ws.onopen = () => ($("#conn").textContent = "connected");
  ws.onclose = () => (($("#conn").textContent = "reconnecting…"), setTimeout(connect, 1500));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "state") render(m);
    if (m.t === "direction" && m.narration) $("#narration").textContent = m.narration;
  };
}
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
connect();

function render(s) {
  $("#brain").textContent = `director: ${s.director}`;
  $("#bible").textContent = s.story.bible;
  if (document.activeElement !== $("#seedText")) $("#seedText").value = s.story.seed;
  $("#log").innerHTML = s.log
    .slice()
    .reverse()
    .map((l) => `<li><b>${esc(l.kind)}</b>${esc(l.text)}</li>`)
    .join("");

  const box = $("#portals");
  const editing = box.querySelector("textarea:focus");
  if (editing) return; // don't clobber a prompt someone is typing
  box.innerHTML = s.portals.length
    ? s.portals
        .map(
          (p) => `<div class="portal ${p.id === s.focusId ? "focus" : ""}">
        <div class="row"><strong>Portal ${esc(p.id)}${p.id === s.focusId ? " · focused" : ""}</strong>
          <span class="status">${esc(p.status)}</span></div>
        <p>${esc(p.prompt) || "<em>waiting for the director…</em>"}</p>
        <textarea data-id="${esc(p.id)}" placeholder="Override this portal's prompt (exact Orbis prompt)"></textarea>
        <div class="row" style="margin-top:.4rem">
          <span><button class="ghost" data-focus="${esc(p.id)}">Focus</button>
          <button class="ghost" data-close="${esc(p.id)}">Close</button></span>
          <button data-apply="${esc(p.id)}">Send prompt</button></div></div>`,
        )
        .join("")
    : `<p style="color:var(--muted)">No portals yet. Open one in the headset.</p>`;
}

$("#portals").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.focus) send({ t: "focus", id: b.dataset.focus });
  if (b.dataset.close) send({ t: "close_portal", id: b.dataset.close });
  if (b.dataset.apply) {
    const ta = $(`textarea[data-id="${b.dataset.apply}"]`);
    if (ta.value.trim()) send({ t: "manual_prompt", id: b.dataset.apply, prompt: ta.value.trim() }), (ta.value = "");
  }
});

$("#say").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#line").value.trim();
  if (text) send({ t: "utterance", text });
  $("#line").value = "";
});

$("#seed").addEventListener("submit", (e) => {
  e.preventDefault();
  send({ t: "set_seed", seed: $("#seedText").value });
});

$("#presets").innerHTML = PRESETS.map((p, i) => `<button class="ghost" data-i="${i}">${esc(p.split(",")[0])}</button>`).join("");
$("#presets").addEventListener("click", (e) => {
  const i = e.target.dataset.i;
  if (i != null) send({ t: "set_seed", seed: PRESETS[i] });
});
