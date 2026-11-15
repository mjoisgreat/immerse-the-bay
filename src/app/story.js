// app/story.js: direction, crowd mode, snapshots, touching the world, idea cards, the world question, reset / new story, prepare demo.
import * as THREE from "three";
import { PRESETS } from "../presets.js";
import { CameraView } from "../cameraview.js";
import { credFor } from "../identity.js";
import { LAYER } from "../layers.js";
import { $, camera, listener, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM, send } from "./room.js";
import { buzz, flash } from "./feedback.js";
import { buddy, buddyIdle, buddyOpensWindow, buddyReply } from "./buddy.js";
import { openInFront, syncButtons, toolbar } from "./buttons.js";
import { NARRATOR, guide } from "./guide.js";
import { closePortal, entryOf, immersion, labelFor, portals } from "./portals.js";
import { playVoice, speak } from "./talk.js";
import { steerSides } from "./wide.js";

// Crowd Mode: the audience's top-voted line becomes the next story beat every 20 s. The message
// names the idea and who suggested it: inside a world the cards are hidden, so this is the only
// place the storyteller sees a friend's idea arrive.
setInterval(() => {
  if (state.retired || state.talking || state.wantTalk || state.asking || !state.roomState?.meta?.crowd || !state.roomState.suggestions?.length) return;
  if (!state.roomState.threads?.[state.focusId]?.seed) return; // the idea steers the focused window, which needs a world first
  const top = [...state.roomState.suggestions].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at)[0];
  state.roomState.suggestions = state.roomState.suggestions.filter((x) => x.id !== top.id);
  send({ t: "use_suggestion", id: top.id }); // by id, so the message names the idea actually used
  refreshCards();
  flash(`“${top.text}”, ${top.by ? `${top.by}'s idea` : "the crowd's pick"}`, 4000);
}, 20000);

// Keep the room marked "live" for the community page.
setInterval(() => !state.retired && send({ t: "heartbeat" }), 30000);

// Small snapshots of each portal so watchers and the gallery can see the story (no extra credits).
// One window per tick, encoded asynchronously (toBlob), so it never stalls a frame in the headset;
// less often while you're in the headset, where a dropped frame shows as judder.
const snapCanvas = Object.assign(document.createElement("canvas"), { width: 480, height: 270 });
let snapTurn = 0, snapBusy = false, snapNext = 0;
setInterval(() => {
  if (state.retired || snapBusy || performance.now() < snapNext) return;
  const live = [...portals].filter(([, p]) => p.stream.status === "streaming" && p.stream.video.readyState >= 2);
  if (!live.length) return;
  const [id, p] = live[snapTurn++ % live.length];
  // Every 3 s on a flat screen; in the headset each window about every 6 s.
  snapNext = performance.now() + (renderer.xr.isPresenting ? 6000 / live.length : 3000 / live.length) - 50;
  snapBusy = true;
  snapCanvas.getContext("2d").drawImage(p.stream.video, 0, 0, 480, 270);
  snapCanvas.toBlob(
    (blob) => {
      if (!blob) return void (snapBusy = false);
      const reader = new FileReader();
      reader.onload = () => {
        snapBusy = false;
        fetch("/api/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), id, data: reader.result }),
        }).catch(() => {});
      };
      reader.onerror = () => (snapBusy = false);
      reader.readAsDataURL(blob);
    },
    "image/jpeg",
    0.62,
  );
}, 250);

