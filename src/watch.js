import "./site.css";
import { createLink, speechHeaders } from "./link.js";
import { urlRoom, voterId, esc } from "./identity.js";
import { PushToTalk, micMessage } from "./voice.js";
import { myName, peopleSummary, startPresence, thisDeviceKind } from "./people.js";

const $ = (s) => document.querySelector(s);
const room = urlRoom;
if (!room) location.replace("/community.html");

$("#roomPill").textContent = room;
let state = null;
let canNarrate = false;
const link = createLink(room, {
  onMessage(m) {
    if (m.t === "state") render((state = m));
    if (m.t === "direction" && m.narration) $("#narration").textContent = m.narration;
  },
});

// Tell the room I'm here (the storyteller sees "Ana joined on a phone"); the name is the one typed below, if any.
startPresence(link.request, { kind: thisDeviceKind(), getName: () => $("#who")?.value.trim() || myName() });

// Am I a co-narrator (invite link)?
link.request({ t: "whoami" }).then((me) => {
  if (["co", "owner", "console"].includes(me.role)) {
    $("#coPanel").hidden = false;
    if (me.role !== "co") $("#coTitle").textContent = "Add to the story";
    canNarrate = true;
    if (state) render(state);
  }
});

function render(s) {
  const title = s.meta?.title || room;
  $("#title").textContent = title;
  document.title = `${title} · Living Window`;
  const live = Date.now() - (s.lastActive || 0) < 60_000;
  $("#live").textContent = live ? "● live" : "offline";
  $("#live").className = live ? "pill live" : "pill";
  const here = peopleSummary(s.people);
  $("#people").hidden = !here;
  $("#people").textContent = `here: ${here}`;
  $("#crowdNote").textContent = s.meta?.crowd
    ? "Crowd Mode is on: the top-voted idea becomes the next scene every 20 seconds."
    : "The storyteller picks from the most-voted ideas.";
  // Each window is its own story; an idea steers the one the storyteller is looking at.
  if ((s.portals || []).length > 1 && s.focusId) $("#crowdNote").textContent += ` Ideas steer window ${s.focusId}, the one the storyteller is looking at now.`;

  const choices = s.choices || [];
  $("#nextBox").hidden = !choices.length;
  $("#nextLabel").textContent = canNarrate ? "Pick what happens next" : "What could happen next (the storyteller picks)";
  $("#choices").innerHTML = choices
    .map((c, i) =>
      canNarrate
        ? `<button class="ghost" data-choose="${i}" style="font-style:italic">→ ${esc(c)}</button>`
        : `<span class="pill" style="font-style:italic">${esc(c)}</span>`,
    )
    .join("");

  const kinds = { voice: "storyteller", guest: "co-narrator", crowd: "crowd", choice: "chosen", touch: "touch" };
  const feed = (s.log || []).filter((l) => ["director", "speech", ...Object.keys(kinds)].includes(l.kind));
  $("#feed").innerHTML = feed.length
    ? feed
        .slice()
        .reverse()
        .map((l) =>
          l.kind === "director"
            ? `<li class="story">${esc(l.text.replace(/\s*\(\d+ ms.*\)$/, ""))}</li>`
            : l.kind === "speech"
              ? `<li class="story" style="font-style:normal">💬 ${esc(l.text)}</li>`
              : `<li><b>${kinds[l.kind]}</b>${esc(l.text)}</li>`,
        )
        .join("")
    : `<li class="muted">Nothing yet.</li>`;

  renderIdeas(s);
  renderSnaps();
}

