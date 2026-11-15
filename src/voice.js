// Push-to-talk capture. Records mic audio, resamples to 16 kHz Int16 PCM and
// sends it to /api/transcribe (OpenAI Whisper, via the server).
//
// Made robust for real devices:
//  - The microphone is re-opened whenever the browser or OS has stopped it (another app took it,
//    a Bluetooth headset connected, the phone locked), instead of silently recording nothing.
//  - A short tail is kept after you let go, so the last word isn't cut off.
//  - On phones the mic is let go of a little while after each turn: while a mic is open, iPhones
//    switch audio to "call" mode and the characters' voices become quiet. (`releaseAfterMs`.)
//  - Errors come back as messages a person can act on (blocked, no mic, busy, offline).

const TAIL_MS = 220; // keep recording this long after the release: the last syllable is still in the pipe
const MIN_SECONDS = 0.3; // shorter is an accidental tap
const MIN_PEAK = 0.02; // quieter than this is silence (Whisper invents words for silence)

/** A getUserMedia / network error as something a person can act on. */
export function micMessage(e) {
  const n = e?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError")
    return "The microphone is blocked. Allow microphone access for this site (the 🔒 or ⓘ next to the address), then try again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No microphone found. Connect one, or check your system's sound settings.";
  if (n === "NotReadableError" || n === "AbortError") return "The microphone is busy in another app. Close it there and try again.";
  if (e instanceof TypeError && /fetch|network|load/i.test(e.message)) return "Couldn't reach the server to understand that. Check your connection and try again.";
  return e?.message || "The microphone isn't working.";
}

export class PushToTalk {
  /** `releaseAfterMs`: let go of the mic this long after a turn (0 = keep it open). */
  constructor({ releaseAfterMs = 0 } = {}) {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.chunks = [];
    this.recording = false;
    this.releaseAfterMs = releaseAfterMs;
    this._releaseTimer = 0;
    this.turn = 0; // which press this is: a new one during the tail of the last must not be cut short
  }

  get _live() {
    const t = this.stream?.getAudioTracks?.()[0];
    return Boolean(t && t.readyState === "live" && t.enabled);
  }

  async init() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't use the microphone here (it needs https)."), { name: "NotSupported" });
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // ScriptProcessor is deprecated but works everywhere, including Quest Browser.
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => {
        if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.node.connect(sink);
      sink.connect(this.ctx.destination);
    }
    if (this._live) return;
    // (Re)open the microphone: first use, or the system stopped it, or we let go of it on a phone.
    this._closeStream();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    // If the system takes it away mid-turn, the next turn re-opens it (see _live).
    this.stream.getAudioTracks()[0]?.addEventListener("ended", () => (this.recording = false));
  }

  _closeStream() {
    try {
      this.source?.disconnect();
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = this.stream = null;
  }

  /** Let go of the microphone (the browser's mic indicator goes off). The next turn opens it again. */
  release() {
    clearTimeout(this._releaseTimer);
    if (!this.recording) this._closeStream();
  }

  async begin() {
    clearTimeout(this._releaseTimer);
    await this.init();
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.ctx.state !== "running") throw new Error("The browser paused audio. Tap the screen once, then try again.");
    this.chunks = [];
    this.turn++;
    this.recording = true;
  }

  /** Stops recording and returns the transcript ("" if nothing heard). */
  async end(headers = {}) {
    if (!this.recording) return "";
    const turn = this.turn;
    await new Promise((r) => setTimeout(r, TAIL_MS)); // the last word is still on its way in
    if (turn !== this.turn) return ""; // you pressed again meanwhile: that new turn is recording now
    this.recording = false;
    if (this.releaseAfterMs) {
      clearTimeout(this._releaseTimer);
      this._releaseTimer = setTimeout(() => this.release(), this.releaseAfterMs);
    }
    const pcm = this._toPcm16k();
    if (pcm.length < 16000 * MIN_SECONDS) return "";
    // Near-silence makes Whisper invent words ("you", "thank you"), so don't send it.
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < MIN_PEAK * 0x7fff) return "";
    let r;
    try {
      r = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", ...headers },
        body: pcm.buffer,
        signal: AbortSignal.timeout?.(30000),
      });
    } catch (e) {
      throw new Error(e?.name === "TimeoutError" ? "Understanding that took too long. Try again." : micMessage(e));
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Couldn't understand that (server error ${r.status}). Try again.`);
    return (j.text || "").trim();
  }

  _toPcm16k() {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const input = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) input.set(c, o), (o += c.length);
    this.chunks = [];
    const ratio = this.ctx.sampleRate / 16000;
    const out = new Int16Array(Math.floor(total / ratio));
    for (let i = 0; i < out.length; i++) {
      // Average over the source window (simple low-pass) before decimating.
      const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += input[j];
      const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  }
}