export function applyDirection({ portal_id, narration, updates, choices, speech, companion }) {
  if (state.guideStep === 1 && state.roomState?.log?.some((l) => ["voice", "choice", "guest", "crowd"].includes(l.kind))) setTimeout(() => guide(2), 6000);
  showChoices(choices || []);
  // The companion and the story are one mind: the same answer may carry its reply. One voice at a time.
  const replied = Boolean(companion?.reply && buddy.visible);
  if (replied) {
    buddyReply(companion, !narration);
    if (typeof companion.open_window === "string") buddyOpensWindow(companion);
  } else if (buddy.listening) buddyIdle();
  if (speech?.line && !replied) playVoice(speech);
  for (const u of updates) {
    const p = portals.get(u.portal_id);
    if (!p) continue;
    if (p.stream.status === "idle") p.stream.start(u.prompt);
    else p.stream.steer(u.prompt);
    steerSides(u.portal_id, u.prompt); // Wide view: the left and right views follow the story too
  }
  if (narration) {
    // The line belongs to the window whose story it is, which may not be the focused one any more.
    const target = portals.get(portal_id) || portals.get(state.focusId) || portals.values().next().value;
    if (target) {
      target.portal._lastStory = narration;
      if (target.stream.status === "streaming") target.portal.setCaption(narration, "story");
    }
    flash(narration, 5000);
  }
}

// ---------- Interaction: touch the world, pick what happens next, characters speak ----------
const touchCanvas = Object.assign(document.createElement("canvas"), { width: 512, height: 288 });
let lastTouch = 0;
export function touchPortal(portal, uv, point) {
  const entry = entryOf(portal);
  const v = entry?.stream.video;
  if (!v || entry.stream.status !== "streaming" || v.readyState < 2) return flash("This world is still forming…");
  if (performance.now() - lastTouch < 4000) return flash("The world is still answering your last touch…");
  lastTouch = performance.now();
  const g = touchCanvas.getContext("2d");
  g.drawImage(v, 0, 0, 512, 288);
  const x = uv.x * 512, y = (1 - uv.y) * 288;
  g.strokeStyle = "#ff3df0";
  g.shadowColor = "#ff3df0";
  g.shadowBlur = 12;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(x, y, 22, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  send({ t: "touch", id: portal.id, image: touchCanvas.toDataURL("image/jpeg", 0.75) });
  if (point) ripple(point);
  buzz(0.35, 40);
  flash("You reach into the world…", 6000);
}
export function touchWorld(origin, dir) {
  const uv = immersion.uvFromDirection(dir);
  if (!uv) return flash("Nothing to touch there; reach toward the scene.");
  touchPortal(immersion.portal, uv, origin.addScaledVector(dir, 3));
}

// A glowing ring where you touched, expanding and fading.
const ripples = [];
function ripple(point) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.075, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  m.position.copy(point);
  m.lookAt(camera.getWorldPosition(new THREE.Vector3()));
  m.renderOrder = LAYER.RIPPLE;
  m.userData.born = performance.now();
  scene.add(m);
  ripples.push(m);
}
export function updateRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const m = ripples[i], age = (performance.now() - m.userData.born) / 900;
    m.scale.setScalar(1 + age * 4);
    m.material.opacity = Math.max(0, 1 - age);
    if (age >= 1) scene.remove(m), m.geometry.dispose(), m.material.dispose(), ripples.splice(i, 1);
  }
}

