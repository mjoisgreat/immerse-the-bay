import "./site.css";
import { createLink, speechHeaders } from "./link.js";
import { urlRoom, voterId, esc } from "./identity.js";
import { PushToTalk, micMessage } from "./voice.js";
import { myName, peopleSummary, startPresence, thisDeviceKind } from "./people.js";
import { hueOf, clock, topIdeaOf, nextIdeaOf, stickyLog, countdownHtml, countdownBar, startCountdowns } from "./chat.js";

const $ = (s) => document.querySelector(s);
const room = urlRoom;
if (!room) location.replace("/community.html");

$("#roomPill").textContent = room;
let state = null;
let canNarrate = false;
const link = createLink(room, {
  onMessage(m) {
    if (m.t === "rtc") return void onLive(m);
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
    ? "Crowd Mode is on: when the countdown runs out, the top-voted idea becomes the next scene. Vote fast!"
    : "The storyteller picks from the most-voted ideas.";

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

  renderFeed(s);

  renderIdeas(s);
  maybeAskLive();
  renderSnaps();
}

// ---------- The story so far, as a stream chat: who said what, with Twitch-style badges ----------
// The narrator, the storyteller, co-narrators, the crowd's picks and the characters each get a name and
// a badge; the newest line is at the top and the log sticks there unless you've scrolled down.
const ROLES = {
  director: { name: "Narrator", chip: "📖", color: "#ffb36b", title: "The narrator" },
  voice: { name: "Storyteller", chip: "🎥", color: "#ff6b6b", title: "The storyteller (broadcaster)" },
  guest: { name: "Co-narrator", chip: "🎙", color: "#3ddc6a", title: "A co-narrator" },
  crowd: { name: "Crowd", chip: "👥", color: "#bf94ff", title: "The crowd's top idea" },
  choice: { name: "Chosen", chip: "✓", color: "#5cb8ff", title: "A chosen option" },
  touch: { name: "Storyteller", chip: "✋", color: "#ff6b6b", title: "The storyteller touched the world" },
};
const seenLines = new Set();
let firstFeed = true;
const updateFeed = stickyLog($("#feed"), $("#feedJump"), { newestFirst: true });
function renderFeed(s) {
  const lines = (s.log || []).filter((l) => l.kind === "speech" || ROLES[l.kind]);
  const key = (l) => `${l.at}|${l.kind}|${l.text}`;
  const html = lines.length
    ? [...lines]
        .reverse() // newest at the top
        .map((l) => {
          let who, chip, color, title, text = l.text, cls = "";
          if (l.kind === "speech") {
            // A character speaking: "Mei: Hello". Characters get a steady colour per name.
            const i = l.text.indexOf(": ");
            who = i > 0 ? l.text.slice(0, i) : "Someone";
            text = i > 0 ? l.text.slice(i + 2) : l.text;
            ({ chip, title } = { chip: "💬", title: "A character" });
            color = `hsl(${hueOf(who)} 85% 66%)`;
          } else {
            ({ name: who, chip, color, title } = ROLES[l.kind]);
            if (l.kind === "director") (text = l.text.replace(/\s*\(\d+ ms.*\)$/, "")), (cls = " narr");
          }
          const fresh = !firstFeed && !seenLines.has(key(l)) ? " fresh" : "";
          return `<div class="msg${cls}${fresh}"><span class="ts">${l.at ? clock(l.at) : ""}</span><span class="chip role" title="${title}" style="background:color-mix(in srgb, ${color} 35%, #18181b)">${chip}</span><b class="who" style="color:${color}">${esc(who)}</b><span class="colon">:</span> <span class="text">${esc(text)}</span></div>`;
        })
        .join("")
    : `<div class="chatWelcome">Nothing yet. The story starts when the storyteller speaks.</div>`;
  const hasNew = lines.some((l) => !seenLines.has(key(l)));
  for (const l of lines) seenLines.add(key(l));
  updateFeed(html, { hasNew });
  firstFeed = false;
}

// ---------- Ideas as a stream chat: the newest at the top, under the pinned top idea ----------
// Redrawn only when something changed (no flicker, no lost hover). The log sticks to the bottom unless
// you've scrolled up to read, like a Twitch chat; then a "new ideas below" button appears.
const seenIdeas = new Set();
let pinnedHtml = "", firstIdeas = true;
function voteButton(x, votes, voted, yours) {
  return `<button class="vote${voted ? " on" : ""}" ${yours ? `disabled title="Your idea always keeps your vote"` : `data-vote="${esc(x.id)}"`} aria-pressed="${voted}" aria-label="${yours ? "Your idea keeps your vote" : voted ? "Remove your vote" : "Vote for this idea"} (${votes})">▲ ${votes}</button>`;
}
const updateLog = stickyLog($("#suggs"), $("#jump"), { newestFirst: true });
startCountdowns();
function renderIdeas(s) {
  const sug = s.suggestions || [];
  // In Crowd Mode the pinned idea is the one that plays when the countdown runs out; otherwise the clear leader.
  const crowd = Boolean(s.meta?.crowd);
  const topIdea = crowd ? nextIdeaOf(sug) : topIdeaOf(sug);
  const label = crowd ? `⏭ Up next in ${countdownHtml(s)}` : "📌 Top idea";
  $("#suggCount").textContent = sug.length ? `· ${sug.length}` : "";

  const line = (x) => {
    const votes = x.voters.length, voted = x.voters.includes(voterId), yours = x.voters[0] === voterId;
    const name = x.by || "Someone";
    const fresh = !firstIdeas && !seenIdeas.has(x.id) ? " fresh" : "";
    return `<div class="msg${yours ? " is-mine" : ""}${x === topIdea ? " is-top" : ""}${fresh}" style="--hue:${hueOf(name)}">
      <span class="ts">${clock(x.at)}</span>${x === topIdea ? `<span class="chip top" title="${crowd ? "Up next" : "Top idea"}">${s.meta?.crowd ? "⏭" : "🔥"}</span>` : ""}${yours ? `<span class="chip mine" title="Your idea">★</span>` : ""}<b class="who">${esc(name)}</b><span class="colon">:</span> <span class="text">${esc(x.text)}</span>${voteButton(x, votes, voted, yours)}${yours ? `<button class="del" data-del="${esc(x.id)}" title="Delete your idea" aria-label="Delete your idea: ${esc(x.text)}">✕</button>` : ""}</div>`;
  };
  const html = sug.length
    ? [...sug].sort((a, b) => b.at - a.at).map(line).join("") // newest first
    : `<div class="chatWelcome">Welcome to the chat! Suggest what happens next in the story, and vote ▲ on the ideas you like.</div>`;

  const pin = topIdea
    ? `<div class="pinLabel">${label} · ${topIdea.voters.length} vote${topIdea.voters.length === 1 ? "" : "s"}</div>${countdownBar(s)}
       <div class="pinBody" style="--hue:${hueOf(topIdea.by || "Someone")}"><b class="who">${esc(topIdea.by || "Someone")}</b><span class="colon">:</span> <span class="text">${esc(topIdea.text)}</span>${voteButton(topIdea, topIdea.voters.length, topIdea.voters.includes(voterId), topIdea.voters[0] === voterId)}</div>`
    : "";
  if (pin !== pinnedHtml) {
    $("#pinned").innerHTML = pinnedHtml = pin;
    $("#pinned").hidden = !pin;
  }

  const hasNew = sug.some((x) => !seenIdeas.has(x.id));
  const mineNew = sug.some((x) => !seenIdeas.has(x.id) && x.voters[0] === voterId);
  for (const x of sug) seenIdeas.add(x.id);
  updateLog(html, { hasNew, toBottom: mineNew });
  firstIdeas = false;
}

// A snapshot of the window (posted by the storyteller's headset every few seconds).
let snap = null;
let snapsHtml = "";
async function pollSnaps() {
  snap = await fetch(`/api/snapshot?room=${room}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => j.image)
    .catch(() => snap);
  renderSnaps();
  // Fast while pictures are all you have; slow once the live video is playing.
  setTimeout(pollSnaps, document.hidden ? 15000 : live === "live" ? 6000 : 1200);
}
function renderSnaps() {
  if (!state?.window || !snap) {
    $("#snaps").innerHTML = `<div class="empty">Waiting for the storyteller to open a window…</div>`;
    snapsHtml = "";
    return;
  }
  const html = `<div class="snap focus"><img alt="The window" src="${esc(snap)}"><span>The window${state.immersed ? " · storyteller inside" : ""}</span></div>`;
  if (html !== snapsHtml) $("#snaps").innerHTML = snapsHtml = html; // same frames: don't reload the images
}
pollSnaps();

// ---------- Live view: the storyteller's device passes the window on, peer to peer ----------
// (See src/app/livecast.js.) Ask once a window is streaming; if the live view is full, blocked by the
// network, or stops, the pictures above carry on (refreshing about once a second) and we try again later.
let ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
fetch("/api/config") // a TURN relay, when the server has one (for networks that block direct links)
  .then((r) => r.json())
  .then((c) => Array.isArray(c.iceServers) && c.iceServers.length && (ICE_SERVERS = c.iceServers))
  .catch(() => {});
const viewerId = `v${Math.random().toString(36).slice(2, 10)}`;
let pc = null, live = "idle"; // idle | asking | connecting | live
let askedAt = 0, retryAt = 0;
const liveVideo = $("#liveVideo");
function liveNote(text) {
  $("#liveNote").hidden = !text;
  $("#liveNote").textContent = text || "";
}
function closeLive() {
  try {
    pc?.close();
  } catch {}
  pc = null;
  liveVideo.srcObject = null;
  $("#liveBox").hidden = true;
}
function fallBack(note, retryMs) {
  closeLive();
  live = "idle";
  retryAt = performance.now() + retryMs;
  liveNote(note);
}
function maybeAskLive() {
  const streaming = state?.window?.status === "streaming";
  const now = performance.now();
  if (live === "asking" && now - askedAt > 15000) return fallBack("The live video didn't start. Showing pictures instead; trying again shortly.", 20000);
  if (live !== "idle" || !streaming || now < retryAt || document.hidden) return;
  live = "asking";
  askedAt = now;
  link.request({ t: "rtc", kind: "join", to: "host", from: viewerId });
}
setInterval(maybeAskLive, 2000);
const iceDone = (p, ms = 3000) =>
  p.iceGatheringState === "complete"
    ? Promise.resolve()
    : new Promise((r) => {
        const t = setTimeout(r, ms);
        p.addEventListener("icegatheringstatechange", () => p.iceGatheringState === "complete" && (clearTimeout(t), r()));
      });
async function onLive(m) {
  if (m.to !== viewerId || m.from !== "host") return;
  if (m.kind === "full") return fallBack("Live video is full right now (4 viewers). Showing pictures instead.", 60000);
  if (m.kind === "bye") return fallBack("The live video stopped. Showing pictures instead.", 15000);
  if (m.kind !== "offer") return;
  closeLive();
  live = "connecting";
  const conn = (pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
  const media = new MediaStream();
  conn.ontrack = (e) => {
    media.addTrack(e.track);
    if (liveVideo.srcObject !== media) liveVideo.srcObject = media;
    liveVideo.play().catch(() => {});
  };
  conn.onconnectionstatechange = () => {
    if (pc !== conn) return;
    if (conn.connectionState === "connected") {
      live = "live";
      $("#liveBox").hidden = false;
      liveNote("");
    } else if (conn.connectionState === "failed") fallBack("Couldn't connect to the live video from this network. Showing pictures instead.", 30000);
    else if (conn.connectionState === "disconnected" && live === "live") fallBack("The live video dropped. Reconnecting…", 4000);
  };
  try {
    await conn.setRemoteDescription({ type: "offer", sdp: m.sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await iceDone(conn);
    if (pc !== conn) return;
    link.request({ t: "rtc", kind: "answer", to: "host", from: viewerId, sdp: conn.localDescription.sdp });
  } catch {
    fallBack("Couldn't start the live video. Showing pictures instead.", 30000);
  }
}
// Browsers only start video with sound after a tap.
$("#liveSound").addEventListener("click", () => {
  liveVideo.muted = !liveVideo.muted;
  liveVideo.play().catch(() => {});
  $("#liveSound").textContent = liveVideo.muted ? "🔊 Tap for sound" : "🔇 Mute";
});
// Leaving: tell the storyteller's device right away, so the spot frees up for someone else.
addEventListener("pagehide", () => {
  if (live === "idle") return;
  const body = JSON.stringify({ t: "rtc", kind: "bye", to: "host", from: viewerId, room, voter: voterId });
  navigator.sendBeacon?.("/api/relay", new Blob([body], { type: "application/json" }));
});

// Suggestions and votes (anyone). The optional name is shown with the idea, in the headset too.
const NAME_KEY = "lw:name";
try {
  $("#who").value = localStorage.getItem(NAME_KEY) || "";
} catch {}
const ideaCount = () => {
  const n = $("#idea").value.length;
  $("#ideaCount").textContent = `${n} / 140`;
  $("#ideaCount").classList.toggle("near", n > 120);
  $("#ideaCount").hidden = n < 100; // like Twitch: the count only shows near the limit
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
// Votes and deletes, in the ideas chat (by id: the story feed is a chat panel too).
$("#ideasChat").addEventListener("click", (e) => {
  const b = e.target.closest("[data-vote]");
  if (b) link.request({ t: "vote", id: b.dataset.vote });
  const d = e.target.closest("[data-del]");
  if (d) {
    // Gone at once on this page; the server removes it for everyone.
    if (state) {
      state.suggestions = (state.suggestions || []).filter((x) => x.id !== d.dataset.del);
      renderIdeas(state);
    }
    link.request({ t: "delete_suggestion", id: d.dataset.del });
  }
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
