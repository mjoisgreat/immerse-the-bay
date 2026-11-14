import "./site.css";
import { createLink, speechHeaders } from "./link.js";
import { urlRoom, voterId } from "./identity.js";
import { PushToTalk } from "./voice.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const room = urlRoom;
if (!room) location.replace("/community.html");

$("#roomPill").textContent = room;
let state = null;
const link = createLink(room, {
  onMessage(m) {
    if (m.t === "state") render((state = m));
    if (m.t === "direction" && m.narration) $("#narration").textContent = m.narration;
  },
});

// Am I a co-narrator (invite link)?
link.request({ t: "whoami" }).then((me) => {
  if (["co", "owner", "console"].includes(me.role)) $("#coPanel").hidden = false;
});

function render(s) {
  const title = s.meta?.title || room;
  $("#title").textContent = title;
  document.title = `${title} · Living Window`;
  const live = Date.now() - (s.lastActive || 0) < 60_000;
  $("#live").textContent = live ? "● live" : "offline";
  $("#live").className = live ? "pill live" : "pill";
  $("#crowdNote").textContent = s.meta?.crowd
    ? "Crowd Mode is on: the top-voted idea becomes the next scene every 20 seconds."
    : "The storyteller picks from the most-voted ideas.";

  const feed = (s.log || []).filter((l) => ["director", "voice", "guest", "crowd"].includes(l.kind));
  $("#feed").innerHTML = feed.length
    ? feed
        .slice()
        .reverse()
        .map((l) =>
          l.kind === "director"
            ? `<li class="story">${esc(l.text.replace(/\s*\(\d+ ms.*\)$/, ""))}</li>`
            : `<li><b>${{ voice: "storyteller", guest: "co-narrator", crowd: "crowd" }[l.kind]}</b>${esc(l.text)}</li>`,
        )
        .join("")
    : `<li class="muted">Nothing yet.</li>`;

  const sug = [...(s.suggestions || [])].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  $("#suggs").className = sug.length ? "" : "empty";
  $("#suggs").innerHTML = sug.length
    ? sug
        .map((x) => {
          const mine = x.voters.includes(voterId);
          return `<div class="sugg"><button class="vote ${mine ? "on" : ""}" data-vote="${esc(x.id)}" aria-pressed="${mine}">▲ ${x.voters.length}</button>
            <span class="text">${esc(x.text)}</span></div>`;
        })
        .join("")
    : "No ideas yet. Be the first.";
  renderSnaps();
}

// Portal snapshots (posted by the storyteller's headset every few seconds).
let snaps = {};
async function pollSnaps() {
  snaps = await fetch(`/api/snapshot?room=${room}`, { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => snaps);
  renderSnaps();
  setTimeout(pollSnaps, document.hidden ? 15000 : 5000);
}
function renderSnaps() {
  const ids = (state?.portals || []).map((p) => p.id).filter((id) => snaps[id]);
  if (!ids.length) {
    $("#snaps").innerHTML = `<div class="empty">Waiting for the storyteller to open a window…</div>`;
    return;
  }
  $("#snaps").innerHTML = ids
    .map((id) => `<div class="snap ${id === state.focusId ? "focus" : ""}"><img alt="Portal ${esc(id)}" src="${snaps[id]}"><span>Window ${esc(id)}${id === state.immersedId ? " · storyteller inside" : ""}</span></div>`)
    .join("");
}
pollSnaps();

// Suggestions and votes (anyone).
$("#suggest").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#idea").value.trim();
  if (!text) return;
  $("#idea").value = "";
  await link.request({ t: "suggest", text });
});
$("#suggs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-vote]");
  if (b) link.request({ t: "vote", id: b.dataset.vote });
});

// Co-narrators: type or hold to talk.
$("#coForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#coLine").value.trim();
  if (!text) return;
  $("#coLine").value = "";
  const r = await link.request({ t: "utterance", text });
  $("#coErr").textContent = r.error || "";
});
const ptt = new PushToTalk();
const mic = $("#mic");
async function micDown(e) {
  e.preventDefault();
  try {
    await ptt.begin();
    mic.classList.add("on");
    mic.textContent = "Listening…";
  } catch (err) {
    $("#coErr").textContent = `Microphone unavailable: ${err.message}`;
  }
}
async function micUp() {
  if (!mic.classList.contains("on")) return;
  mic.classList.remove("on");
  mic.textContent = "Thinking…";
  try {
    const text = await ptt.end(speechHeaders(room));
    if (text) await link.request({ t: "utterance", text });
    $("#coErr").textContent = text ? "" : "Didn't catch that.";
  } catch (err) {
    $("#coErr").textContent = err.message;
  }
  mic.textContent = "Hold to talk";
}
mic.addEventListener("pointerdown", micDown);
addEventListener("pointerup", micUp);
