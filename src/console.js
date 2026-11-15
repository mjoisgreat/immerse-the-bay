import "./site.css";
import { createLink } from "./link.js";
import { PRESETS } from "./presets.js";
import { urlRoom, cleanRoom, credFor, owned, consolePins, savePin, voterId, esc } from "./identity.js";

const $ = (s) => document.querySelector(s);

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
  if (link) return; // a double submit of the gate must not start a second poller
  room = r;
  $("#app").hidden = false;
  $("#roomPill").textContent = `room ${room}`;
  $("#watchLink").textContent = `${location.origin}/watch.html?room=${room}`;
  $("#theaterLink").textContent = `${location.origin}/theater.html?room=${room}`;
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
  $("#seedTitle").textContent = s.window ? "World of the window" : "World of the window to come";
  $("#sayTitle").textContent = !s.window
    ? "Tell the story (no window open: your line becomes its world)"
    : s.story.seed ? "Tell the story" : "What world is behind the window? (your line defines it)";
  $("#suggTitle").textContent = "Audience suggestions";
  if (document.activeElement !== $("#title")) $("#title").value = s.meta?.title || "";
  $("#shared").checked = Boolean(s.meta?.shared);
  $("#crowd").checked = Boolean(s.meta?.crowd);
  $("#choices").innerHTML = (s.choices || [])
    .map((c, i) => `<button class="ghost" data-choose="${i}" style="font-style:italic">→ ${esc(c)}</button>`)
    .join("");
  $("#log").innerHTML = s.log.length
    ? s.log
        .slice()
        .reverse()
        .map((l) => `<li><b>${esc(l.kind)}</b>${esc(l.text)}</li>`)
        .join("")
    : `<li class="muted">Nothing yet. Open a window in the headset and start telling the story.</li>`;

  const sug = [...(s.suggestions || [])].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  $("#suggs").className = sug.length ? "" : "empty";
  $("#suggs").innerHTML = sug.length
    ? sug
        .map(
          (x) => `<div class="sugg"><span class="vote">▲ ${x.voters.length}</span><span class="text">${esc(x.text)}${x.by ? ` <span class="muted">· ${esc(x.by)}</span>` : ""}</span>
          <button data-use="${esc(x.id)}">Use</button><button class="ghost" data-dismiss="${esc(x.id)}" aria-label="Dismiss">✕</button></div>`,
        )
        .join("")
    : "No suggestions yet. Share the watch link so people can suggest and vote.";

  const box = $("#portals");
  if (box.querySelector("textarea:focus")) return; // don't clobber a prompt being typed
  const draft = box.querySelector("textarea")?.value || ""; // an unsent override prompt survives the re-render
  const w = s.window;
  box.className = w ? "" : "empty";
  box.innerHTML = w
    ? `<div class="sugg" style="display:block">
        <div class="row" style="justify-content:space-between"><strong>The window</strong>
          <span class="pill">${esc(w.status)}</span></div>
        <p style="margin:.4rem 0;font-style:italic">${esc(s.story.seed) || "<span class='muted'>No world yet: asking “what world is behind this window?”</span>"}</p>
        <p class="muted" style="margin:.4rem 0">${esc(w.prompt) || (s.story.seed ? "<em>waiting for the director…</em>" : "")}</p>
        <textarea data-prompt placeholder="Override the window's prompt (exact Orbis prompt)"></textarea>
        <div class="row" style="justify-content:space-between;margin-top:.4rem">
          <button class="ghost" data-close>Close</button>
          <button data-apply>Send prompt</button></div></div>`
    : "No window yet. Open it in the headset.";
  const ta = box.querySelector("textarea");
  if (ta) ta.value = draft;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.close !== undefined) send({ t: "close_window" });
  if (b.dataset.use) send({ t: "use_suggestion", id: b.dataset.use });
  if (b.dataset.choose) send({ t: "choose", index: Number(b.dataset.choose) });
  if (b.dataset.dismiss) send({ t: "dismiss_suggestion", id: b.dataset.dismiss });
  if (b.dataset.apply !== undefined) {
    const ta = document.querySelector("textarea[data-prompt]");
    if (ta?.value.trim()) send({ t: "manual_prompt", prompt: ta.value.trim() }), (ta.value = "");
  }
  if (b.dataset.copy) {
    navigator.clipboard?.writeText($(`#${b.dataset.copy}`).textContent).then(() => {
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    });
  }
  if (b.dataset.preset) send({ t: "set_seed", seed: PRESETS[b.dataset.preset][1] });
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
// Reset, New story and Prepare demo wipe the room, so each asks for a second tap. The button
// stays in its "Tap again to confirm" state until you do, or click anywhere else.
const CONFIRM = {
  reset: () => send({ t: "reset_story" }),
  newStoryBtn() {
    const seed = $("#newWorld").value.trim();
    send({ t: "reset_story", seed, ask: !seed });
    $("#newWorld").value = "";
  },
  prepare() {
    send({ t: "reset_story", seed: $("#newWorld").value.trim() || PRESETS[0][1], open: true });
    $("#newWorld").value = "";
  },
};
function disarm() {
  for (const b of document.querySelectorAll("button[data-armed]")) {
    b.textContent = b.dataset.armed;
    delete b.dataset.armed;
    b.className = "ghost";
    b.style.background = "";
  }
}
$("#newStory").addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  const act = b && CONFIRM[b.id];
  if (act && b.dataset.armed) return disarm(), act();
  disarm();
  if (!act) return;
  b.dataset.armed = b.textContent;
  b.textContent = "Tap again to confirm";
  b.className = "";
  b.style.background = "var(--bad)";
});
$("#presets").innerHTML = PRESETS.map(([label, seed], i) => `<button class="ghost" data-preset="${i}" title="${esc(seed)}">${esc(label)}</button>`).join("");

start();
