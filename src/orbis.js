// One live Visko Orbis stream. Each portal owns one of these.
import { Reactor } from "@reactor-team/js-sdk";
import { credFor } from "./identity.js";

const MODEL_NAME = "reactor/visko-orbis-stable";
const TRACKS = [
  { name: "main_video", kind: "video", direction: "recvonly" },
  { name: "main_audio", kind: "audio", direction: "recvonly" },
];

function unwrap(raw) {
  const env = raw || {};
  if (env.data && typeof env.data === "object") return { ...env.data, type: env.data.type || env.type };
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class OrbisStream extends EventTarget {
  constructor(id, room) {
    super();
    this.id = id;
    this.room = room;
    this.video = Object.assign(document.createElement("video"), {
      muted: true, // picture only; sound goes through spatial audio
      playsInline: true,
      autoplay: true,
      crossOrigin: "anonymous",
    });
    this.audioStream = null;
    this.prompt = "";
    this.status = "idle";
    this.reactor = null;
    this.jwt = null;
    this.sessionId = null;
    this.closed = false;
    this._conditionsReady = null;
    this._restarting = false;
  }

  _setStatus(status, detail = "") {
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: { status, detail } }));
  }

  async _token() {
    const r = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: this.room, cred: credFor(this.room) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.jwt) throw new Error(j.error || `token request failed (${r.status})`);
    return j.jwt;
  }

  /** Connects (with backoff on "no capacity") and starts streaming `prompt`. */
  async start(prompt) {
    this.prompt = prompt;
    for (let attempt = 1; !this.closed; attempt++) {
      try {
        await this._connectAndStart();
        return;
      } catch (e) {
        if (this.closed) {
          await this._teardown();
          return;
        }
        const busy = e?.name === "RateLimitedError" || /429|capacity/i.test(String(e?.message));
        const wait = Math.min(30000, (busy ? 4000 : 2000) * attempt);
        this._setStatus("retrying", `${busy ? "No capacity right now" : e.message}. Retrying in ${Math.round(wait / 1000)} s`);
        await this._teardown();
        await sleep(wait);
      }
    }
  }

  async _connectAndStart() {
    this._setStatus("connecting");
    this.jwt = await this._token(); // one JWT for the whole session
    if (this.closed) return this._teardown();
    const reactor = new Reactor({ modelName: MODEL_NAME, modelTracks: TRACKS, jwt: this.jwt });
    this.reactor = reactor;

    reactor.on("trackReceived", (name, _track, stream) => {
      if (name === "main_video") {
        this.video.srcObject = stream;
        this.video.play().catch(() => {});
        this.dispatchEvent(new Event("video"));
      } else if (name === "main_audio") {
        this.audioStream = stream;
        this.dispatchEvent(new Event("audio"));
      }
    });
    reactor.on("sessionIdChanged", (id) => {
      this.sessionId = id || this.sessionId;
      if (this.closed) this._cleanupServerSide(); // closed while connecting: the session id arrives late, end it now
    });
    reactor.on("message", (raw) => this._onMessage(unwrap(raw)));
    reactor.on("statusChanged", (s) => {
      if (s === "disconnected" && !this.closed && this.status === "streaming") {
        this._setStatus("reconnecting", "Stream dropped");
        this._restart();
      }
    });

    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timed out connecting to Orbis")), 45000);
      reactor.on("statusChanged", (s) => s === "ready" && (clearTimeout(t), resolve()));
      reactor.on("error", (e) => (clearTimeout(t), reject(e)));
    });
    ready.catch(() => {});
    await reactor.connect(this.jwt);
    await ready;
    if (this.closed) return this._teardown(reactor);
    await this._startGeneration();
  }

  async _startGeneration() {
    const conditions = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timed out waiting for conditions_ready")), 20000);
      this._conditionsReady = () => (clearTimeout(t), resolve());
    });
    conditions.catch(() => {});
    const reply = unwrap(await this.reactor.sendCommand("set_prompt", { prompt: this.prompt }));
    if (reply?.type === "command_error") throw new Error(`set_prompt: ${reply.reason || "rejected"}`);
    await conditions;
    await this.reactor.sendCommand("start", {});
    if (this.closed) return this._teardown();
    this._setStatus("streaming");
  }

  _onMessage(m) {
    if (m.type === "conditions_ready") {
      this._conditionsReady?.();
      this._conditionsReady = null;
    } else if (m.type === "generation_complete") {
      // The model does not restart by itself; keep the world alive.
      if (!this.closed) this._startGeneration().catch(() => this._restart());
    } else if (m.type === "command_error") {
      this.dispatchEvent(new CustomEvent("status", { detail: { status: this.status, detail: `${m.command}: ${m.reason}` } }));
    }
  }

  async _restart() {
    if (this._restarting || this.closed) return;
    this._restarting = true;
    await this._teardown();
    this._restarting = false;
    this.start(this.prompt);
  }

  /** Steers the running world. Takes effect at the next ~1.8 s chunk. */
  async steer(prompt) {
    this.prompt = prompt;
    if (this.status !== "streaming" || !this.reactor) return; // used on next (re)start
    try {
      await this.reactor.sendCommand("set_prompt", { prompt });
    } catch (e) {
      this.dispatchEvent(new CustomEvent("status", { detail: { status: this.status, detail: e.message } }));
    }
  }

  /** Disconnects and ends the server-side session. `reactor` may be one close() already detached mid-connect. */
  async _teardown(reactor = this.reactor) {
    if (this.reactor === reactor) this.reactor = null;
    try {
      await reactor?.disconnect();
    } catch {}
    this._cleanupServerSide();
  }

  _cleanupServerSide(keepalive = false) {
    if (!this.sessionId || !this.jwt) return;
    fetch("/api/session-cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: this.sessionId, jwt: this.jwt }),
      keepalive,
    }).catch(() => {});
    this.sessionId = null;
  }

  async close() {
    this.closed = true;
    this._setStatus("closed");
    await this._teardown();
    this.video.pause();
    this.video.srcObject = null;
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.audioStream = null;
  }

  /** For page unload: fire-and-forget server-side cleanup. */
  closeOnUnload() {
    this.closed = true;
    this._cleanupServerSide(true);
  }
}
