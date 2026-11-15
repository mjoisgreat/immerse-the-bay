// Push-to-talk capture. Records mic audio, resamples to 16 kHz Int16 PCM and
// sends it to /api/transcribe (OpenAI Whisper, via the server).
export class PushToTalk {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.chunks = [];
    this.recording = false;
  }

  async init() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but works everywhere, including Quest Browser.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    src.connect(this.node);
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
  }

  async begin() {
    await this.init();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.chunks = [];
    this.recording = true;
  }

  /** Stops recording and returns the transcript ("" if nothing heard). */
  async end(headers = {}) {
    if (!this.recording) return "";
    this.recording = false;
    const pcm = this._toPcm16k();
    if (pcm.length < 16000 * 0.3) return ""; // under 0.3 s: treat as an accidental tap
    // Near-silence makes Whisper invent words ("you", "thank you"), so don't send it.
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < 0.03 * 0x7fff) return "";
    const r = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...headers },
      body: pcm.buffer,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `transcribe failed (${r.status})`);
    return (j.text || "").trim();
  }

  _toPcm16k() {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const input = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) input.set(c, o), (o += c.length);
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
