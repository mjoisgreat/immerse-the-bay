import "./site.css";
import { createLink } from "./link.js";
import { urlRoom, cleanRoom, credFor, owned, consolePins, savePin, voterId } from "./identity.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PRESETS = [
  "A lantern-lit fishing village on a misty mountain lake at dusk, wooden boats, paper lanterns glowing amber",
  "A giant's overgrown library where the bookshelves are mossy cliffs and paper birds fly between them, warm afternoon light",
  "A tiny moon base made of tin cans and string lights on a pastel lunar plain, Earth rising on the horizon",
  "An underwater city of glowing coral towers, schools of silver fish, sunbeams slanting down through blue water",
];

async function whoami(room) {
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: "whoami", room, cred: credFor(room), voter: voterId }),
  });
  return r.json();
}

// ---------- Unlock ----------
async function start() {
  const room = urlRoom || Object.keys(consolePins()).at(-1) || Object.keys(owned()).at(-1) || "";
  if (room) {
    const me = await whoami(room).catch(() => ({}));
    if (me.role === "owner" || me.role === "console") return open(room, me);
  }
  $("#gate").hidden = false;
  $("#gateRoom").value = room;
}

$("#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const room = cleanRoom($("#gateRoom").value);
  const pin = $("#gatePin").value.trim().toUpperCase();
  if (!room || !pin) return ($("#gateErr").textContent = "Enter both the room and the console code.");
  savePin(room, pin);
  const me = await whoami(room).catch(() => ({}));
  if (me.role !== "console" && me.role !== "owner") {
    $("#gateErr").textContent = me.role === "none" ? "That room doesn't exist yet. Open it on the headset first." : "That code doesn't match this room.";
    return;
  }
  history.replaceState(null, "", `?room=${room}`);
  $("#gate").hidden = true;
  open(room, me);
});

// ---------- Console ----------
let link, room;

function open(r, me) {
  room = r;
  $("#app").hidden = false;
  $("#roomPill").textContent = `room ${room}`;
  $("#watchLink").textContent = `${location.origin}/watch.html?room=${room}`;
  if (me.invite) $("#inviteLink").textContent = `${location.origin}/watch.html?room=${room}&invite=${me.invite}`;
  link = createLink(room, {
    onOpen: () => ($("#conn").textContent = "connected"),
    onMessage(m) {
      if (m.t === "state") render(m);
      if (m.t === "direction" && m.narration) $("#narration").textContent = m.narration;
    },
  });
  setInterval(() => !link.connected && ($("#conn").textContent = "reconnecting…"), 2000);
}

const send = (m) => link?.send(m);

function render(s) {
  $("#brain").textContent = `director: ${s.director}`;
  $("#bible").textContent = s.story.bible;
  if (document.activeElement !== $("#seedText")) $("#seedText").value = s.story.seed;
  if (document.activeElement !== $("#title")) $("#title").value = s.meta?.title || "";
  $("#shared").checked = Boolean(s.meta?.shared);
  $("#crowd").checked = Boolean(s.meta?.crowd);
  $("#choices").innerHTML = (s.choices || [])
    .map((c, i) => `<button class="ghost" data-choose="${i}" style="font-style:italic">→ ${esc(c)}</button>`)
    .join("");
  $("#log").innerHTML = s.log
    .slice()
    .reverse()
    .map((l) => `<li><b>${esc(l.kind)}</b>${esc(l.text)}</li>`)
    .join("");

  const sug = [...(s.suggestions || [])].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  $("#suggs").className = sug.length ? "" : "empty";
  $("#suggs").innerHTML = sug.length
    ? sug
        .map(
          (x) => `<div class="sugg"><span class="vote">▲ ${x.voters.length}</span><span class="text">${esc(x.text)}</span>
          <button data-use="${esc(x.id)}">Use</button><button class="ghost" data-dismiss="${esc(x.id)}" aria-label="Dismiss">✕</button></div>`,
        )
        .join("")
    : "No suggestions yet. Share the watch link so people can suggest and vote.";

  const box = $("#portals");
  if (box.querySelector("textarea:focus")) return; // don't clobber a prompt being typed
  box.className = s.portals.length ? "" : "empty";
  box.innerHTML = s.portals.length
    ? s.portals
        .map(
          (p) => `<div class="sugg" style="display:block">
        <div class="row" style="justify-content:space-between"><strong>Portal ${esc(p.id)}${p.id === s.focusId ? " · focused" : ""}</strong>
          <span class="pill">${esc(p.status)}</span></div>
        <p class="muted" style="margin:.4rem 0">${esc(p.prompt) || "<em>waiting for the director…</em>"}</p>
        <textarea data-id="${esc(p.id)}" placeholder="Override this portal's prompt (exact Orbis prompt)"></textarea>
        <div class="row" style="justify-content:space-between;margin-top:.4rem">
          <span class="row"><button class="ghost" data-focus="${esc(p.id)}">Focus</button>
          <button class="ghost" data-close="${esc(p.id)}">Close</button></span>
          <button data-apply="${esc(p.id)}">Send prompt</button></div></div>`,
        )
        .join("")
    : "No portals yet. Open one in the headset.";
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.focus) send({ t: "focus", id: b.dataset.focus });
  if (b.dataset.close) send({ t: "close_portal", id: b.dataset.close });
  if (b.dataset.use) send({ t: "use_suggestion", id: b.dataset.use });
  if (b.dataset.choose) send({ t: "choose", index: Number(b.dataset.choose) });
  if (b.dataset.dismiss) send({ t: "dismiss_suggestion", id: b.dataset.dismiss });
  if (b.dataset.apply) {
    const ta = document.querySelector(`textarea[data-id="${b.dataset.apply}"]`);
    if (ta.value.trim()) send({ t: "manual_prompt", id: b.dataset.apply, prompt: ta.value.trim() }), (ta.value = "");
  }
  if (b.dataset.copy) {
    navigator.clipboard?.writeText($(`#${b.dataset.copy}`).textContent).then(() => {
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    });
  }
  if (b.dataset.preset) send({ t: "set_seed", seed: PRESETS[b.dataset.preset] });
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
$("#titleForm").addEventListener("submit", (e) => {
  e.preventDefault();
  send({ t: "set_meta", title: $("#title").value });
  $("#title").blur();
});
$("#shared").addEventListener("change", (e) => send({ t: "set_meta", shared: e.target.checked }));
$("#crowd").addEventListener("change", (e) => send({ t: "set_meta", crowd: e.target.checked }));
let resetTimer;
$("#reset").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (b.dataset.armed) {
    clearTimeout(resetTimer);
    delete b.dataset.armed;
    b.textContent = "Reset story";
    b.className = "ghost";
    b.style.background = "";
    return send({ t: "reset_story" });
  }
  b.dataset.armed = "1";
  b.textContent = "Click again to reset";
  b.className = "";
  b.style.background = "var(--bad)";
  resetTimer = setTimeout(() => {
    delete b.dataset.armed;
    b.textContent = "Reset story";
    b.className = "ghost";
    b.style.background = "";
  }, 3000);
});
$("#presets").innerHTML = PRESETS.map((p, i) => `<button class="ghost" data-preset="${i}">${esc(p.split(",")[0])}</button>`).join("");

start();
