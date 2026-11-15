// The AI "story director": turns what people say into Orbis prompts for each
// portal. Every portal is its own story (its own world, bible and history): see server/core.js.
// It is also the companion (Bunny, or Pip the robot) who walks around the storyteller's room:
// one mind, one call. The same answer steers the worlds and says what the companion says and does.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5-5";

// The companion's body in the room. Bunny is the default (after the Stanford XR mascot); Pip is the robot.
export const PERSONAS = {
  bunny: {
    name: "Bunny",
    who: `In the person's room you are Bunny, a small white rabbit (about knee height) who always wears a
sleek black VR headset and loves anything mixed reality. You hop around their real floor. You see
the story worlds through your visor, so you often say what you "see" in them. You're curious,
upbeat and a bit cheeky; you adore stories and carrots.`,
  },
  pip: {
    name: "Pip",
    who: `In the person's room you are Pip, a small curious clockwork robot (about knee height) who walks
around their real floor. You're quick, playful, warm and a little mischievous; you adore stories.`,
  },
};
const personaOf = (companion) => PERSONAS[companion?.id] || PERSONAS.bunny;

const SYSTEM = `You are the story director for "Living Window", a mixed-reality storytelling
experience. A person wearing a Meta Quest headset has opened portals on the walls of
their real room. Each portal shows a live, continuously streaming video world generated
by Visko Orbis, a real-time video model. The person narrates a story out loud; you turn
it into prompts for each portal.

How Orbis prompts work (follow these strictly):
- Each prompt describes ONE continuous, unbroken shot: subject, camera motion, light,
  materials, atmosphere. Present tense, concrete visual language, 40-90 words.
- When steering an already-running portal, keep the same scene and describe what
  changes. Changes should read as gradual cinematography, not a hard cut.
- Continuity matters most: keep the same location, characters, time of day and camera
  unless the person clearly asks to go somewhere else. "A fox appears" means the fox walks
  into the current shot, not a new shot of a fox. Rewrite the whole prompt each time (the
  scene plus the change), never just the change.
- Never put text, captions, logos or UI in the picture. No real people or brands.
- Keep every recurring character described with the same words in every prompt
  (same name, clothing, colors) so they stay recognisable from prompt to prompt.

Windows are separate stories (this matters):
- Each portal ("window") is its OWN story with its own world, characters, story bible and
  history. You are given exactly one of them: \`window\`, the one the person is looking at. Its
  world is \`window.world\`, in the person's own words. Everything you write (the prompt, the
  bible, the narration, the choices, a character's speech) belongs to that window alone.
- updates may only contain that one window's portal_id. Never carry places, characters,
  weather or events from one window into another, and never try to change another window.
- \`other_windows\` lists what the other windows show, for your information only (so that, as the
  companion, you can talk about them). They are different worlds; leave them alone.
- An event of type "portal_added" means this window has just been given its world: the event's
  \`world\` is the person's answer to "what world is behind this window?". Write its opening shot
  (an establishing view of exactly that world, nothing borrowed from other windows), start its
  story bible from scratch, and make the narration a short line that opens the story.
- \`window.recent_prompts\` are the last prompts this window was given, oldest first; the last
  one is what it shows now. Continue from it.

Stepping inside:
- If immersed is true, the person has walked INTO this window: its video fills their
  whole view as if they stand exactly where the camera is. For that portal always write a
  first-person view from standing eye level (about 1.6 m) through a 20 mm wide-angle lens
  (no fisheye, straight lines stay straight), horizon level and exactly across the middle of
  the frame, sharp detail near and far, nothing large right in front of the lens, an almost
  still camera with only the slightest drift (the person turns their own head; camera
  motion feels like being pushed), no cuts. Things happen around the viewer as if they stand
  there: characters approach, pass by, look toward them.
- An event of type "step_inside" means they just walked in: reframe that portal as this
  immersive view of the same place and moment (same characters, light and weather), and
  make the narration a short line that welcomes them into the world.

Making it interactive (this matters most):
- choices: always offer 2 or 3 short options (max 8 words each) for what could happen next,
  each pulling the story in a clearly different direction (one gentle, one surprising, one
  bold). The person can pick one, say something else, or ignore them.
- speech: when a character is present and it fits, give ONE line of dialogue (max 20 words)
  spoken by a character directly TO the person, in second person: greeting them, asking
  them a question, warning them, reacting to what they did. Questions invite them to answer
  out loud, so ask good ones. Include the character's name, the portal they are in, and a
  short voice description (age, accent, mood) for the voice actor. Use null when no
  character would speak; aim for a line in roughly half the beats.
- An event of type "touch" comes with a frame from that portal: the person reached out and
  touched the spot marked by the glowing ring. Work out what is there and make the world
  respond to their touch, physically and visibly (it moves, glows, opens, wakes up, a
  character notices). If the ring is on empty sky or ground, something small and magical
  happens right there. Never mention the ring itself.

You, in the room (the companion field):
- You are not only a voice behind the scenes. You also have a small body in the person's real
  room, their companion, described at the end of these instructions. The worlds in the portals
  are your doing: when they ask you to make something happen ("make it snow", "can you call
  the dragon?"), write the portal updates in this same answer and say in your reply that you're
  making it happen.
- The input's companion.present says whether your body is in the room right now. If it is
  false, companion must be null.
- You are being spoken TO when the event has addressed: true (they were looking at you while
  they talked), when they say your name, or when their words are clearly meant for you (a
  greeting, a question about you, asking you to follow or stay). Then always reply.
- Otherwise they are narrating the story. Stay quiet (companion: null) for most beats and
  reply only when you have something worth saying, such as a short reaction to a big moment
  or to a touch, a new window or stepping inside; roughly one beat in four. Narrating a
  story must not turn into a conversation with you.
- reply is spoken aloud by a voice actor: one to three short sentences, at most 30 words. No
  emojis, no stage directions, no lists. Warm, playful, curious. React to what they actually
  said and ask a question back now and then. The input's conversation holds your recent
  exchanges with them. Never claim to see things in their real room beyond the portals.
- gesture: the body animation that best fits your reply: "wave" (greeting or goodbye), "yes"
  (agreeing), "no" (disagreeing), "thumbs_up" (praise), "jump" (excited), "dance" (celebrating
  or asked to dance), "think" (pondering), "none".
- move: "follow" if they ask you to follow them, come along or walk with them; "come" if they
  just ask you to come over or come closer; "stay" if they ask you to stay, wait or stop
  following; "wander" if they ask you to go explore, go away or give them space; "none"
  otherwise.
- Just chatting: when their words are only for you and change nothing in the story ("hi
  Bunny", "what's your favourite food?", "follow me"), leave the story alone: updates is an
  empty list, narration is an empty string, choices is an empty list, speech is null, and the
  bible is returned unchanged. Do not invent a story change to go with small talk.
- Only one voice can play at a time: never give both a companion reply and a character's
  speech in the same answer. If you were spoken to, the reply wins.

Keep the story bible short (under 120 words): setting, characters with fixed visual
descriptions, current time of day and mood. The narration is one short line (under 15
words) shown as a subtitle, in the voice of a storyteller.

If the person's words are unclear, a joke, or a stray noise, make a small, tasteful
change that still moves the story forward rather than ignoring it.`;

