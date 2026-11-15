import "./site.css";
import { createLink } from "./link.js";
import { peopleSummary, startPresence } from "./people.js";
import { PRESETS } from "./presets.js";
import { urlRoom, cleanRoom, credFor, owned, consolePins, savePin, voterId, esc } from "./identity.js";
import { hueOf, clock, topIdeaOf, stickyLog } from "./chat.js";
import { connectTwitch, channelOf } from "./twitch.js";
import { TwitchPoll } from "./twitchpoll.js";

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
      if (m.t === "poll_call" && tw?.poll.stage === "collect") tw.poll.pool.size ? tw.poll.beginVote() : twFeed("The storyteller called the vote, but chat has sent no ideas yet.");
    },
  });
  startPresence(link.request, { kind: "computer" });
  setInterval(() => !link.connected && ($("#conn").textContent = "reconnecting…"), 2000);
}

const send = (m) => link?.send(m);

function render(s) {
  $("#brain").textContent = `director: ${s.director}`;
  const here = peopleSummary(s.people);
  $("#people").hidden = !here;
  $("#people").textContent = `here: ${here}`;
  $("#bible").textContent = s.story.bible;
  // Everything story-shaped on this page is the FOCUSED window's: each window is its own story.
  const many = s.portals.length > 1;
  const win = s.focusId ? `window ${s.focusId}` : "";
  if (document.activeElement !== $("#seedText")) $("#seedText").value = s.story.seed;
  $("#seedTitle").textContent = win ? `World of ${win} (focused)` : "World of the next window";
  $("#sayTitle").textContent = !win
    ? "Tell the story (no window open: your line becomes the next window's world)"
    : s.story.seed ? `Tell the story (goes to ${win})` : `What world is behind ${win}? (your line defines it)`;
  $("#suggTitle").textContent =
    (many ? `▶ Use steers ${win}, the focused one. ` : "▶ Use sends an idea into the story, ✕ removes it. ") +
    (s.meta?.crowd ? "Crowd Mode is on: the top idea plays every 20 s." : "");
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
        .map((l) => `<li><b>${esc(l.kind)}${many && l.portal ? ` · ${esc(l.portal)}` : ""}</b>${esc(l.text)}</li>`)
        .join("")
    : `<li class="muted">Nothing yet. Open a window in the headset and start telling the story.</li>`;

  renderChat(s);

  const box = $("#portals");
  if (box.querySelector("textarea:focus")) return; // don't clobber a prompt being typed
  const drafts = {}; // unsent override prompts survive the re-render
  for (const t of box.querySelectorAll("textarea")) if (t.value) drafts[t.dataset.id] = t.value;
  box.className = s.portals.length ? "" : "empty";
  box.innerHTML = s.portals.length
    ? s.portals
        .map(
          (p) => `<div class="sugg" style="display:block">
        <div class="row" style="justify-content:space-between"><strong>Portal ${esc(p.id)}${p.id === s.focusId ? " · focused" : ""}</strong>
          <span class="pill">${esc(p.status)}</span></div>
        <p style="margin:.4rem 0;font-style:italic">${esc(s.threads?.[p.id]?.seed) || "<span class='muted'>No world yet: asking “what world is behind this window?”</span>"}</p>
        <p class="muted" style="margin:.4rem 0">${esc(p.prompt) || (s.threads?.[p.id]?.seed ? "<em>waiting for the director…</em>" : "")}</p>
        <textarea data-id="${esc(p.id)}" placeholder="Override this portal's prompt (exact Orbis prompt)"></textarea>
        <div class="row" style="justify-content:space-between;margin-top:.4rem">
          <span class="row"><button class="ghost" data-focus="${esc(p.id)}">Focus</button>
          <button class="ghost" data-close="${esc(p.id)}">Close</button></span>
          <button data-apply="${esc(p.id)}">Send prompt</button></div></div>`,
        )
        .join("")
    : "No portals yet. Open one in the headset.";
  for (const t of box.querySelectorAll("textarea")) t.value = drafts[t.dataset.id] || "";
}

// ---------- Audience ideas as a stream chat, with moderator buttons (Use / ✕) on each line ----------
const seenIdeas = new Set();
let pinnedHtml = "", firstIdeas = true;
const updateLog = stickyLog($("#suggs"), $("#jump"));
const modButtons = (x) =>
  `<span class="mod"><button data-use="${esc(x.id)}" title="Use this idea in the story" aria-label="Use: ${esc(x.text)}">▶</button><button data-dismiss="${esc(x.id)}" title="Remove" aria-label="Remove: ${esc(x.text)}">✕</button></span>`;
