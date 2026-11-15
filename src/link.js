// Connection to a story room: polls /api/relay for state + events, posts messages.
// Works the same on the laptop server and on Vercel.
import { credFor, voterId } from "./identity.js";

export function createLink(room, { onMessage, onOpen }) {
  let since = null; // null until the first poll; history is skipped so old events aren't replayed
  let lastState = "";
  let connected = false;
  let outbox = Promise.resolve();

  async function tick() {
    try {
      const r = await fetch(`/api/relay?room=${room}&since=${since ?? 0}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const { state, events, seq } = await r.json();
      if (!connected) (connected = true), onOpen?.();
      if (since !== null) for (const e of events) onMessage(e);
      since = seq;
      const key = JSON.stringify(state);
      if (key !== lastState) (lastState = key), onMessage({ t: "state", ...state });
    } catch {
      connected = false;
    }
    setTimeout(tick, document.hidden ? 3000 : 700);
  }
  tick();

  /** Sends in order. Resolves with the server's JSON reply ({ok, role} or {error}). */
  function request(m) {
    const p = outbox.then(() =>
      fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...m, room, cred: credFor(room), voter: voterId }),
      })
        .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))
        .catch(() => ({ status: 0, error: "offline" })),
    );
    outbox = p;
    return p;
  }

  return {
    send: request,
    request,
    get connected() {
      return connected;
    },
  };
}

/** Headers that let narrators use the mic (speech-to-text) for a room. */
export function speechHeaders(room) {
  const c = credFor(room);
  const h = { "X-Room": room };
  if (c.key) h["X-Key"] = c.key;
  else if (c.pin) h["X-Pin"] = c.pin;
  else if (c.invite) h["X-Invite"] = c.invite;
  return h;
}