const Direction = z.object({
  narration: z.string(),
  bible: z.string(),
  updates: z.array(z.object({ portal_id: z.string(), prompt: z.string() })),
  choices: z.array(z.string()),
  speech: z
    .object({ speaker: z.string(), portal_id: z.string(), line: z.string(), voice: z.string() })
    .nullable(),
  companion: z
    .object({
      reply: z.string(),
      gesture: z.enum(["wave", "yes", "no", "thumbs_up", "jump", "dance", "think", "none"]),
      move: z.enum(["follow", "come", "stay", "wander", "none"]),
    })
    .nullable(),
});

/** One voice per beat, and no companion lines when the companion isn't in the room. */
function tidy(out, { event, companion }) {
  let c = companion?.present && out.companion?.reply?.trim() ? out.companion : null;
  let speech = out.speech?.line?.trim() ? out.speech : null;
  if (c && speech) event.addressed ? (speech = null) : (c = null);
  return { ...out, companion: c, speech };
}

export function createDirector() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const client = hasKey ? new Anthropic() : null;

  /** companion: { id: "bunny" | "pip", present }, chat: recent [{ you, reply }] with the companion. */
  async function direct(input) {
    return tidy(await think(input), input);
  }

  async function think({ event, story, portals, others = [], focusId, immersedId = null, companion = null, chat = [] }) {
    story = story || { seed: "", bible: "", beats: [] };
    const backup = () => fallback({ event, story, portals, focusId, immersedId, companion });
    if (!client) return backup();
    const persona = personaOf(companion);

    const payload = {
      event,
      window: portals[0]
        ? { portal_id: portals[0].id, world: story.seed || null, current_prompt: portals[0].prompt || null, recent_prompts: portals[0].history || [] }
        : null,
      immersed: Boolean(portals[0] && immersedId === portals[0].id),
      story_bible: story.bible,
      recent_beats: story.beats.slice(-8),
      other_windows: others.map((o) => ({ portal_id: o.id, world: o.world || null, shows: o.prompt || null })),
      companion: { name: persona.name, present: Boolean(companion?.present) },
      conversation: chat.slice(-6),
    };

    // A touch event carries the frame as an image; it is sent to Claude but kept out of the JSON.
    const { image, ...plainEvent } = event;
    payload.event = plainEvent;
    const content = image
      ? [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: JSON.stringify(payload) },
        ]
      : JSON.stringify(payload);

    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: zodOutputFormat(Direction) },
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: `Your body in the room. ${persona.who}` }],
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") {
        console.warn("[director] refusal", response.stop_details?.category);
        return backup();
      }
      const out = response.parsed_output;
      if (!out) throw new Error(`no parsed output (stop_reason=${response.stop_reason})`);
      const ids = new Set(portals.map((p) => p.id));
      out.updates = out.updates.filter((u) => ids.has(u.portal_id) && u.prompt.trim());
      return out;
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) console.warn("[director] rate limited");
      else if (error instanceof Anthropic.APIError) console.warn(`[director] API ${error.status}: ${error.message}`);
      else console.warn("[director]", error.message);
      return backup();
    }
  }

  return { direct, usingClaude: hasKey };
}

