# Living Window

**Tell a story out loud, and your room becomes it, live.**

You wear a Meta Quest 3S and still see your real room. Pinch at a wall and a portal opens onto a
living world streamed live by Visko Orbis, with its own spatial sound. Hold the orange orb
(or the A/X button) and narrate. An AI story director (Claude) turns your words into Orbis
prompts, and the world changes within about 2 seconds without cutting away. You can open up to
3 portals, each a different place in the same story, kept consistent by a shared "story bible".
Grab a portal to move it.

Built for Immerse the Bay 2026. Tracks: Visko Living Worlds, AI Horizons, Creative Zenith.

## Run it

```bash
cp .env.example .env   # paste the team REACTOR_API_KEY (from @KJ) and ANTHROPIC_API_KEY
npm install
npm run dev            # API on :8787 + HTTPS Vite on :5173
npm run stt            # second terminal: local Whisper speech-to-text on :8790
```

* **Quest headset:** the Quest and laptop must be on the same Wi-Fi. Open the `Network:` URL that
  Vite prints (e.g. `https://192.168.x.x:5173`) in the **Quest Browser**. Accept the self-signed
  certificate warning (Advanced → Proceed), then tap **Enter Living Window** and allow the mic.
* **Director console (laptop):** `https://localhost:5173/console.html`. Type story lines, override
  prompts, switch story seeds, focus or close portals. This is the backup if voice fails in the hall.
* **Desktop preview:** `https://localhost:5173`. Click empty space to open a portal, drag to look,
  hold Space to talk.
* If the venue Wi-Fi blocks device-to-device traffic: `ngrok http https://localhost:5173` and open
  the ngrok URL on the Quest.

## Rooms and community (live site)

* **Private rooms:** the first time a headset opens the site it gets its own room (e.g. `amber-fox-42`)
  and a secret key kept in that browser. Only that headset can open portals and spend Orbis credits.
  Anyone else who opens the room's link is sent to the watch page instead; nobody can take it over.
* **Console:** on a laptop open `/console.html` and enter the room + **console code** shown on the
  headset's start screen.
* **Community:** turn on *Share to community* in the console and the story appears on `/community.html`
  with live snapshots.
* **Watch, suggest, vote:** `/watch.html?room=…` lets anyone follow the story, suggest what happens
  next and upvote ideas. Use an idea from the console, or turn on **Crowd Mode** to apply the top
  vote every 20 seconds.
* **Co-narrators:** the console's invite link lets a friend type or speak lines into the story.

## Demo setup for judges

* **Theater view** (`/theater.html?room=…`, linked from the headset start card and the console): a full-screen
  page for a TV or projector next to the headset. Live window frames cross-fade large with a slow drift, the
  narration runs as subtitles, character lines appear as captions, the director's choices and the top audience
  ideas are shown, and a QR code lets anyone join from their phone to suggest and vote.
* **First-time guide:** entering MR shows a "Living Window" title card, then a narrator voice walks a new
  person through it: open a window, tell the story, touch it or step inside.
* **Windows cut into your wall:** each picture sits 32 cm inside the wall behind an opening (a depth-only mask
  over passthrough), with tunnel walls lit by the scene's own colours, so moving your head gives real parallax.
  Sparks burst from the rim when a window opens.

## Interactive story

* **Choices:** after every beat the director offers 2–3 options for what happens next (gentle, surprising,
  bold). They float above the button panel in the headset and appear on desktop, the console and for
  co-narrators on the watch page. Pick one, or just say something else.
* **Characters talk to you:** when a character is present, the director gives them a line spoken directly to
  you (often a question you can answer out loud). It's voiced with OpenAI TTS (same character, same voice) and
  plays from their window, or all around you when you're inside it.
* **Touch the world:** tap a window (quick trigger/pinch; hold to move it instead), or point at the world and pull
  the trigger when you're inside it. The frame with the touched spot marked goes to Claude, which works out what
  you touched and makes it respond. On desktop: click the focused window.

## Pip, your companion

Press **Pip** (panel or desktop bar) and a small robot walks around your real floor, with a soft shadow under it.
It wanders in front of you, stops to look around, and comes over when you ask. **Pinch Pip, or say "follow me",** and
it walks beside you wherever you go (a little ahead and to your left, running to catch up, popping back if you leave
the room); pinch again or say "stay" to stop. **Look at Pip while you talk** (orb, A/X or hand to
mouth) and your words go to Pip instead of the story: Pip answers out loud from where it stands (Claude for the
words, OpenAI TTS for the voice) with a matching gesture (wave, nod, shake, thumbs-up, jump, dance), knows the story
so far, and can make things happen in it ("Pip, make it snow!" becomes a line for the story director). Pip's chats
appear in the watch feed and on the theater view.

Model: "RobotExpressive" by Tomás Laulhé (Quaternius), modifications by Don McCurdy, CC0, from the three.js examples.

