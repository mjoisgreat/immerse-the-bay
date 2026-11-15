// app/talk.js: push-to-talk, and characters speaking.
import * as THREE from "three";
import { PushToTalk, micMessage } from "../voice.js";
import { CameraView } from "../cameraview.js";
import { speechHeaders } from "../link.js";
import { credFor } from "../identity.js";
import { listener, renderer, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM, send } from "./room.js";
import { buzz, chime, flash } from "./feedback.js";
import { buddy, buddyIdle } from "./buddy.js";
import { immersion, portals } from "./portals.js";
import { answerWorld } from "./story.js";
import { gestures } from "./xrinput.js";

// ---------- Voice ----------
// On phones the mic is let go of shortly after each turn: while it's open, iPhones play everything
// through the quiet "call" audio route, so the characters' voices would be hard to hear.
export const ptt = new PushToTalk({ releaseAfterMs: CameraView.touch && !/OculusBrowser|Quest/i.test(navigator.userAgent) ? 8000 : 0 });
const MAX_TALK_MS = 90000; // a held button (or a stuck press) still sends after this long
let talkTimer = 0;
/** How to talk on this device, for "didn't catch that". */
function howToTalk() {
  if (renderer.xr.isPresenting) return "Raise a hand to your mouth, give a 👍, or hold A, and speak.";
  if (CameraView.touch) return "Hold 🎙 and speak, then let go.";
  return "Hold Space (or the Hold to talk button) and speak, then let go.";
}
let talkingToBuddy = false;
let byGesture = false; // this turn was started by raising a hand, not a button
export async function startTalking(gesture = false) {
  if (state.talking || state.wantTalk) return;
  state.wantTalk = true;
  byGesture = gesture === true;
  talkingToBuddy = buddy.isLookedAt(); // look at the companion while you talk and your words go to it
  buddy.attend(true); // whatever you say, she comes over to listen
  if (talkingToBuddy) buddy.listen();
  try {
    await ptt.begin();
    if (!state.wantTalk) {
      // Released before the mic was ready: treat it as a cancelled press.
      await ptt.end({}).catch(() => {});
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return;
    }
    state.talking = true;
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => state.talking && stopTalking(), MAX_TALK_MS);
    chime("talk");
    buzz(0.5, 60);
    flash(
      !byGesture
        ? "Listening… let go when you're done"
        : gestures.detector.talkBy === "thumb"
          ? "Listening… 👍 thumbs up again when you're done"
          : "Listening… lower your hand when you're done",
      60000,
    );
  } catch (e) {
    state.wantTalk = false;
    buddy.attend(false);
    if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
    flash(micMessage(e), 8000);
  }
}
export async function stopTalking() {
  state.wantTalk = false;
  buddy.attend(false); // you've finished talking: she can go back to what she was doing
  clearTimeout(talkTimer);
  if (!state.talking) return;
  state.talking = false;
  chime("send");
  buzz(0.3, 40);
  flash("Thinking…", 20000);
  try {
    const text = await ptt.end(speechHeaders(ROOM));
    if (!text) {
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return flash(`Didn't catch that. ${howToTalk()}`, 5000);
    }
    if (state.asking) {
      if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
      return answerWorld(text);
    }
    flash(`“${text}”`, 4000);
    // Everything you say goes to the same mind: it steers the story and answers as the companion.
    // Looking at the companion while you talk tells it your words are meant for it.
    if (talkingToBuddy) {
      buddy.say("…", 15000);
      clearTimeout(state.buddyWait);
      state.buddyWait = setTimeout(() => buddy.listening && buddyIdle(), 30000); // no answer came back
      send({ t: "utterance", text, addressed: true });
    } else send({ t: "utterance", text });
  } catch (e) {
    if (talkingToBuddy) buddy.react({ gesture: "none", move: "none" });
    flash(e.message, 6000);
  }
}

// Characters speak their lines aloud, from their window (or all around you when you're inside it).
let voice = null;
let voiceEnd = null; // onEnd of the line playing now
export async function playVoice({ speaker, line, voice: style, portal_id }) {
  const target = portals.get(portal_id) || portals.get(state.focusId);
  target?.portal.setCaption(`${speaker}: “${line}”`, "story");
  // From the character's window, or all around you when you're inside that world.
  const inside = immersion.inside && target && immersion.portal === target.portal;
  await speak(line, speaker, style, inside ? null : target?.portal.group);
}
/** Speaks a line in a character's voice, from `anchor` (an object in the room) or all around you. */
export async function speak(line, speaker, style, anchor = null, { onStart, onEnd } = {}) {
  try {
    const r = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, cred: credFor(ROOM), text: line, speaker, voice: style }),
    });
    if (!r.ok) throw new Error(`voice ${r.status}`);
    const buf = await listener.context.decodeAudioData(await r.arrayBuffer());
    if (listener.context.state === "suspended") await listener.context.resume();
    // A new line interrupts the previous one; let its speaker know it stopped.
    const interrupted = voiceEnd;
    voiceEnd = null;
    voice?.stop?.();
    voice?.removeFromParent();
    interrupted?.();
    voice = anchor ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
    if (anchor) voice.setRefDistance(2), anchor.add(voice);
    else scene.add(voice);
    voice.setBuffer(buf);
    voice.setVolume(1.4);
    const mine = voice;
    voiceEnd = onEnd || null;
    voice.onEnded = () => {
      mine.isPlaying = false;
      if (voiceEnd === onEnd) voiceEnd = null;
      onEnd?.();
    };
    voice.play();
    onStart?.(buf.duration);
  } catch (e) {
    console.warn("[voice]", e.message);
    onEnd?.();
  }
}
