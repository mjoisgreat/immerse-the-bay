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

## Controls in the headset

| Action | Hands | Touch controllers |
|---|---|---|
| Open a portal | Pinch at empty space | Trigger at empty space |
| Focus and move a portal | Pinch on it, drag, release | Trigger on it, drag, release |
| Talk | Pinch and hold the orange orb | Hold A or X (or trigger on the orb) |
| Close a portal | From the director console | Grip while pointing at it |
| Step inside a portal | Walk through it, or pinch it and pull it toward you | Walk through it, or press B / Y |
| Step back out | Walk back ~60 cm, or pinch the blue ring | Walk back, or press B / Y |

**Step inside:** the portal's live video wraps around you and your room fades away. Below the horizon the
picture is projected onto your real floor, so walking around gives real parallax underfoot; glowing motes in
the world's colours drift around you, and the edges blur softly instead of ending. The director is told you're
inside and reframes that world as an eye-level, first-person shot with things happening around you. Your lines
keep steering it, and other portals float inside as doors (walk into one to switch).
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