function renderChat(s) {
  const sug = s.suggestions || [];
  const topIdea = topIdeaOf(sug);
  const label = s.meta?.crowd ? "⏭ Up next" : "📌 Top idea";
  $("#suggCount").textContent = sug.length ? `· ${sug.length}` : "";
  const who = (x) => `<b class="who">${esc(x.by || "Someone")}</b><span class="colon">:</span> <span class="text">${esc(x.text)}</span>`;
  const votes = (x) => `<span class="vote" title="${x.voters.length} vote${x.voters.length === 1 ? "" : "s"}">▲ ${x.voters.length}</span>`;
  const html = sug.length
    ? [...sug]
        .sort((a, b) => a.at - b.at)
        .map((x) => {
          const fresh = !firstIdeas && !seenIdeas.has(x.id) ? " fresh" : "";
          const chip = x === topIdea ? `<span class="chip top" title="${label}">${s.meta?.crowd ? "⏭" : "🔥"}</span>` : "";
          return `<div class="msg${x === topIdea ? " is-top" : ""}${fresh}" style="--hue:${hueOf(x.by || "Someone")}"><span class="ts">${clock(x.at)}</span>${modButtons(x)}${chip}${who(x)}${votes(x)}</div>`;
        })
        .join("")
    : `<div class="chatWelcome">No ideas yet. Share the watch link so people can suggest what happens next and vote.</div>`;
  const pin = topIdea
    ? `<div class="pinLabel">${label} · ${topIdea.voters.length} votes</div>
       <div class="pinBody" style="--hue:${hueOf(topIdea.by || "Someone")}">${modButtons(topIdea)}${who(topIdea)}</div>`
    : "";
  if (pin !== pinnedHtml) {
    $("#pinned").innerHTML = pinnedHtml = pin;
    $("#pinned").hidden = !pin;
  }
  const hasNew = sug.some((x) => !seenIdeas.has(x.id));
  for (const x of sug) seenIdeas.add(x.id);
  updateLog(html, { hasNew });
  firstIdeas = false;
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
    if (ta?.value.trim()) send({ t: "manual_prompt", id: b.dataset.apply, prompt: ta.value.trim() }), (ta.value = "");
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

// ---------- Twitch chat: ideas, then a vote on 5 of them; the winner is the next story line ----------
const TW_KEY = "lw.twitchChannel";
const store = (k, v) => {
  try {
    return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v);
  } catch {
    return null;
  }
};
$("#twChannel").value = store(TW_KEY) || "mini_sonrixs";
let tw = null; // { chat, poll, channel }
let twPushed = "", twPushAt = 0;
async function shortenIdeas(texts) {
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: "shorten", room, cred: credFor(room), texts }),
  });
  return (await r.json()).labels;
}
function twFeed(line) {
  const box = $("#twFeed");
  box.insertAdjacentHTML("beforeend", `<div>${line}</div>`);
  while (box.children.length > 40) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function twPush(force = false) {
  if (!tw) return;
  const snap = JSON.stringify(tw.poll.snapshot(tw.channel));
  if (snap === twPushed || (!force && Date.now() - twPushAt < 1000)) return;
  twPushed = snap;
  twPushAt = Date.now();
  send({ t: "poll", poll: JSON.parse(snap) });
}
function twRender() {
  const p = tw?.poll;
  $("#twGo").textContent = tw ? "Disconnect" : "Connect";
  $("#twChannel").disabled = Boolean(tw);
  if (!p) return ($("#twStage").textContent = ""), ($("#twOptions").innerHTML = "");
  const left = Math.max(0, Math.ceil((p.ends - Date.now()) / 1000));
  $("#twStage").textContent =
    p.stage === "collect" ? `Collecting ideas · ${p.pool.size} so far · vote in ${left} s`
    : p.stage === "choosing" ? "Drawing 5 ideas…"
    : p.stage === "vote" ? `Voting · ${left} s left · ${p.votes.size} votes · ${p.pool.size} ideas waiting for the next round`
    : "";
  const t = p.tally();
  $("#twOptions").innerHTML = p.options
    .map((x, i) => `<li><b>${esc(x.short)}</b> <span class="muted">— ${esc(x.text)} (${esc(x.by)}${x.supporters > 1 ? ` +${x.supporters - 1}` : ""})</span> <span class="pill">▲ ${t[i]}</span></li>`)
    .join("");
  $("#twNow").disabled = p.stage !== "collect" || p.pool.size === 0;
  $("#twEnd").disabled = p.stage !== "vote";
}
function twConnect() {
  const channel = channelOf($("#twChannel").value);
  if (!channel || !link) return;
  store(TW_KEY, channel);
  $("#twChannel").value = channel;
  const poll = new TwitchPoll({
    collectSec: Number($("#twCollect").value) || 45,
    voteSec: Number($("#twVote").value) || 25,
    shorten: shortenIdeas,
    onChange: () => (twRender(), twPush(true)),
    onWinner(w) {
      send({ t: "poll_win", text: w.text, by: w.by });
      twFeed(`<b>🏆 ${esc(w.short)}</b> (${w.votes} votes) → ${esc(w.text)}`);
    },
  });
  const chat = connectTwitch(channel, {
    onStatus: (st) => ($("#twStatus").textContent = st),
    onMessage(m) {
      const kind = poll.handle(m);
      if (kind) twFeed(`<span style="color:${esc(m.color || "inherit")}">${esc(m.user)}</span>: ${esc(m.text)}`);
    },
  });
  tw = { chat, poll, channel };
  poll.start();
}
function twDisconnect() {
  tw?.chat.close();
  tw = null;
  twPushed = "";
  send({ t: "poll", poll: null });
  $("#twStatus").textContent = "off";
  twRender();
}
$("#twForm").addEventListener("submit", (e) => {
  e.preventDefault();
  tw ? twDisconnect() : twConnect();
});
for (const id of ["twCollect", "twVote"])
  $(`#${id}`).addEventListener("change", () => {
    if (!tw) return;
    tw.poll.collectSec = Number($("#twCollect").value) || 45;
    tw.poll.voteSec = Number($("#twVote").value) || 25;
  });
$("#twNow").addEventListener("click", () => tw?.poll.stage === "collect" && tw.poll.beginVote());
$("#twEnd").addEventListener("click", () => tw?.poll.endVote());
setInterval(() => {
  if (!tw) return;
  tw.poll.tick();
  twRender();
  twPush();
}, 500);
twRender();
// `?debug`: fake chat lines for a dry run without Twitch, e.g. twSay("ann", "!idea a whale sings").
if (new URLSearchParams(location.search).has("debug")) window.twSay = (user, text) => tw?.poll.handle({ user, text });

start();