## Hand gestures

Everything works with bare hands (Quest hand tracking). Besides pointing and pinching (open, move, tap to touch,
press buttons, pick choices):

| Gesture | Does |
|---|---|
| Raise a hand to your mouth, like a microphone | Talk; lower it to send |
| Clap | Step into the window you're facing; clap again to step out |
| Turn your left palm toward your face and hold | Show / hide the buttons |

## Controls in the headset

A button panel floats just below your gaze and follows you when you turn or walk away. Point at a button and
pull the trigger (or pinch): **Hold to talk**, **New window**, **Step inside / Step out**, **Close window**,
**Reset story** (tap twice: starts the story over from its seed and closes all windows). The same buttons sit
at the bottom of the screen on desktop, plus **Room info**; the director console has Reset too.
**Hide buttons** (or click a thumbstick, or press H on desktop) leaves just a small **☰ Buttons** handle; point at it
to bring them back.


| Action | Hands | Touch controllers |
|---|---|---|
| Open a portal | Pinch at empty space | Trigger at empty space |
| Focus and move a portal | Pinch on it, drag, release | Trigger on it, drag, release |
| Talk | Pinch and hold the orange orb | Hold A or X (or trigger on the orb) |
| Close a portal | From the director console | Grip while pointing at it |
| Step inside a portal | Walk through it, or pinch it and pull it toward you | Walk through it, or press B / Y |
| Step back out | Walk back ~60 cm, or pinch the blue ring | Walk back, or press B / Y |

**Step inside:** the portal's video becomes the world around you, shown with the same perspective the camera
had (as if you stand exactly where it stood), so straight lines stay straight and scale feels right: no
stretching or warping. It fills your view ahead; past its edges a soft, blurred glow of the scene fills your
peripheral vision. The director is told you're inside and asks Orbis for an eye-level 20 mm wide-angle view
that matches, a light sharpen keeps the video crisp, and motes drift around you at arm's length. The buttons
tuck away automatically while you're inside. Your lines keep steering it, and other portals float inside as
doors (walk into one to switch).
On desktop: double-click a portal (or press E) to go in, Esc to come out.

## How it works

```
Quest Browser (three.js WebXR, passthrough)          Laptop
 ├─ portal A ── WebRTC ── Orbis session A    ┌───────────────────────────────┐
 ├─ portal B ── WebRTC ── Orbis session B    │ server/index.js               │
 ├─ portal C ── WebRTC ── Orbis session C    │  /api/token  → Reactor JWT     │
 ├─ mic (push-to-talk) ─ 16 kHz PCM ───────► │  /api/transcribe → stt.py      │
 └─ WebSocket ◄──── directions ───────────── │  /ws  story state + director   │
                                              │       (Claude, structured out)│
Director console (console.html) ── /ws ─────► └───────────────────────────────┘
```

* `src/orbis.js` runs one Orbis session per portal: one JWT per session, retry with backoff on
  "no capacity" (429), auto-restart when generation completes, server-side cleanup on close.
* `server/director.js` sends the story bible, recent beats and each portal's current prompt to
  Claude and gets back `{narration, bible, updates[]}` as validated JSON. It follows the Orbis
  prompt guide: one continuous shot, and describe only what changes. Without a Claude key it falls
  back to a simple template so the demo still works.
* Each portal plays its Orbis audio through three.js `PositionalAudio`, so the sound comes from
  that wall.

## Team split

1. **XR:** `src/main.js`, `src/portal.js`. Portal placement on real walls (hit-test or planes),
   polish, and the in-headset UI.
2. **Orbis/backend:** `src/orbis.js`, `server/index.js`. Reliability with 3 parallel sessions,
   reconnects, and watching the credit dashboard.
3. **AI/voice:** `server/director.js`, `src/voice.js`, `server/stt.py`. Prompt quality and
   latency, and story-director tuning.
4. **Pitch:** demo script, Devpost, backup recording, story seeds (`src/console.js` PRESETS).

## Rules to remember

* Devpost deadline **Sun 9:00 AM**. Judging is 3 min pitch + 2 min Q&A, 10 AM to 12 PM.
* Visko requires a **live** Orbis demo; a video of a run does not count. Record a backup clip anyway.
* Keep `REACTOR_API_KEY` server-side only. Close sessions nobody is watching.

## CI and automatic deploys

`.github/workflows/ci.yml` runs on every push and pull request: `npm install`, `npm test` (story state, permissions,
choices, touch, reset and hand-gesture tests) and `npm run build`. On pushes to `main` it then deploys to
https://living-window.vercel.app with the Vercel CLI, once these repository secrets exist:
`VERCEL_TOKEN` (create at vercel.com/account/tokens), `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (from `.vercel/project.json`).
Without them the deploy job is skipped with a warning.
