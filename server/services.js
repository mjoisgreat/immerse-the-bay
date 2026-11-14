// Shared by the local server and the Vercel functions.
const REACTOR_API_URL = "https://api.reactor.inc";
const MODEL_NAME = "reactor/visko-orbis-stable";
const SESSION_SECONDS = Number(process.env.ORBIS_SESSION_SECONDS || 1800);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Mints a short-lived Reactor JWT for one Orbis session. The API key never leaves the server. */
export async function mintOrbisToken() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey || apiKey === "replace_me") throw new HttpError(500, "REACTOR_API_KEY is not set");
  let r;
  try {
    r = await fetch(`${REACTOR_API_URL}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Reactor-API-Key": apiKey },
      body: JSON.stringify({
        expires_after: SESSION_SECONDS + 600,
        authorization_details: [
          {
            type: "session",
            resources: { models: { match: [MODEL_NAME] } },
            constraints: { max_sessions: 1, max_session_duration_seconds: SESSION_SECONDS },
          },
        ],
      }),
    });
  } catch (e) {
    throw new HttpError(502, `Could not reach Reactor: ${e.message}`);
  }
  const text = await r.text();
  if (!r.ok) throw new HttpError(r.status, `Reactor token request failed (${r.status}): ${text}`);
  const { jwt } = JSON.parse(text);
  if (!jwt) throw new HttpError(502, "Reactor returned no JWT");
  return jwt;
}

/** Ends one Orbis session (idempotent). */
export async function endOrbisSession(sessionId, jwt) {
  if (typeof sessionId !== "string" || typeof jwt !== "string" || sessionId.length > 200 || jwt.length > 16384) {
    throw new HttpError(400, "sessionId and jwt are required");
  }
  const r = await fetch(`${REACTOR_API_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok && r.status !== 404) throw new HttpError(r.status, "session cleanup failed");
}

/** 16 kHz mono Int16 PCM -> text. STT_MODE=openai uses OpenAI; otherwise the local Whisper sidecar. */
export async function transcribe(pcm) {
  if (process.env.STT_MODE === "openai") return transcribeOpenAI(pcm);
  let r;
  try {
    r = await fetch(`${process.env.STT_URL || "http://127.0.0.1:8790"}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm,
    });
  } catch {
    throw new HttpError(502, "speech-to-text sidecar is not running (npm run stt)");
  }
  if (!r.ok) throw new HttpError(502, `speech-to-text failed (${r.status})`);
  return (await r.json()).text || "";
}

async function transcribeOpenAI(pcm) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpError(500, "OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("file", new Blob([wavFromPcm16(pcm)], { type: "audio/wav" }), "speech.wav");
  form.append("model", "whisper-1");
  form.append("language", "en");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!r.ok) throw new HttpError(502, `OpenAI transcription failed (${r.status})`);
  return ((await r.json()).text || "").trim();
}

function wavFromPcm16(pcm, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, Buffer.from(pcm)]);
}
