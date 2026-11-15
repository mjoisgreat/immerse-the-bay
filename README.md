# Living Window

**A campfire story you can step into.**
One person speaks, the room becomes the story, and everyone watching shapes what happens next, live.

You wear a Meta Quest 3S and still see your real room. Draw a square in the air and a portal opens onto a
living world streamed live by Visko Orbis, with its own spatial sound. Raise a hand to your mouth
like a microphone (or hold the A/X button) and narrate. An AI story director (Claude) turns your words into Orbis
prompts, and the world changes within about 2 seconds without cutting away. You can open up to
3 portals, each its own story in its own world (see "One story per window"). Grab a portal to move it.

Built for Immerse the Bay 2026. Tracks: Visko Living Worlds, AI Horizons, Creative Zenith.

## Run it

```bash
cp .env.example .env   # paste REACTOR_API_KEY (from @KJ), OPENAI_API_KEY (voice + mic) and ANTHROPIC_API_KEY (or use OpenAI for the director)
npm install
npm run dev            # API on :8787 + HTTPS Vite on :5173
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

## One story per window

Every window is its own story thread: its own world (seed), story bible, beats, choice chips and prompt
history, kept per `portal_id` in `server/core.js` (`state.threads`). Each window still has its own Orbis session.

* **A new window asks "What world is behind this window?"** Answer in one line, by voice (hold to talk) or by
  typing (desktop preview, console). Skip it and the first thing you say becomes that window's world. A new
  window never inherits another window's story.
* **Steering only reaches the focused window.** What you say, the choice chips, touches and prompt updates go
  to the window you are looking at; the director is given that one thread and cannot change any other window.
* **Switching focus brings back that window's own story:** its world, bible, choices and prompt history. The
  other windows keep streaming their own worlds untouched.
* **Audience ideas belong to the room, not to a window.** There is one list and one vote count. An idea steers
  whichever window is focused at the moment it is used: a pinch on an idea card, "Use" in the console, or Crowd
  Mode's pick every 20 s. When more than one window is open, each idea card says where it will land
  ("→ WINDOW B"), and the console, watch page and theater view name the focused window too. With no window
  open, ideas wait on the list.

## New story, Reset, Prepare demo

* **Reset story** (one tap arms it; the button reads **Tap again to confirm** until you do, press another
  button, or hit Esc): closes every window and forgets every story, the ideas and the seed. Nothing is reused.
* **New story:** the same reset, then the narrator asks **"What world is this story set in?"**. Your answer
  opens the first window onto that world. Skip it and the first window asks its own question.
* **Prepare demo** (start card and console): a fresh story in a chosen world with its first window opened
  straight away, because a window takes 20–30 s to reach video. Do it before the headset goes on.
* The buttons start hidden on a first visit (**H**, the **☰ Buttons** handle, a thumbstick click or your left
  palm brings them out) and then stay the way you last left them.

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
  bold). They appear on desktop, the console and for co-narrators on the watch page. Pick one, or just say
  something else. **In the headset the story is steered by voice only:** the director's options are not
  shown there (an audience idea sent by a friend still floats above the buttons).
* **Characters talk to you:** when a character is present, the director gives them a line spoken directly to
  you (often a question you can answer out loud). It's voiced with OpenAI TTS (same character, same voice) and
  plays from their window, or all around you when you're inside it.
* **Touch the world:** tap a window (quick trigger/pinch; hold to move it instead), or point at the world and pull
  the trigger when you're inside it. The frame with the touched spot marked goes to Claude, which works out what
  you touched and makes it respond. On desktop: click the focused window.

## Bonnie, your companion

Press **Bonnie** (panel or desktop bar) and a little white VR bunny (after the Stanford XR mascot: long ears, one
tilted, black headset visor with side straps, an "x" nose and a round tail) hops around your real floor, with a
soft shadow under it. It's built from simple shapes and animated in code (no model file): it hops with squash and
stretch and flowing ears, breathes and twitches its ears when idle, waves an ear, nods, shakes its head, does happy
hops, spins in the air and dances, and its visor glows while it listens and pulses while it talks.
If you throw it far or leave it behind, it trots back to you a few seconds after landing. It wanders in front of you, and comes over when you ask. **Pinch Bonnie, or say "follow me",** and it hops beside you
wherever you go (a little ahead and to your left, bounding to catch up, popping back if you leave the room); pinch
again or say "stay" to stop. **Pick Bonnie up and throw it:** pinch (or trigger) and hold while pointing at
Bonnie, or reach out and pinch it directly, and it comes to your hand; let go and it flies off with your hand's speed,
tumbling, bouncing off the floor, the open windows and a rough 8 m room box around you, then picks itself up, faces
you and carries on (still following if it was). A quick pinch without moving is still the follow toggle. On desktop,
drag Bonnie with the mouse and let go. The physics is a small hand-rolled integrator in `src/physics.js`
(tests in `test/physics.test.js`). **Bonnie and the story director are the same mind:** everything you say goes to one
Claude call that both steers the windows and decides what Bonnie says and does, so Bonnie sees what is in every
window and "Bonnie, make it snow!" changes the world in the same breath as its answer. Say its name, or **look at
Bonnie while you talk** (hand to mouth, A/X or Hold to talk), and it always answers out loud from where it sits (OpenAI TTS
for the voice) with a matching gesture; while you're just narrating it mostly stays quiet and only chimes in now
and then. Small talk ("hi Bonnie", "follow me") leaves the story untouched. Its lines appear in the watch feed and
on the theater view.

**Bonnie opens windows for you.** Say "Bonnie, go over there and open a window onto a misty pine forest" (or just
"Bonnie, open a window"). You do not even have to say "window": proposing a new place or character to her is
enough. "Bonnie, let's go with Santa Claus" opens a window with a Santa Claus world, "take us to the moon" one on
the moon. A change inside the world you are already looking at ("make it snow") still steers that window instead
(when it is unclear, the director changes the current one). She answers, walks to the place you named (left, right, ahead / over there, behind, or
beside you if you named none: always relative to where you are looking) and opens a window just behind her, facing
you. With a world in your words it starts that world; without one she asks "what world is behind this window?" like
any new window. Other windows are left alone, and at the window limit she tells you to close one first. The
director returns `open_window` (the world, or `""` to ask) and `place` next to its `companion` reply; the backup
director (no API key) understands the same phrases. The walking is `Companion.goTo()`; the place maths is in
`src/errand.js`.

Add `?companion=pip` to the headset URL to get Pip, the robot, instead ("RobotExpressive" by Tomás Laulhé
(Quaternius), modifications by Don McCurdy, CC0, from the three.js examples).

## Room background: see-through or Stanford's Main Quad

Press **Stanford** on the panel (**Stanford Quad** on desktop) and your room is replaced by a real 3D place all around
you: Stanford's Main Quad at golden hour (a Gaussian splat made with World Labs Marble, from the
`feature/splat-worlds` branch: `public/worlds/stanford.spz`, listed in `worlds/manifest.json`, drawn with
[Spark](https://sparkjs.dev)). It's placed where you stand, facing the way you face, and you can walk around in it.
Press **See-through** to fade back to your real room. The story windows aren't affected: they keep floating in front
of you (without the "hole in the wall" effect, since there's no real wall), stepping inside a window still shows its
live video (the Quad hides while you're inside and comes back when you step out), and Bonnie comes along. The splat
renderer is only downloaded the first time you press the button.

The button shows the **golden-hour** Main Quad (`stanford-golden`, the first Marble world). Casimir's photo-based
Inner Quad (`stanford`) is still in `worlds/manifest.json` for the director's world matching; add `?backdrop=stanford`
to the headset URL to use it as the background instead.

**Loading and weak hardware:** pressing the button shows a loading state (download percentage, then "Building the
world…"). Headsets, phones, software rendering and small machines get a light version of the splat
(`public/worlds/stanford-low.spz`, 150 000 of the 500 000 splats, made with `node scripts/decimate-spz.mjs`); a device
where the full version freezes for more than 2 s switches to the light one from then on. Force either with
`?splat=low` or `?splat=high`.

**Moving around the Quad** (only while the world is on, and not inside a window): walk for real, use the **left
thumbstick** to walk where you're looking, the **right thumbstick** to turn in 30° steps, or **point at the ground and
pinch** (or pull the trigger) to teleport there (a glowing circle shows where you'll land; pointing straight ahead still
opens a window). On desktop, **W/A/S/D** or the arrow keys walk. Going back to see-through puts you back in your real
room, so the windows line up with your walls again.

## Hand gestures

Bare hands (Quest hand tracking) are the main way to play; the controller buttons do the same things as a
fallback. Besides pointing and pinching (open, move, tap to touch, press buttons, pick choices):

| Gesture | Does | Controller fallback |
|---|---|---|
| Raise a hand to your mouth, like a microphone | Talk; lower it to send. A red mic badge floats by that hand while it records | Hold A / X |
| Part both hands, like opening curtains | Step into the focused window | B / Y |
| Bring both hands back together | Step back out | B / Y |
| Shake both hands in front of you, like wiping something away | Close the focused window (inside a world: step back out) | Grip while pointing at it |
| Turn your left palm toward your face and hold | Show / hide the buttons | Thumbstick click |
| Snap your fingers (either hand) | Call the companion: Bonnie appears, or hops back over to you if she is already here | The **Bonnie** button |
| Pinch a window and drag | Move it (a quick tap touches the world instead) | Trigger on it, drag |
| Pinch the same window with your other hand, then move your hands apart or together | Pick it up with both hands: it is carried by the midpoint of your hands and resized by the distance between them (40 % to 250 %) | n/a |
| Pinch the companion with both hands | Pick her up and carry her between your hands; let go to drop or throw her (one hand still works as before) | n/a |

Every gesture answers so you know it registered: your palms glow, a short tone plays, and controllers buzz.
The two-hand gestures share a 1.5 s cooldown and are ignored while you talk; parting has to end with the hands
held apart for a moment, so a shake never reads as an opening motion. A snap is a thumb-to-middle-fingertip
touch followed by a fast flick apart (under about 160 ms), at most once per 1.5 s, and it is ignored while you
talk or are inside a world. On hands, a middle-finger pinch no longer counts as a "grip", so a snap can't close
the window you happen to be pointing at. Tuning constants sit at the top of `src/gestures.js`; the resize math
is in `src/portalresize.js`.

## Controls in the headset

**How-to card:** a moment after you enter the headset, a card floats in front of you listing every action and
the gesture for it (talk, open a window by drawing a square or by asking Bonnie, move / resize a window, pick up a window or the companion with both hands,
step in and out, close a window, call the companion, show the buttons). Pinch it to close it; it also fades
after a minute or when you step inside a world. The rows live in `src/gesturecard.js`.

A button panel floats just below your gaze and follows you when you turn or walk away. Point at a button and
pull the trigger (or pinch): **Hold to talk**, **New window**, **Step inside / Step out**, **Hide buttons**,
the companion, the room background, **New story** and **Reset story** (see above), and **Close window** in the
far corner, away from the buttons you press most. The same buttons sit at the bottom of the screen on desktop,
plus **Room info**; the director console has New story, Reset and Prepare demo too.
**Hide buttons** (or click a thumbstick, or press H on desktop) leaves just a small **☰ Buttons** handle; point at it
to bring them back.


| Action | Hands | Touch controllers |
|---|---|---|
| Open a portal | Pinch at empty space | Trigger at empty space |
| Focus and move a portal | Pinch on it, drag, release | Trigger on it, drag, release |
| Pick up and throw Bonnie | Pinch and hold on Bonnie (near her is enough: she glows when you can), swing, release | Trigger and hold on Bonnie, swing, release |
| Resize a portal | Pinch it with both hands, then move the hands apart / together | n/a |
| Call Bonnie | Snap your fingers | The **Bonnie** button |
| Talk | Raise a hand to your mouth (or press and hold **Hold to talk** on the panel) | Hold A or X |
| Close a portal | Shake both hands | Grip while pointing at it |
| Step inside a portal | Part your hands like curtains, walk through it, or pinch it and pull it toward you | Walk through it, or press B / Y |
| Step back out | Bring your hands together or shake them, walk back ~60 cm, or pinch the blue ring | Walk back, or press B / Y |

**Drawing a window:** with your hands, pinch in empty space, draw a square or rectangle in the air, and let go: a
window opens exactly where you drew it, projected onto the wall at the size it looked (`src/drawportal.js`). A trail
of gold dots follows your fingers and flashes when it counts. With a controller, a quick trigger tap still opens one
straight ahead; a quick, still tap pointing at the ground in a 3D world teleports you. These are decided when you let go. Swinging to throw Bonnie, a pinch that slips off her, or pinching while she's in the
air (and for 1.5 s after a grab or throw) never opens a window.

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
 ├─ mic (push-to-talk) ─ 16 kHz PCM ───────► │  /api/transcribe → OpenAI STT  │
 └─ WebSocket ◄──── directions ───────────── │  /ws  story state + director   │
                                              │       (Claude, structured out)│
Director console (console.html) ── /ws ─────► └───────────────────────────────┘
```

* `src/orbis.js` runs one Orbis session per portal: one JWT per session, retry with backoff on
  "no capacity" (429), auto-restart when generation completes, server-side cleanup on close.
* `server/director.js` sends the focused window's own story bible, recent beats and prompt history to
  Claude and gets back `{narration, bible, updates[]}` as validated JSON (only that window can be updated). It follows the Orbis
  prompt guide: one continuous shot, and describe only what changes. Without a Claude key it falls
  back to a simple template so the demo still works.
* Each portal plays its Orbis audio through three.js `PositionalAudio`, so the sound comes from
  that wall.

## Team split

1. **XR:** `src/main.js`, `src/portal.js`. Portal placement on real walls (hit-test or planes),
   polish, and the in-headset UI.
2. **Orbis/backend:** `src/orbis.js`, `server/index.js`. Reliability with 3 parallel sessions,
   reconnects, and watching the credit dashboard.
3. **AI/voice:** `server/director.js`, `src/voice.js`. Prompt quality and
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
