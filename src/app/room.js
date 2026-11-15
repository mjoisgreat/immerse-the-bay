// app/room.js: room resolution (the ONLY module with top-level await) and the server link. Leaf: no feature-module imports; main.js fills in `handlers`.
import { createLink } from "../link.js";
import { joinUrl, joinersNarrate, peopleSummary, qrDataUrl, setJoinersNarrate } from "../people.js";
import { urlRoom, lastOwnedRoom, newRoomCode, owned, credFor, voterId, makeOwnerCreds, urlInvite } from "../identity.js";
import { $ } from "./stage.js";
import { state } from "./state.js";

// ---------- Room: each headset owns a private story room ----------
// Visiting with ?room=X: if this browser owns X, drive it; if X is unclaimed, claim it;
// otherwise it's someone else's story, so go and watch it instead (no takeovers).
async function resolveRoom() {
  let room = urlRoom || lastOwnedRoom() || newRoomCode();
  if (owned()[room]) return room;
  const who = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: "whoami", room, cred: credFor(room), voter: voterId }),
  })
    .then((r) => r.json())
    .catch(() => ({}));
  if (who.role === "none") {
    makeOwnerCreds(room);
    return room;
  }
  location.replace(`/watch.html?room=${room}${urlInvite ? `&invite=${urlInvite}` : ""}`);
  return new Promise(() => {}); // page is leaving
}
export const ROOM = await resolveRoom();
{
  // Normalise the address to this room, keeping other settings such as ?companion=pip.
  const q = new URLSearchParams(location.search);
  q.set("room", ROOM);
  q.delete("invite");
  history.replaceState(null, "", `?${q}`);
}
showRoomCard();

function showRoomCard() {
  const c = owned()[ROOM];
  const origin = location.origin;
  $("#roominfo").innerHTML = `
    <div class="kv"><span>Your room</span><b>${ROOM}</b></div>
    <div class="kv"><span>Console code</span><b>${c.pin}</b></div>
    <div class="kv"><span>Here now</span><b id="roompeople">nobody yet</b></div>
    <div style="display:flex;gap:.8rem;align-items:center;margin:.6rem 0">
      <img id="roomqr" alt="QR code: scan to join" width="132" height="132" style="background:#fff;border-radius:8px;padding:4px" />
      <label class="small" style="display:block"><b>Invite friends:</b> scan with a phone camera.<br>
        <input type="checkbox" id="roomnarrate" ${joinersNarrate() ? "checked" : ""} /> Joiners can talk and choose too</label>
    </div>
    <p class="small">On a laptop, open <b>${origin}/console.html</b> and enter the room and code.
    Put the <a href="/theater.html?room=${ROOM}" target="_blank">theater view</a> on a big screen, share
    <a href="/watch.html?room=${ROOM}" target="_blank">the watch link</a> with friends, or browse the
    <a href="/community.html" target="_blank">community</a>.</p>
    <button class="ghost" id="newroom">Start a new room</button>`;
  $("#newroom").onclick = () => location.replace(`/?room=${newRoomCode()}`);
  const drawQr = () =>
    qrDataUrl(joinUrl({ origin, room: ROOM, invite: c.invite, narrate: joinersNarrate() }), 264)
      .then((d) => ($("#roomqr").src = d))
      .catch(() => {});
  $("#roomnarrate").onchange = (e) => (setJoinersNarrate(e.target.checked), drawQr());
  drawQr();
}
/** Who is here now, on the Room info panel. */
export function showPeople(people) {
  const el = $("#roompeople");
  if (el) el.textContent = peopleSummary(people) || "nobody yet";
}

// ---------- Server link ----------
// Identifies this page. If the owner opens the room on a second device/tab, the newest wins.
export const RID = Math.random().toString(36).slice(2, 10);
export function send(m) {
  if (!state.retired) link.send({ ...m, rid: RID });
}

export const handlers = { onOpen: null, onMessage: null }; // filled in by main.js (the handlers call into nearly every feature)
export const link = createLink(ROOM, {
  onOpen: (...a) => handlers.onOpen(...a),
  onMessage: (...a) => handlers.onMessage(...a),
});
