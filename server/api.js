// HTTP API shared by the local server (Express) and Vercel functions.
// Each handler takes (store, input) and returns { status, body }.
import crypto from "node:crypto";
import { createDirector } from "./director.js";
import { reduce, allowed, askDirector, applyDirection, summary, MAX_PORTALS } from "./core.js";
import { mintOrbisToken, endOrbisSession, transcribe, speak } from "./services.js";

const director = createDirector();
const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const ok = (body, status = 200) => ({ status, body });
const err = (status, error) => ({ status, body: { error } });

export const roomOf = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

/**
 * Role of the caller in a room, from the credentials they hold:
 *   owner   - the secret key kept on the headset that created the room
 *   console - the short console code shown on the headset
 *   co      - an invite code from the owner's co-narrator link
 *   viewer  - anyone else;  none - the room has no owner yet
 */
async function roleOf(store, room, cred = {}) {
  const a = await store.getAuth(room);
  if (!a) return { role: "none", auth: null };
  if (cred.key && hash(cred.key) === a.owner) return { role: "owner", auth: a };
  if (cred.pin && hash(String(cred.pin).toUpperCase()) === a.pin) return { role: "console", auth: a };
  if (cred.invite && cred.invite === a.invite) return { role: "co", auth: a };
  return { role: "viewer", auth: a };
}

export function config() {
  return ok({ maxPortals: MAX_PORTALS, director: director.usingClaude ? "claude" : "template" });
}

export async function relayGet(store, query) {
  const room = roomOf(query.room);
  if (!room) return err(400, "room required");
  const since = Number(query.since || 0);
  const { state, events, seq } = await store.poll(room);
  return ok({
    state: { ...state, director: director.usingClaude ? "claude" : "template" },
    events: events.filter((e) => e.seq > since),
    seq,
  });
}

export async function relayPost(store, body) {
  const room = roomOf(body.room);
  if (!room) return err(400, "room required");
  const cred = body.cred || {};
  let { role, auth } = await roleOf(store, room, cred);

  // The first headset to say hello in an unclaimed room becomes its owner.
  if (role === "none" && body.t === "hello" && cred.key && cred.pin && cred.invite) {
    if (await store.claimAuth(room, { owner: hash(cred.key), pin: hash(String(cred.pin).toUpperCase()), invite: cred.invite })) {
      ({ role, auth } = await roleOf(store, room, cred));
    }
  }
  if (body.t === "whoami") {
    // Owners and consoles get the share links' codes back; nobody else sees them.
    const extra = role === "owner" || role === "console" ? { invite: auth.invite } : {};
    return ok({ role, ...extra });
  }
  if (!allowed(role, body.t)) return err(403, `not allowed for ${role}`);

  const ctx = { role, voter: typeof body.voter === "string" ? body.voter.slice(0, 40) : null };
  const { event, snapshot } = await store.withLock(room, async () => {
    const s = await store.getState(room);
    const { events, director: ev } = reduce(s, body, ctx);
    await store.setState(room, s);
    await store.pushEvents(room, events);
    await store.touchPublic(room, s.meta.shared);
    return { event: ev, snapshot: s };
  });

  if (event) {
    const started = Date.now();
    const out = await askDirector(director, snapshot, event);
    await store.withLock(room, async () => {
      const fresh = await store.getState(room); // others may have changed it while the director thought
      const more = applyDirection(fresh, out, Date.now() - started);
      await store.setState(room, fresh);
      await store.pushEvents(room, more);
    });
  }
  return ok({ ok: true, role });
}

/** Orbis tokens only for the room's owner headset, so strangers can't spend the team's credits. */
export async function token(store, body) {
  const room = roomOf(body.room);
  const { role } = await roleOf(store, room, body.cred);
  if (role !== "owner") return err(403, "only the room's headset can open portals");
  return ok({ jwt: await mintOrbisToken() });
}

export async function sessionCleanup(body) {
  await endOrbisSession(body?.sessionId, body?.jwt);
  return { status: 204, body: null };
}

/** Character voices: only the room's headset may spend speech credits. */
export async function voice(store, body) {
  const room = roomOf(body.room);
  const { role } = await roleOf(store, room, body.cred);
  if (role !== "owner") return err(403, "owner only");
  const text = String(body.text || "").trim().slice(0, 300);
  if (!text) return err(400, "text required");
  const audio = await speak(text, String(body.speaker || "").slice(0, 60), String(body.voice || "").slice(0, 200));
  return { status: 200, body: audio, type: "audio/mpeg" };
}

/** Speech-to-text for people allowed to narrate (owner, console, co-narrators). */
export async function speech(store, headers, pcm) {
  const room = roomOf(headers["x-room"]);
  const cred = { key: headers["x-key"], pin: headers["x-pin"], invite: headers["x-invite"] };
  const { role } = await roleOf(store, room, cred);
  if (!["owner", "console", "co"].includes(role)) return err(403, "only narrators can use the mic");
  if (!Buffer.isBuffer(pcm) || pcm.length > 8 * 1024 * 1024) return err(400, "bad audio");
  return ok({ text: await transcribe(pcm) });
}

export async function snapshotPost(store, body) {
  const room = roomOf(body.room);
  const { role } = await roleOf(store, room, body.cred);
  if (role !== "owner") return err(403, "owner only");
  const id = String(body.id || "").slice(0, 4);
  const data = String(body.data || "");
  if (!/^[A-F]$/.test(id) || !data.startsWith("data:image/jpeg;base64,") || data.length > 80_000) return err(400, "bad snapshot");
  await store.setSnapshot(room, id, data);
  return ok({ ok: true });
}

export async function snapshotGet(store, query) {
  const room = roomOf(query.room);
  if (!room) return err(400, "room required");
  return ok(await store.getSnapshots(room));
}

export async function community(store) {
  const rooms = await store.listPublic(30);
  const cards = rooms
    .map(({ room, state, snaps }) => summary(room, state, snaps[state.focusId] || Object.values(snaps)[0]))
    .sort((a, b) => b.live - a.live || b.lastActive - a.lastActive);
  return ok({ rooms: cards });
}