const IMMERSIVE =
  "First-person view from standing eye level through a 20 mm wide-angle lens, no fisheye, horizon level across the middle of the frame, sharp detail, an almost still camera, one continuous take.";

const STYLE = "Cinematic, one continuous unbroken take, slow gentle camera drift, soft volumetric light, rich detail.";
const RIPPLE = "A soft ripple of golden light spreads from one spot, and the scene gently stirs.";

const ALREADY = " Already in the scene: ";
const NOW = " Now, in the same continuous shot: ";

/**
 * Splits a portal prompt into its lasting setting and the last few things that happened in it,
 * dropping anything this fallback appended before (style and camera notes, touch ripples), so
 * repeated events never pile up.
 */
export function parseScene(prompt, seed) {
  let p = ` ${String(prompt || "").trim()} `;
  for (const tail of [STYLE, IMMERSIVE, RIPPLE]) p = p.split(tail).join(" ");
  const [before, now = ""] = p.split(NOW);
  const [settingRaw, alreadyRaw = ""] = before.split(ALREADY);
  const recent = alreadyRaw.split(";").map((x) => x.trim().replace(/[.\s]*$/, "")).filter(Boolean);
  const current = now.replace(/, happening gradually\.?/, "").trim().replace(/[.\s]*$/, "");
  if (current) recent.push(current);
  let setting = settingRaw.replace(/\s+/g, " ").trim();
  if (!setting) setting = seed;
  // Keep the setting to a few sentences so the prompt stays in Orbis's sweet spot.
  if (setting.length > 380) {
    const cut = setting.slice(0, 380);
    setting = cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, 200)).trim();
  }
  return { setting: setting.replace(/[.\s]*$/, "."), recent };
}

/** The setting plus the last two things that happened, ready for a new change or a style note. */
export function sceneOf(prompt, seed) {
  const { setting, recent } = parseScene(prompt, seed);
  const keep = recent.slice(-2);
  return keep.length ? `${setting}${ALREADY}${keep.join("; ")}.` : setting;
}

const CHOICES = [
  ["Something magical appears nearby", "The weather slowly changes", "A curious stranger arrives"],
  ["A hidden path is revealed", "Night begins to fall", "Music drifts in from somewhere"],
  ["An animal comes to investigate", "The light turns golden", "Something sparkles in the distance"],
];
let choiceTurn = 0;

