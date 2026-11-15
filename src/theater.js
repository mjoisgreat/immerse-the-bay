import QRCode from "qrcode";
import { createLink } from "./link.js";
import { urlRoom, cleanRoom, esc } from "./identity.js";
import { peopleSummary, startPresence } from "./people.js";
import { hueOf, topIdeaOf, nextIdeaOf, countdownHtml, countdownBar, startCountdowns } from "./chat.js";

// Full-screen spectator view for a TV or projector next to the headset (no controls, just the show).
const $ = (s) => document.querySelector(s);

const room = urlRoom;
if (!room) {
  $("#gate").hidden = false;
  $("#gate").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = cleanRoom($("#gateRoom").value);
    if (r) location.search = `?room=${r}`;
  });
} else start();

function start() {
  $("#stage").hidden = false;
  $("#start").hidden = false;
  $("#start").onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});
  document.addEventListener("fullscreenchange", () => ($("#start").hidden = Boolean(document.fullscreenElement)));

  const watchUrl = `${location.origin}/watch.html?room=${room}`;
  QRCode.toDataURL(watchUrl, { margin: 1, width: 440, color: { dark: "#07080d", light: "#ffffff" } }).then((d) => ($("#qr").src = d));

  let state = null;
  let snap = null;
  let speechTimer;

  const link = createLink(room, {
    onMessage(m) {
      if (m.t === "state") {
        const first = !state;
        state = m;
        render();
        if (first) {
          // Show the latest line and dialogue straight away.
          const log = m.log || [];
          const lastDir = [...log].reverse().find((l) => l.kind === "director");
          if (lastDir) setNarration(lastDir.text.replace(/\s*\(\d+ ms.*\)$/, ""));
          const lastSpeech = [...log].reverse().find((l) => l.kind === "speech");
          if (lastSpeech) {
            const [speaker, ...rest] = lastSpeech.text.split(": ");
            showSpeech({ speaker, line: rest.join(": ") });
          }
        }
      }
      if (m.t === "direction") {
        if (m.narration) setNarration(m.narration);
        if (m.speech?.line) showSpeech(m.speech);
        if (m.companion?.reply) showSpeech({ speaker: m.companion.name, line: m.companion.reply });
        if (m.choices) renderChoices(m.choices);
      }
    },
  });

  startPresence(link.request, { kind: "screen" }); // the big screen counts as someone watching

  let narrTimer;
  // Only touch the DOM when the markup changed (re-setting identical <img> markup reloads the pictures).
  function setHtml(sel, html) {
    const el = $(sel);
    if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
  }

  function setNarration(text) {
    const el = $("#narration");
    el.style.opacity = 0;
    clearTimeout(narrTimer); // a newer line replaces one still fading out
    narrTimer = setTimeout(() => ((el.textContent = text), (el.style.opacity = 1)), 400);
  }

  function showSpeech({ speaker, line }) {
    $("#speaker").textContent = speaker;
    $("#line").textContent = line;
    $("#speech").classList.add("on");
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => $("#speech").classList.remove("on"), 14000);
  }

  let choicesKey = "";
  function renderChoices(list) {
    const key = JSON.stringify(list);
    if (key === choicesKey) return; // same options: re-rendering would replay the pop-in animation
    choicesKey = key;
    $("#choices").innerHTML = list.length
      ? `<span class="label">What happens next?</span>` + list.map((c) => `<span class="choice">${esc(c)}</span>`).join("")
      : "";
  }

  function render() {
    const s = state;
    $("#title").textContent = s.meta?.title || "";
    document.title = `${s.meta?.title || room} · Living Window Theater`;
    const live = Date.now() - (s.lastActive || 0) < 60_000;
    $("#live").textContent = live ? "● LIVE" : "offline";
    $("#live").className = live ? "pill live" : "pill";
    const here = peopleSummary(s.people);
    $("#people").hidden = !here;
    $("#people").textContent = `here: ${here}`;
    $("#inside").hidden = !s.immersed;
    renderChoices(s.choices || []);
    renderChat(s);
    renderSnaps();
  }

  // ---------- Audience ideas as a Twitch-style chat overlay (read-only: the TV just shows the stream) ----------
  const seenIdeas = new Set();
  let firstIdeas = true;
  startCountdowns();
  function renderChat(s) {
    const sug = s.suggestions || [];
    const crowd = Boolean(s.meta?.crowd);
    const top = crowd ? nextIdeaOf(sug) : topIdeaOf(sug); // in Crowd Mode: the idea the countdown will play
    const label = crowd ? `⏭ Up next in ${countdownHtml(s)}` : "📌 Top idea";
    $("#suggCount").textContent = sug.length ? `· ${sug.length}` : "";
    const line = (x) => `<b class="who">${esc(x.by || "Someone")}</b>: ${esc(x.text)}<span class="vote">▲ ${x.voters.length}</span>`;
    setHtml("#ideas", sug.length
      ? [...sug]
          .sort((a, b) => a.at - b.at)
          .slice(-30)
          .map((x) => {
            const fresh = !firstIdeas && !seenIdeas.has(x.id) ? " fresh" : "";
            return `<div class="msg${x === top ? " is-top" : ""}${fresh}" style="--hue:${hueOf(x.by || "Someone")}">${x === top ? `<span class="chip">${s.meta?.crowd ? "⏭" : "🔥"}</span>` : ""}${line(x)}</div>`;
          })
          .join("")
      : `<div class="chatWelcome">Scan the code below to suggest what happens next. Ideas show up here.</div>`);
    for (const x of sug) seenIdeas.add(x.id);
    firstIdeas = false;
    setHtml("#pinned", top ? `<div class="pinLabel">${label}</div>${countdownBar(s)}<div style="--hue:${hueOf(top.by || "Someone")}">${line(top)}</div>` : "");
    $("#pinned").hidden = !top;
  }

  // Main screen: the window's live world, cross-fading as new frames arrive.
  let shown = "", front = "imgA";
  function renderSnaps() {
    if (!state) return;
    const has = Boolean(state.window && snap);
    $("#empty").hidden = has;
    if (has && snap !== shown) {
      shown = snap;
      const back = front === "imgA" ? "imgB" : "imgA";
      const img = $(`#${back}`);
      const frame = shown;
      img.onload = () => {
        img.classList.add("on");
        $(`#${front}`).classList.remove("on");
        front = back;
        $("#ambient").style.backgroundImage = `url(${frame})`;
      };
      img.src = frame;
    }
  }

  async function pollSnaps() {
    snap = await fetch(`/api/snapshot?room=${room}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.image)
      .catch(() => snap);
    renderSnaps();
    setTimeout(pollSnaps, document.hidden ? 15000 : 2500);
  }
  pollSnaps();
}
