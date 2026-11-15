// app/story.js: direction, crowd mode, snapshots, touching the world, idea cards, the world question, reset / new story.
import * as THREE from "three";
import { stopSides } from "./wide.js";
import { credFor } from "../identity.js";
import { hueOf, topIdeaOf, nextIdeaOf } from "../chat.js";
import { LAYER } from "../layers.js";
import { $, camera, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM, send } from "./room.js";
import { buzz, flash } from "./feedback.js";
import { buddy, buddyIdle, buddyChangesWorld, buddyReply } from "./buddy.js";
import { syncButtons, toolbar } from "./buttons.js";
import { closeWindow, getWindow, immersion } from "./portals.js";
import { liveViewers } from "./livecast.js";
import { steerSides } from "./wide.js";

// Crowd Mode: the room keeps a shared countdown (roomState.crowdAt, a new round every 10 s) that every
// screen shows; when it runs out, the headset plays the top-voted idea as the next story beat. The
// message names the idea and who suggested it: inside a world the cards are hidden, so this is the
// only place the storyteller sees a friend's idea arrive. Busy (talking, asking)? It plays right after.
// Head start: about as long as the director usually takes (~6 s), before the countdown ends, the headset asks
// the server to prepare the leading idea. If it still leads at zero and the story hasn't moved on, the
// scene changes at once; if the prepared answer is still on its way, the headset waits for it rather
// than asking twice. Sent on its own (not through the message queue) so nothing else waits behind it.
const HEAD_START_MS = 6000;
let playedRound = 0, playedAt = 0, prep = null;
function prepareIdea(round, id) {
  const p = { round, id, settled: false };
  p.done = fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: "prepare_suggestion", id, room: ROOM, cred: credFor(ROOM) }),
  })
    .catch(() => null)
    .finally(() => (p.settled = true));
  prep = p;
}
setInterval(() => {
  const rs = state.roomState;
  toolbar.setCountdown(rs?.meta?.crowd && rs.suggestions?.length ? rs.crowdAt || 0 : 0);
  if (state.retired || state.talking || state.wantTalk || !rs?.meta?.crowd || !rs.suggestions?.length) return;
  if (!rs.story?.seed || !rs.crowdAt) return; // the idea steers the window's story, which needs a world first
  const now = Date.now(), top = nextIdeaOf(rs.suggestions);
  if (now < rs.crowdAt) {
    if (now >= rs.crowdAt - HEAD_START_MS && prep?.round !== rs.crowdAt) prepareIdea(rs.crowdAt, top.id);
    return;
  }
  if (playedRound === rs.crowdAt && now - playedAt < 5000) return; // just sent (retry if it didn't take)
  if (prep?.round === rs.crowdAt && prep.id === top.id && !prep.settled && now - rs.crowdAt < 10000) return; // almost ready
  playedRound = rs.crowdAt; // once per round, even before the server's new round arrives
  playedAt = now;
  rs.suggestions = rs.suggestions.filter((x) => x.id !== top.id);
  send({ t: "use_suggestion", id: top.id }); // by id, so the message names the idea actually used
  refreshCards();
  flash(`“${top.text}”, ${top.by ? `${top.by}'s idea` : "the crowd's pick"}`, 4000);
}, 250);

// Keep the room marked "live" for the community page.
setInterval(() => !state.retired && send({ t: "heartbeat" }), 30000);

// A small snapshot of the window so watchers and the gallery can see the story (no extra credits).
// The frame is grabbed with createImageBitmap (asynchronous, no readback on this thread) and compressed to
// JPEG in a worker (snapworker.js), so taking snapshots never stalls a frame in the headset, where a dropped
// frame shows as judder. Older browsers fall back to a canvas and toBlob.
const snapWorker = (() => {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") return null;
  try {
    return new Worker(new URL("../snapworker.js", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
})();
const snapCanvas = Object.assign(document.createElement("canvas"), { width: 480, height: 270 });
let snapBusy = false, snapNext = 0, snapAt = 0;
function postSnap(data) {
  fetch("/api/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), data }),
  }).catch(() => {});
}
snapWorker?.addEventListener("message", ({ data }) => {
  snapBusy = false;
  if (data?.data) postSnap(data.data);
});
setInterval(() => {
  const now = performance.now();
  if (snapBusy && now - snapAt > 5000) snapBusy = false; // a lost frame or worker reply must not stop snapshots
  if (!state.started || state.retired || snapBusy || now < snapNext) return; // not before the app has finished loading
  const w = getWindow();
  if (!w || w.stream.status !== "streaming" || w.stream.video.readyState < 2) return;
  // While friends watch on pictures (not on the live video, see livecast.js), the window refreshes about once
  // a second. Watching live needs no fast pictures.
  const watchers = (state.roomState?.people || []).filter((x) => x.role !== "owner").length;
  const watched = watchers > liveViewers();
  // Every 3 s on a flat screen, every 6 s in the headset; ~1 s while watched on pictures.
  snapNext = now + (watched ? (renderer.xr.isPresenting ? 1200 : 1000) : renderer.xr.isPresenting ? 6000 : 3000) - 50;
  snapBusy = true;
  snapAt = now;
  if (snapWorker) {
    createImageBitmap(w.stream.video, { resizeWidth: 480, resizeHeight: 270, resizeQuality: "low" })
      .then((bitmap) => snapWorker.postMessage({ bitmap }, [bitmap]))
      .catch(() => (snapBusy = false));
    return;
  }
  snapCanvas.getContext("2d").drawImage(w.stream.video, 0, 0, 480, 270);
  snapCanvas.toBlob(
    (blob) => {
      if (!blob) return void (snapBusy = false);
      const reader = new FileReader();
      reader.onload = () => {
        snapBusy = false;
        postSnap(reader.result);
      };
      reader.onerror = () => (snapBusy = false);
      reader.readAsDataURL(blob);
    },
    "image/jpeg",
    0.62,
  );
}, 250);

export function applyDirection({ narration, prompt, choices, companion }) {
  showChoices(choices || []);
  // The companion and the story are one mind: the same answer may carry its reply. One voice at a time.
  const replied = Boolean(companion?.reply && buddy.visible);
  if (replied) {
    buddyReply(companion, !narration);
    if (typeof companion.world === "string") buddyChangesWorld(companion.world);
  } else if (buddy.listening) buddyIdle();
  const w = getWindow();
  if (w && prompt) {
    if (w.stream.status === "idle") w.stream.start(prompt);
    else w.stream.steer(prompt);
    steerSides(prompt); // Wide view: the left and right views follow the story too
  }
  if (narration) {
    if (w) {
      w.portal._lastStory = narration;
      if (w.stream.status === "streaming") w.portal.setCaption(narration, "story");
    }
    flash(narration, 5000);
  }
}

// ---------- Interaction: touch the world, pick what happens next, characters speak ----------
const touchCanvas = Object.assign(document.createElement("canvas"), { width: 512, height: 288 });
let lastTouch = 0;
export function touchPortal(portal, uv, point) {
  const stream = getWindow()?.stream;
  const v = stream?.video;
  if (!v || stream.status !== "streaming" || v.readyState < 2) return flash("This world is still forming…");
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
  send({ t: "touch", image: touchCanvas.toDataURL("image/jpeg", 0.75) });
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
    .map((x) => ({ kind: "crowd", id: x.id, text: x.text, by: x.by || "", votes: x.voters.length, at: x.at }));
  // Shown like a stream chat: the most-voted ideas, newest on top; the one that plays next is marked.
  // The marked line: in Crowd Mode the idea the countdown will play, otherwise the clear leader.
  const sugs = state.roomState?.suggestions || [];
  const lead = state.roomState?.meta?.crowd ? nextIdeaOf(sugs) : topIdeaOf(sugs);
  for (const c of crowd) c.top = c.id === lead?.id;
  crowd.sort((a, b) => b.at - a.at); // newest at the top
  const director = renderer.xr.isPresenting ? [] : directorChoices.map((text, index) => ({ kind: "choice", index, text }));
  const next = [...crowd, ...director].slice(0, 3);
  const key = JSON.stringify(next);
  if (key === cardsKey) return; // state arrives often; only redraw when something changed
  cardsKey = key;
  cards = next;
  toolbar.setChoices(cards.map((c) => (c.kind === "crowd" ? { text: c.text, by: c.by, votes: c.votes, top: c.top } : c.text)));
  const clean = (s) => String(s).replace(/[&<>"]/g, "");
  $("#choices").innerHTML = cards
    .map((c, i) =>
      c.kind === "crowd"
        ? `<button data-choice="${i}" class="crowd${c.top ? " top" : ""}" style="--hue:${hueOf(c.by || "Someone")}"><b>${c.top ? "🔥 " : ""}${clean(c.by || "Someone")}</b>: ${clean(c.text)}<span class="v">▲ ${c.votes}</span></button>`
        : `<button data-choice="${i}">${clean(c.text)}</button>`,
    )
    .join("");
}
export function pickChoice(i) {
  const c = cards[i];
  if (!c) return;
  if (c.kind === "crowd") {
    // Hide it now; the server removes it and the director turns it into the next beat.
    if (!getWindow()) return flash("Open the window first: an idea steers its story.");
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


// ---------- Reset and New story ----------
// One tap arms the button, which then reads "Tap again to confirm" until you do (or press any
// other button, or Esc). No timer: a toast that vanishes is easy to miss in the headset.
function confirmTap(what) {
  if (state.armed === what || !getWindow()) return (state.armed = null), syncButtons(), true; // nothing open: nothing to lose
  state.armed = what;
  syncButtons(); // show the confirm state right away, not on the next frame
  flash(`This closes the window and forgets the story. Tap ${what === "reset" ? "Reset story" : "New story"} again to confirm.`, 600000);
  return false;
}
export function disarm() {
  if (!state.armed) return;
  state.armed = null;
  syncButtons();
  flash("Cancelled.", 1500);
}
/** Reset: the window closes and the story, ideas and seed are forgotten. */
export function resetPressed() {
  if (!confirmTap("reset")) return true; // waiting for the second tap: the menu stays open
  send({ t: "reset_story" });
  flash("Clearing the story…", 4000);
}
/** New story: a reset; the next window gets its world from whatever you ask Bonnie for. */
export function newStoryPressed() {
  if (!confirmTap("newstory")) return;
  send({ t: "reset_story" });
  flash("Starting a new story. Tell Bonnie what world you want.", 6000);
}
// The server confirmed a reset: close everything. Nothing of the old story is kept, its seed included.
export function resetLocal({ seed = "" } = {}) {
  state.armed = null;
  syncButtons();
  immersion.reset();
  showChoices([]);
  closeWindow();
  stopSides(); // the wide view's side streams too
  state.pendingSeed = seed;
  flash(seed ? `New story: ${seed}. Open a window to begin.` : "Story cleared. Open a window to begin a new one.", 8000);
}

