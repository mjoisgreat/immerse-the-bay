// Connection to the story server. Locally: WebSocket (instant). On Vercel: HTTP
// polling against /api/relay (serverless functions can't hold sockets open).
// Both deliver the same messages: {t:"state"|"direction"|"close_portal", ...}.
/** The story room this page belongs to: ?room=name (default "main"). */
export const ROOM =
  (new URLSearchParams(location.search).get("room") || "main").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "main";

export async function createLink({ onMessage, onOpen }) {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  return cfg.transport === "poll" ? pollLink(onMessage, onOpen) : wsLink(onMessage, onOpen);
}

function wsLink(onMessage, onOpen) {
  let ws;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => onOpen?.();
    ws.onclose = () => setTimeout(connect, 1500);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  };
  connect();
  return {
    send: (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)),
    get connected() {
      return ws?.readyState === 1;
    },
  };
}

function pollLink(onMessage, onOpen) {
  let since = null; // null until the first poll: skip history, only act on new events
  let lastState = "";
  let connected = false;
  let outbox = Promise.resolve();

  async function tick() {
    try {
      const r = await fetch(`/api/relay?room=${ROOM}&since=${since ?? 0}`, { cache: "no-store" });
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

  return {
    // Messages are sent in order; a message that triggers the director waits for it.
    send: (m) =>
      (outbox = outbox.then(() =>
        fetch("/api/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...m, room: ROOM }) }).catch(() => {}),
      )),
    get connected() {
      return connected;
    },
  };
}
