// app/livecast.js: friends watch live. The storyteller's device passes the focused window's video and
// sound on to a few viewers, peer to peer (WebRTC).
//
// Each window's video is a private Reactor session (one viewer per session), so this device, which already
// receives it, is the only place a live copy can come from. A viewer's watch page asks ("join"); this device
// answers with an offer; the viewer answers back; all through the room's relay (see "rtc" in server/core.js).
// Candidates are gathered before sending (no trickle), so it's one message each way.
//
// At most MAX_VIEWERS at once: every live viewer costs this device an encoder (on a Quest, alongside VR).
// Anyone beyond that, or on a network that blocks peer-to-peer, gets the snapshots instead (about once a
// second while anyone is watching, see story.js).
import { state } from "./state.js";
import { portals } from "./portals.js";
import { send } from "./room.js";

export const MAX_VIEWERS = 4;
// Public STUN by default; the server's config adds a TURN relay when one is set (see iceServers, server/api.js).
let ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
fetch("/api/config")
  .then((r) => r.json())
  .then((c) => Array.isArray(c.iceServers) && c.iceServers.length && (ICE_SERVERS = c.iceServers))
  .catch(() => {});
const CONNECT_MS = 25000; // a viewer that hasn't connected by then is dropped
const peers = new Map(); // viewer id -> { pc, video: RTCRtpSender, audio: RTCRtpSender, at, portal }

/** How many viewers are watching live right now. */
export const liveViewers = () => peers.size;

/** Resolves once ICE gathering is complete (or after `ms`), so the description carries its candidates. */
export function iceGathered(pc, ms = 3000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((done) => {
    const t = setTimeout(finish, ms);
    function finish() {
      clearTimeout(t);
      pc.removeEventListener("icegatheringstatechange", check);
      done();
    }
    function check() {
      if (pc.iceGatheringState === "complete") finish();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** The window everyone is looking at, and its live tracks (null until it streams). */
function focused() {
  const id = portals.has(state.focusId) ? state.focusId : portals.keys().next().value;
  const p = portals.get(id);
  return {
    id: id ?? null,
    video: p?.stream.video.srcObject?.getVideoTracks?.()[0] ?? null,
    audio: p?.stream.audioStream?.getAudioTracks?.()[0] ?? null,
  };
}

function drop(id, tell = false) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  try {
    peer.pc.close();
  } catch {}
  if (tell) send({ t: "rtc", kind: "bye", to: id, from: "host" });
}

async function offerTo(viewer) {
  drop(viewer); // a viewer reloading the page asks again: start fresh
  if (peers.size >= MAX_VIEWERS) return send({ t: "rtc", kind: "full", to: viewer, from: "host" });
  const now = focused();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const video = pc.addTransceiver("video", { direction: "sendonly" }).sender;
  const audio = pc.addTransceiver("audio", { direction: "sendonly" }).sender;
  const peer = { pc, video, audio, at: performance.now(), portal: now.id };
  peers.set(viewer, peer);
  await video.replaceTrack(now.video).catch(() => {});
  await audio.replaceTrack(now.audio).catch(() => {});
  pc.addEventListener("connectionstatechange", () => {
    if (["failed", "closed"].includes(pc.connectionState)) drop(viewer);
  });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    if (peers.get(viewer) !== peer) return; // dropped meanwhile
    send({ t: "rtc", kind: "offer", to: viewer, from: "host", sdp: pc.localDescription.sdp, ...(now.id && { portal: now.id }) });
  } catch {
    drop(viewer);
  }
}

/** Keep the encoder modest: 720p at most, ~1.2 Mbit/s, 24 fps (it shares the device with the story). */
async function limit(sender) {
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) return;
    Object.assign(p.encodings[0], { maxBitrate: 1_200_000, maxFramerate: 24 });
    await sender.setParameters(p);
  } catch {}
}

/** An "rtc" event from the room. Only messages addressed to this device ("host") matter here. */
export function onRtc(m) {
  if (m.to !== "host" || state.retired) return;
  if (m.kind === "join") return void offerTo(m.from);
  const peer = peers.get(m.from);
  if (!peer) return;
  if (m.kind === "answer") peer.pc.setRemoteDescription({ type: "answer", sdp: m.sdp }).then(() => limit(peer.video), () => drop(m.from));
  else if (m.kind === "bye") drop(m.from);
}

// Every second: follow the focused window (and a reconnected stream's new tracks), and drop viewers that
// never connected.
setInterval(() => {
  if (!peers.size) return;
  const now = focused();
  for (const [id, peer] of peers) {
    if (peer.video.track !== now.video) peer.video.replaceTrack(now.video).catch(() => {});
    if (peer.audio.track !== now.audio) peer.audio.replaceTrack(now.audio).catch(() => {});
    if (peer.portal !== now.id && now.id) {
      peer.portal = now.id;
      send({ t: "rtc", kind: "join", to: id, from: "host", portal: now.id }); // tells the viewer which window is live now
    }
    const connected = peer.pc.connectionState === "connected";
    if (!connected && performance.now() - peer.at > CONNECT_MS) drop(id);
  }
}, 1000);

// The page going away ends every live view at once (the viewers fall back to pictures).
addEventListener("pagehide", () => {
  for (const id of [...peers.keys()]) drop(id, true);
});
