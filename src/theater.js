import QRCode from "qrcode";
import { createLink } from "./link.js";
import { urlRoom, cleanRoom } from "./identity.js";

// Full-screen spectator view for a TV or projector next to the headset (no controls, just the show).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
  let snaps = {};
  let speechTimer;

  createLink(room, {
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
      if (m.t === "pip") showSpeech({ speaker: "Pip", line: m.line });
      if (m.t === "direction") {
        if (m.narration) setNarration(m.narration);
        if (m.speech?.line) showSpeech(m.speech);
        if (m.choices) renderChoices(m.choices);
      }
    },
  });

  function setNarration(text) {
    const el = $("#narration");
    el.style.opacity = 0;
    setTimeout(() => ((el.textContent = text), (el.style.opacity = 1)), 400);
  }

  function showSpeech({ speaker, line }) {
    $("#speaker").textContent = speaker;
    $("#line").textContent = line;
    $("#speech").classList.add("on");
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => $("#speech").classList.remove("on"), 14000);
  }

  function renderChoices(list) {
    $("#choices").innerHTML = list.length
      ? `<span class="label">What happens next?</span>` + list.map((c) => `<span class="choice">${esc(c)}</span>`).join("")
      : "";
  }

  let choicesKey = "";
  function render() {
    const s = state;
    $("#title").textContent = s.meta?.title || "";
    document.title = `${s.meta?.title || room} · Living Window Theater`;
    const live = Date.now() - (s.lastActive || 0) < 60_000;
    $("#live").textContent = live ? "● LIVE" : "offline";
    $("#live").className = live ? "pill live" : "pill";
    $("#inside").hidden = !s.immersedId;
    const key = JSON.stringify(s.choices || []);
    if (key !== choicesKey) (choicesKey = key), renderChoices(s.choices || []);
    const ideas = [...(s.suggestions || [])].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at).slice(0, 3);
    $("#ideasCard").hidden = !ideas.length;
    $("#ideas").innerHTML = ideas.map((x) => `<div><em>▲ ${x.voters.length}</em><span>${esc(x.text)}</span></div>`).join("");
    renderSnaps();
  }

  // Main screen: the window the storyteller is in (or focused on), cross-fading as new frames arrive.
  let shown = "", front = "imgA";
  function renderSnaps() {
    if (!state) return;
    const ids = (state.portals || []).map((p) => p.id).filter((id) => snaps[id]);
    const mainId = [state.immersedId, state.focusId, ...ids].find((id) => id && snaps[id]);
    $("#empty").hidden = Boolean(mainId);
    if (mainId && snaps[mainId] !== shown) {
      shown = snaps[mainId];
      const back = front === "imgA" ? "imgB" : "imgA";
      const img = $(`#${back}`);
      img.onload = () => {
        img.classList.add("on");
        $(`#${front}`).classList.remove("on");
        front = back;
      };
      img.src = shown;
      $("#ambient").style.backgroundImage = `url(${shown})`;
    }
    $("#thumbs").innerHTML = ids
      .filter((id) => id !== mainId)
      .map((id) => `<div class="thumb"><img alt="Window ${esc(id)}" src="${snaps[id]}"><span>Window ${esc(id)}</span></div>`)
      .join("");
  }

  async function pollSnaps() {
    snaps = await fetch(`/api/snapshot?room=${room}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => snaps);
    renderSnaps();
    setTimeout(pollSnaps, document.hidden ? 15000 : 2500);
  }
  pollSnaps();
}