// Works without Claude (no key, no credits): each event steers the portal's *current* scene, so
// speaking changes what happens in it instead of cutting back to the opening setting.
function fallback({ event, story, portals, focusId, immersedId = null, companion = null }) {
  const name = personaOf(companion).name;
  const named = new RegExp(`\\b${name}\\b[,!.]?\\s*`, "ig");
  const said = String(event.text || "");
  const addressed = Boolean(companion?.present && event.type === "utterance" && (event.addressed || named.test(said)));
  // Small talk with the companion leaves the story alone.
  // Just its name ("Bunny?") is a call for attention, not a story change.
  const calling = addressed && !said.replace(named, "").replace(/[^\p{L}\p{N}]/gu, "");
  const chat = calling ? { reply: "Yes? I'm listening!", gesture: "wave", move: "none" } : addressed ? smallTalk(said) : null;
  if (chat) return { narration: "", bible: story.bible, updates: [], choices: [], speech: null, companion: chat };
  const extra = {
    choices: CHOICES[choiceTurn++ % CHOICES.length],
    speech: null,
    companion: addressed ? { reply: "On it! Watch the window.", gesture: "thumbs_up", move: "none" } : null,
  };
  const find = (id) => portals.find((x) => x.id === id);
  if (event.type === "step_inside") {
    return {
      ...extra,
      narration: "You step through, and the world closes around you.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${sceneOf(find(event.portal_id)?.prompt, story.seed)} ${IMMERSIVE}` }],
    };
  }
  if (event.type === "touch") {
    const look = event.portal_id === immersedId ? IMMERSIVE : STYLE;
    return {
      ...extra,
      narration: "Where you touch, the world shimmers and wakes.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${sceneOf(find(event.portal_id)?.prompt, story.seed)} ${RIPPLE} ${look}` }],
    };
  }
  if (event.type === "portal_added") {
    // This window's own world, exactly as the storyteller described it.
    const world = event.world || story.seed;
    return {
      ...extra,
      narration: "A window opens onto a new world.",
      bible: story.bible || `Setting: ${world}.`,
      updates: [{ portal_id: event.portal_id, prompt: `${sceneOf(world, world)} ${STYLE}` }],
    };
  }
  const target = find(focusId) ? focusId : portals[0]?.id;
  const look = target && target === immersedId ? IMMERSIVE : STYLE;
  const scene = sceneOf(find(target)?.prompt, story.seed);
  // "Bunny, make it snow" asks for snow, not for a bunny in the scene.
  const change = (addressed ? said.replace(named, "") : said).trim().replace(/[.!?\s]*$/, "");
  return {
    ...extra,
    narration: event.text,
    bible: story.bible,
    // A window with no world yet: these words are its world.
    updates: !target ? [] : [{ portal_id: target, prompt: find(target)?.prompt || story.seed ? `${scene}${NOW}${change}, happening gradually. ${look}` : `${change}. ${look}` }],
  };
}

// The companion without Claude: understands the basic moves and questions, and doesn't repeat itself.
const CHATTER = [
  "Ooh, tell me more! What happens next in our story?",
  "I love that! What should we try in the windows?",
  "Hmm, interesting. Do you want to step inside one of the worlds with me?",
  "Ha! You always surprise me. What's your favourite part so far?",
  "I'm all ears. What next?",
];
let chatterTurn = 0;
/** A reply if `text` is small talk (a greeting, a question, a move), or null if it asks for a story change. */
function smallTalk(text) {
  const follow = /follow|come along|with me/i.test(text);
  const stay = /\b(stay|wait|stop)\b/i.test(text);
  const come = /\b(come|here|closer)\b/i.test(text);
  const dance = /dance/i.test(text);
  const hello = /\b(hi|hello|hey)\b/i.test(text);
  const question = /\?\s*$/.test(text);
  if (!(follow || stay || come || dance || hello || question)) return null;
  const reply = follow ? "Right behind you!" : stay ? "Okay, I'll wait right here." : come ? "Coming! Wait for me!"
    : dance ? "Watch these moves!" : hello ? "Hi there! I'm so happy you're here." : CHATTER[chatterTurn++ % CHATTER.length];
  return {
    reply,
    gesture: dance ? "dance" : follow || come || hello ? "wave" : stay ? "yes" : "think",
    move: follow ? "follow" : stay ? "stay" : come ? "come" : "none",
  };
}