// "What happens next?" cards: the audience's top-voted ideas first (with who suggested them and
// how many votes they have), then the director's options, three cards at most. Friends playing
// along on their phones become visible to the storyteller, who picks with a pinch.
// In the headset the story is steered by voice only: the director's own options are not shown there
// (a friend's idea still is, since a friend chose to send it). The desktop screen keeps them.
const MAX_CROWD_CARDS = 3;
let directorChoices = [];
let cards = []; // [{ kind: "crowd", id, text, by, votes } | { kind: "choice", index, text }]
let cardsKey = "";
export function showChoices(list) {
  directorChoices = list || [];
  refreshCards();
}
export function refreshCards() {
  const crowd = [...(state.roomState?.suggestions || [])]
    .sort((a, b) => b.voters.length - a.voters.length || a.at - b.at)
    .slice(0, MAX_CROWD_CARDS)
    // With more than one window open, each idea card says which window it will steer: the focused one.
    .map((x) => ({ kind: "crowd", id: x.id, text: x.text, by: x.by || "", votes: x.voters.length, to: portals.size > 1 ? state.focusId : null }));
  const director = renderer.xr.isPresenting ? [] : directorChoices.map((text, index) => ({ kind: "choice", index, text }));
  const next = [...crowd, ...director].slice(0, 3);
  const key = JSON.stringify(next);
  if (key === cardsKey) return; // state arrives often; only redraw when something changed
  cardsKey = key;
  cards = next;
  toolbar.setChoices(cards.map((c) => (c.kind === "crowd" ? { text: c.text, by: c.by, votes: c.votes, to: c.to } : c.text)));
  const clean = (s) => String(s).replace(/[&<>"]/g, "");
  $("#choices").innerHTML = cards
    .map((c, i) =>
      c.kind === "crowd"
        ? `<button data-choice="${i}" class="crowd"><small>${clean(c.by || "A friend")} · ▲ ${c.votes}${c.to ? ` · → window ${clean(c.to)}` : ""}</small>${clean(c.text)}</button>`
        : `<button data-choice="${i}">${clean(c.text)}</button>`,
    )
    .join("");
}
export function pickChoice(i) {
  const c = cards[i];
  if (!c) return;
  if (c.kind === "crowd") {
    // Hide it now; the server removes it and the director turns it into the next beat.
    if (!portals.has(state.focusId)) return flash("Open a window first: an idea steers the window you're looking at.");
    if (state.roomState) state.roomState.suggestions = (state.roomState.suggestions || []).filter((x) => x.id !== c.id);
    showChoices([]);
    send({ t: "use_suggestion", id: c.id });
    flash(`“${c.text}”${c.by ? `, ${c.by}'s idea` : ""}`, 4000);
  } else {
    showChoices([]);
    send({ t: "choose", index: c.index });
    flash(`“${c.text}”`, 4000);
  }
}
// Entering or leaving the headset changes which cards may show.
for (const ev of ["sessionstart", "sessionend"]) renderer.xr.addEventListener(ev, () => ((cardsKey = ""), refreshCards()));
$("#choices").addEventListener("click", (e) => {
  const b = e.target.closest("[data-choice]");
  if (b) pickChoice(Number(b.dataset.choice));
});

// ---------- The world question ----------
// "What world is this story set in?" (New story) and "What world is behind this window?" (every
// new window). Answer by voice (hold to talk) or by typing; skip it and the first thing you say
// defines the world instead. Nothing is ever taken from an earlier story.
export const ASK = { story: "What world is this story set in?", portal: "What world is behind this window?" };
export function askWorld(kind, id = null) {
  state.asking = { kind, id };
  $("#askQ").textContent = ASK[kind];
  $("#ask").hidden = false;
  const xr = renderer.xr.isPresenting;
  if (id) portals.get(id)?.portal.setCaption(ASK.portal, "status");
  flash(`${ASK[kind]} ${xr ? "Raise a hand to your mouth (or hold A) and say it." : CameraView.touch ? "Type it, or hold 🎙 and say it." : "Type it, or hold Space and say it."}`, 600000);
  if (xr) speak(ASK[kind], ...NARRATOR);
  else if ($("#overlay").hidden) $("#askText").focus();
}
export function clearAsk(quiet = false) {
  if (!state.asking) return;
  state.asking = null;
  $("#ask").hidden = true;
  $("#askText").value = "";
  if (quiet) flash("", 1);
}
export function answerWorld(text) {
  const a = state.asking;
  text = String(text || "").trim();
  if (!a || !text) return;
  clearAsk();
  flash(`“${text}”`, 5000);
  if (a.kind === "portal" && portals.has(a.id)) {
    portals.get(a.id).portal.setCaption("The world is forming…", "status");
    return send({ t: "set_seed", id: a.id, seed: text });
  }
  // A new story: its first window opens onto the world just named.
  for (const id of [...portals.keys()]) closePortal(id);
  send({ t: "set_seed", seed: text });
  state.pendingSeed = text;
  openInFront();
}
export function skipWorld() {
  if (!state.asking) return;
  clearAsk();
  flash("No world chosen. The first thing you say will become the world.", 7000);
}
$("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  answerWorld($("#askText").value);
});
$("#askSkip").onclick = skipWorld;

// ---------- Reset and New story ----------
// One tap arms the button, which then reads "Tap again to confirm" until you do (or press any
// other button, or Esc). No timer: a toast that vanishes is easy to miss in the headset.
function confirmTap(what) {
  if (state.armed === what || !portals.size) return (state.armed = null), syncButtons(), true; // nothing open: nothing to lose
  state.armed = what;
  syncButtons(); // show the confirm state right away, not on the next frame
  flash(`This closes every window and forgets the story. Tap ${what === "reset" ? "Reset story" : "New story"} again to confirm.`, 600000);
  return false;
}
export function disarm() {
  if (!state.armed) return;
  state.armed = null;
  syncButtons();
  flash("Cancelled.", 1500);
}
/** Reset: every window closes and every story, idea and seed is forgotten. */
export function resetPressed() {
  if (!confirmTap("reset")) return true; // waiting for the second tap: the menu stays open
  clearAsk();
  send({ t: "reset_story" });
  flash("Clearing the story…", 4000);
}
/** New story: a reset, then "what world is this story set in?". */
export function newStoryPressed() {
  if (!confirmTap("newstory")) return;
  clearAsk();
  send({ t: "reset_story", ask: true });
  flash("Starting a new story…", 4000);
}
// The server confirmed a reset: close everything. Nothing of the old story is kept, its seed included.
export function resetLocal({ ask = false, open = false, seed = "" } = {}) {
  state.armed = null;
  syncButtons();
  immersion.reset();
  clearAsk();
  showChoices([]);
  for (const id of [...portals.keys()]) closePortal(id);
  state.pendingSeed = seed;
  if (open) return openInFront(), flash(seed ? `A new story begins: ${seed}` : "A new story begins.", 6000);
  if (ask) return askWorld("story");
  flash(seed ? `New story: ${seed}. Open a window to begin.` : "Story cleared. Open a window to begin a new one.", 8000);
}

// ---------- Prepare demo ----------
// One tap before the headset goes on: a fresh story in a chosen world with its first window
// already opening, because a window needs 20-30 s to reach video.
let demoWatch = 0;
function prepareDemo(seed) {
  state.armed = null;
  clearAsk();
  send({ t: "reset_story", seed, open: true });
  const el = $("#demoStatus");
  const began = performance.now();
  clearInterval(demoWatch);
  demoWatch = setInterval(() => {
    const p = portals.values().next().value;
    const secs = Math.round((performance.now() - began) / 1000);
    if (p?.stream.status === "streaming") {
      clearInterval(demoWatch);
      el.textContent = `Demo ready: window ${p.portal.id} is live (took ${secs} s). Put the headset on and enter.`;
    } else el.textContent = `Preparing the demo… ${p ? labelFor(p.stream.status === "idle" ? "connecting" : p.stream.status) || "starting" : "resetting the room"} (${secs} s)`;
  }, 500);
}
$("#demoSeed").innerHTML =
  PRESETS.map(([label, seed]) => `<option value="${seed.replace(/"/g, "&quot;")}">${label}</option>`).join("") + `<option value="">Ask me (no world chosen)</option>`;
$("#demo").addEventListener("submit", (e) => {
  e.preventDefault();
  if (listener.context.state === "suspended") listener.context.resume();
  const seed = $("#demoSeed").value;
  if (seed) return prepareDemo(seed);
  // No world chosen: a clean room that asks for one.
  send({ t: "reset_story", ask: true });
  $("#demoStatus").textContent = "Room cleared. The headset will ask what world the story is set in.";
});