// ---------- Ideas: cards with who said it and when, the votes, and the top one called out ----------
// Redrawn only when something changed (no flicker, no lost hover); new ideas fade in once.
const seenIdeas = new Set();
let ideasHtml = "", firstIdeas = true;
const agoShort = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
/** A steady colour per name, so the same person always looks the same. */
function hueOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}
function renderIdeas(s) {
  const sug = [...(s.suggestions || [])].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  const top = sug[0]?.voters.length || 0;
  $("#suggCount").textContent = sug.length ? `· ${sug.length}` : "";
  const html = sug.length
    ? sug
        .map((x, i) => {
          const votes = x.voters.length, voted = x.voters.includes(voterId), yours = x.voters[0] === voterId;
          const name = x.by || "Someone";
          const isTop = i === 0 && votes > 1 && votes > (sug[1]?.voters.length || 0);
          const badge = isTop ? `<span class="badge top">${s.meta?.crowd ? "⏭ Up next" : "🔥 Top idea"}</span>` : "";
          const fresh = !firstIdeas && !seenIdeas.has(x.id) ? " fresh" : "";
          return `<article class="idea${isTop ? " is-top" : ""}${yours ? " is-mine" : ""}${fresh}" style="--hue:${hueOf(name)};--share:${top ? Math.round((votes / top) * 100) : 0}%">
            <div class="avatar" aria-hidden="true">${esc((x.by || "?").trim()[0]?.toUpperCase() || "?")}</div>
            <div class="ideaBody">
              <div class="ideaMeta"><b>${esc(name)}</b>${yours ? `<span class="badge mine">Your idea</span>` : ""}${badge}<span class="muted">· ${agoShort(x.at)}</span></div>
              <p class="ideaText">${esc(x.text)}</p>
            </div>
            <button class="vote${voted ? " on" : ""}" ${yours ? `disabled title="Your idea always keeps your vote"` : `data-vote="${esc(x.id)}"`} aria-pressed="${voted}" aria-label="${yours ? "Your idea keeps your vote" : voted ? "Remove your vote" : "Vote for this idea"} (${votes})">
              <span class="arrow">▲</span><span class="n">${votes}</span></button>
          </article>`;
        })
        .join("")
    : `<div class="ideasEmpty"><div class="big">💡</div><p>No ideas yet. Be the first to say what happens next.</p></div>`;
  for (const x of sug) seenIdeas.add(x.id);
  firstIdeas = false;
  if (html !== ideasHtml) $("#suggs").innerHTML = ideasHtml = html;
  $("#suggs").className = sug.length ? "ideas" : "ideas empty";
}

// Portal snapshots (posted by the storyteller's headset every few seconds).
let snaps = {};
let snapsHtml = "";
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
    snapsHtml = "";
    return;
  }
  const html = ids
    .map((id) => `<div class="snap ${id === state.focusId ? "focus" : ""}"><img alt="Portal ${esc(id)}" src="${esc(snaps[id])}"><span>Window ${esc(id)}${id === state.immersedId ? " · storyteller inside" : ""}</span></div>`)
    .join("");
  if (html !== snapsHtml) $("#snaps").innerHTML = snapsHtml = html; // same frames: don't reload the images
}
pollSnaps();

// Suggestions and votes (anyone). The optional name is shown with the idea, in the headset too.
const NAME_KEY = "lw:name";
try {
  $("#who").value = localStorage.getItem(NAME_KEY) || "";
} catch {}
const ideaCount = () => {
  const n = $("#idea").value.length;
  $("#ideaCount").textContent = `${n} / 140`;
  $("#ideaCount").classList.toggle("near", n > 120);
  $("#postIdea").disabled = !$("#idea").value.trim();
};
$("#idea").addEventListener("input", ideaCount);
// Enter posts (an idea is one line); Shift+Enter still makes a new line.
$("#idea").addEventListener("keydown", (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), $("#suggest").requestSubmit()));
$("#suggest").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#idea").value.replace(/\s+/g, " ").trim();
  if (!text) return;
  const name = $("#who").value.trim();
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {}
  $("#idea").value = "";
  ideaCount();
  await link.request({ t: "suggest", text, name });
});
$("#choices").addEventListener("click", (e) => {
  const b = e.target.closest("[data-choose]");
  if (b) link.request({ t: "choose", index: Number(b.dataset.choose) });
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
// Viewers are mostly on phones: let go of the mic after each turn (iPhones play quietly while it's open).
const ptt = new PushToTalk({ releaseAfterMs: matchMedia("(pointer: coarse)").matches ? 8000 : 0 });
const mic = $("#mic");
let held = false;
async function micDown(e) {
  e.preventDefault();
  held = true;
  try {
    await ptt.begin();
    mic.classList.add("on");
    mic.textContent = "Listening…";
    if (!held) micUp(); // released while the mic permission/start was pending
  } catch (err) {
    $("#coErr").textContent = micMessage(err);
  }
}
async function micUp() {
  held = false;
  if (!mic.classList.contains("on")) return;
  mic.classList.remove("on");
  mic.textContent = "Thinking…";
  try {
    const text = await ptt.end(speechHeaders(room));
    if (text) await link.request({ t: "utterance", text });
    $("#coErr").textContent = text ? "" : "Didn't catch that. Hold the button while you speak, then let go.";
  } catch (err) {
    $("#coErr").textContent = err.message;
  }
  mic.textContent = "Hold to talk";
}
mic.addEventListener("pointerdown", micDown);
addEventListener("pointerup", micUp);
addEventListener("pointercancel", micUp); // a phone took the touch (scroll, system gesture): send, don't keep recording
mic.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press is a hold, not a menu
