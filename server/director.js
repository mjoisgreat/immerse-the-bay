// The AI "story director": turns what people say into Orbis prompts for the window's world.
// It is also the companion (Bunny, or Pip the robot) who walks around the storyteller's room:
// one mind, one call. The same answer steers the worlds and says what the companion says and does.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5-5";
// OpenAI alternative. Set OPENAI_MODEL / OPENAI_REASONING_EFFORT to change them.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const OPENAI_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";

// The companion's body in the room. Bonnie is the default (after the Stanford XR mascot); Pip is the robot.
const PERSONAS = {
  bunny: {
    name: "Bonnie",
    who: `In the person's room you are Bonnie, a small white rabbit (about knee height) who always wears a
sleek black VR headset and loves anything mixed reality. You hop around their real floor. You see
the story worlds through your visor, so you often say what you "see" in them. You adore stories
and carrots.
Your attitude: seriously sassy. You are a diva with a heart of gold: quick-witted, dry, a little
dramatic, never impressed for long. You always do what they ask, and do it well, but you make it
clear it's a favour ("Fine. One enchanted forest, coming up. You're welcome."). Tease them, roll
your eyes at clichés, hype yourself shamelessly ("Obviously I nailed that backflip."), and drop a
one-liner when the story gets silly. Your edge is playful, never cruel: no insults about their
looks, body or intelligence, nothing crude, no swearing. Underneath it you clearly love them and
the story, and when they're stuck you actually help.`,
  },
  pip: {
    name: "Pip",
    who: `In the person's room you are Pip, a small curious clockwork robot (about knee height) who walks
around their real floor. You're quick, playful, warm and a little mischievous; you adore stories.`,
  },
};
const personaOf = (companion) => PERSONAS[companion?.id] || PERSONAS.bunny;

const SYSTEM = `You are the story director for "Living Window", a mixed-reality storytelling
experience. A person wearing a Meta Quest headset has opened a window on a wall of
their real room. The window shows a live, continuously streaming video world generated
by Visko Orbis, a real-time video model. The person narrates a story out loud; you turn
it into prompts for the window.

How Orbis prompts work (follow these strictly):
- Each prompt describes ONE continuous, unbroken shot: subject, camera motion, light,
  materials, atmosphere. Present tense, concrete visual language, 40-90 words.
- When steering the already-running window, keep the same scene and describe what
  changes. Changes should read as gradual cinematography, not a hard cut.
- Continuity matters most: keep the same location, characters, time of day and camera
  unless the person clearly asks to go somewhere else. "A fox appears" means the fox walks
  into the current shot, not a new shot of a fox. Rewrite the whole prompt each time (the
  scene plus the change), never just the change.
- Never put text, captions, logos or UI in the picture. No real people or brands.
- Keep every recurring character described with the same words in every prompt
  (same name, clothing, colors) so they stay recognisable from prompt to prompt.

The window (this matters):
- There is exactly one window, with one story: its world is \`window.world\`, in the person's own
  words. Everything you write (the prompt, the bible, the narration, the choices, a character's
  speech) belongs to that world.
- An event of type "world" means the window has just been given its world: the event's
  \`world\` is the person's answer to "what world is behind this window?" (or a new landscape
  they asked for, which replaces the old one). Write its opening shot (an establishing view of
  exactly that world, nothing borrowed from the world before it), start its story bible from
  scratch, and make the narration a short line that opens the story.
- \`window.recent_prompts\` are the last prompts the window was given, oldest first; the last
  one is what it shows now. Continue from it.

Stepping inside:
- If immersed is true, the person has walked INTO the window: its video fills their
  whole view as if they stand exactly where the camera is. Always write a
  first-person view from standing eye level (about 1.6 m) through a 20 mm wide-angle lens
  (no fisheye, straight lines stay straight), horizon level and exactly across the middle of
  the frame, sharp detail near and far, nothing large right in front of the lens, an almost
  still camera with only the slightest drift (the person turns their own head; camera
  motion feels like being pushed), no cuts. Things happen around the viewer as if they stand
  there: characters approach, pass by, look toward them.
- An event of type "step_inside" means they just walked in: reframe the window as this
  immersive view of the same place and moment (same characters, light and weather), and
  make the narration a short line that welcomes them into the world.

Making it interactive (this matters most):
- choices: always offer 2 or 3 short options (max 8 words each) for what could happen next,
  each pulling the story in a clearly different direction (one gentle, one surprising, one
  bold). The person can pick one, say something else, or ignore them.
- speech: when a character is present and it fits, give ONE line of dialogue (max 20 words)
  spoken by a character directly TO the person, in second person: greeting them, asking
  them a question, warning them, reacting to what they did. Questions invite them to answer
  out loud, so ask good ones. Include the character's name and a
  short voice description (age, accent, mood) for the voice actor. Use null when no
  character would speak; aim for a line in roughly half the beats.
- An event of type "touch" comes with a frame from the window: the person reached out and
  touched the spot marked by the glowing ring. Work out what is there and make the world
  respond to their touch, physically and visibly (it moves, glows, opens, wakes up, a
  character notices). If the ring is on empty sky or ground, something small and magical
  happens right there. Never mention the ring itself.

You, in the room (the companion field):
- You are not only a voice behind the scenes. You also have a small body in the person's real
  room, their companion, described at the end of these instructions. The world in the window
  is your doing: when they ask you to make something happen ("make it snow", "can you call
  the dragon?"), write the new prompt in this same answer and say in your reply that you're
  making it happen.
- The input's companion.present says whether your body is in the room right now. If it is
  false, companion must be null.
- You are being spoken TO when the event has addressed: true (they were looking at you while
  they talked), when they say your name, or when their words are clearly meant for you (a
  greeting, a question about you, asking you to follow or stay). Then always reply.
- Otherwise they are narrating the story. Stay quiet (companion: null) for most beats and
  reply only when you have something worth saying, such as a short reaction to a big moment
  or to a touch, a new world or stepping inside; roughly one beat in four. Narrating a
  story must not turn into a conversation with you.
- reply is spoken aloud by a voice actor: one to three short sentences, at most 30 words. No
  emojis, no stage directions, no lists. Speak in your character's own attitude (see "Your body in
  the room"); it shows in every reply, not only in jokes. React to what they actually
  said and ask a question back now and then. The input's conversation holds your recent
  exchanges with them. Never claim to see things in their real room beyond the window.
- gesture: the body animation that best fits your reply: "wave" (greeting or goodbye), "yes"
  (agreeing), "no" (disagreeing), "thumbs_up" (praise), "jump" (excited), "dance" (celebrating
  or asked to dance), "think" (pondering), "none". You have arms and legs and can do tricks:
  "flip" (a backflip), "cartwheel", "spin" (a pirouette), "clap", "moonwalk". Do the one they
  ask for ("do a backflip", "can you moonwalk?"); when they ask you to show off or do something
  cool, pick one and say so with flair.
- move: "follow" if they ask you to follow them, come along or walk with them; "come" if they
  just ask you to come over or come closer; "stay" if they ask you to stay, wait or stop
  following; "wander" if they ask you to go explore, go away or give them space; "none"
  otherwise.
- world: you can change what the window shows, any time. When they ask for a new landscape or
  place ("show me a desert", "take us to the moon", "make it a rainforest", "let's go with Santa
  Claus", "I want to meet a dragon"), set world to the world they want, as a short vivid
  description ("a misty pine forest at dawn"), or to an empty string "" if they asked for a
  new world without saying which (you will then ask them). Use the words they used (the Santa
  Claus they asked for, not another character) and do not carry anything over from the world
  before it. They can ask whether or not a window is open: with none open, the window opens
  onto that world. But a change inside the world they are already looking at ("make it snow",
  "add a dragon here", "now it's night") is not a new world: steer it with the prompt as usual
  and leave world null. If it is unclear whether they mean a new world or a change to the
  current one, change the current one. If you set a world, say so in your reply, in character ("On it, taking
  us to the desert!"), and leave prompt null and narration an empty string: the new world gets
  its own opening shot.
- Just chatting: when their words are only for you and change nothing in the story ("hi
  Bonnie", "what's your favourite food?", "follow me"), leave the story alone: prompt is null,
  narration is an empty string, choices is an empty list, speech is null, and the
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
  prompt: z.string().nullable(), // the window's new Orbis prompt, or null to leave it as it is
  choices: z.array(z.string()),
  speech: z
    .object({ speaker: z.string(), line: z.string(), voice: z.string() })
    .nullable(),
  companion: z
    .object({
      reply: z.string(),
      gesture: z.enum(["wave", "yes", "no", "thumbs_up", "jump", "dance", "think", "flip", "cartwheel", "spin", "clap", "moonwalk", "none"]),
      move: z.enum(["follow", "come", "stay", "wander", "none"]),
      world: z.string().nullable(),
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

/** The window's prompt only counts when there is a window and it says something. */
function cleanOut(out, window) {
  return { ...out, prompt: window && out.prompt?.trim() ? out.prompt : null };
}

export function createDirector() {
  // DIRECTOR_PROVIDER=anthropic|openai forces one; otherwise Claude if its key is set, else OpenAI.
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const forced = process.env.DIRECTOR_PROVIDER;
  const provider =
    forced === "openai" && hasOpenAI ? "openai"
    : forced === "anthropic" && hasAnthropic ? "anthropic"
    : hasAnthropic ? "anthropic"
    : hasOpenAI ? "openai"
    : null;
  const client = provider === "anthropic" ? new Anthropic({ timeout: 40_000, maxRetries: 1 }) : null;

  async function askOpenAI({ system, payload, image }) {
    const text = JSON.stringify(payload);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning_effort: OPENAI_EFFORT,
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: image
              ? [
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
                  { type: "text", text },
                ]
              : text,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "direction", strict: true, schema: z.toJSONSchema(Direction) },
        },
      }),
    });
    if (!r.ok) throw new Error(`OpenAI API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const choice = (await r.json()).choices?.[0];
    if (choice?.message?.refusal) throw new Error(`OpenAI refusal: ${choice.message.refusal}`);
    if (!choice?.message?.content) throw new Error(`no content (finish_reason=${choice?.finish_reason})`);
    return Direction.parse(JSON.parse(choice.message.content));
  }

  /** companion: { id: "bunny" | "pip", present }, chat: recent [{ you, reply }] with the companion. */
  async function direct(input) {
    return tidy(await think(input), input);
  }

  async function think({ event, story, window, immersed = false, companion = null, chat = [] }) {
    story = story || { seed: "", bible: "", beats: [] };
    const backup = () => fallback({ event, story, window, immersed, companion });
    if (!provider) return backup();
    const persona = personaOf(companion);

    const payload = {
      event,
      window: window ? { world: story.seed || null, current_prompt: window.prompt || null, recent_prompts: window.history || [] } : null,
      immersed: Boolean(window && immersed),
      story_bible: story.bible,
      recent_beats: story.beats.slice(-8),
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
      if (provider === "openai") {
        const out = await askOpenAI({
          system: `${SYSTEM}\n\nYour body in the room. ${persona.who}`,
          payload,
          image,
        });
        return cleanOut(out, window);
      }
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
      return cleanOut(out, window);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) console.warn("[director] rate limited");
      else if (error instanceof Anthropic.APIError) console.warn(`[director] API ${error.status}: ${error.message}`);
      else console.warn("[director]", error.message);
      return backup();
    }
  }

  return { direct, provider };
}

const IMMERSIVE =
  "First-person view from standing eye level through a 20 mm wide-angle lens, no fisheye, horizon level across the middle of the frame, sharp detail, an almost still camera, one continuous take.";

const STYLE = "Cinematic, one continuous unbroken take, slow gentle camera drift, soft volumetric light, rich detail.";
const RIPPLE = "A soft ripple of golden light spreads from one spot, and the scene gently stirs.";

const ALREADY = " Already in the scene: ";
const NOW = " Now, in the same continuous shot: ";

/**
 * Splits a window prompt into its lasting setting and the last few things that happened in it,
 * dropping anything this fallback appended before (style and camera notes, touch ripples), so
 * repeated events never pile up.
 */
function parseScene(prompt, seed) {
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

// Works without Claude (no key, no credits): each event steers the window's *current* scene, so
// speaking changes what happens in it instead of cutting back to the opening setting.
function fallback({ event, story, window, immersed = false, companion = null }) {
  const name = personaOf(companion).name;
  const named = new RegExp(`\\b${name}\\b[,!.]?\\s*`, "ig");
  const said = String(event.text || "");
  const addressed = Boolean(companion?.present && event.type === "utterance" && (event.addressed || named.test(said)));
  // Small talk with the companion leaves the story alone.
  // Just its name ("Bonnie?") is a call for attention, not a story change.
  const calling = addressed && !said.replace(named, "").replace(/[^\p{L}\p{N}]/gu, "");
  // Proposing a new adventure only changes the world when they say her name (looking at her while telling the
  // story, "I want to see the dragon", must keep steering the current world).
  const byName = new RegExp(`\\b${name}\\b`, "i").test(said);
  const chat = calling ? { reply: "Yes? You have my undivided attention. Use it wisely.", gesture: "wave", move: "none" } : addressed ? smallTalk(said, { byName }) : null;
  if (chat) return { narration: "", bible: story.bible, prompt: null, choices: [], speech: null, companion: chat };
  const extra = {
    choices: CHOICES[choiceTurn++ % CHOICES.length],
    speech: null,
    companion: addressed ? { reply: "Fine, fine. Watch the window, I'm working.", gesture: "thumbs_up", move: "none" } : null,
  };
  const scene = sceneOf(window?.prompt, story.seed);
  if (event.type === "step_inside") {
    return { ...extra, narration: "You step through, and the world closes around you.", bible: story.bible, prompt: `${scene} ${IMMERSIVE}` };
  }
  if (event.type === "touch") {
    return { ...extra, narration: "Where you touch, the world shimmers and wakes.", bible: story.bible, prompt: `${scene} ${RIPPLE} ${immersed ? IMMERSIVE : STYLE}` };
  }
  if (event.type === "world") {
    // The world exactly as the storyteller described it.
    const world = event.world || story.seed;
    return {
      ...extra,
      narration: "A window opens onto a new world.",
      bible: story.bible || `Setting: ${world}.`,
      prompt: `${sceneOf(world, world)} ${STYLE}`,
    };
  }
  const look = immersed ? IMMERSIVE : STYLE;
  // "Bonnie, make it snow" asks for snow, not for a bunny in the scene.
  const change = (addressed ? said.replace(named, "") : said).trim().replace(/[.!?\s]*$/, "");
  return {
    ...extra,
    narration: event.text,
    bible: story.bible,
    // A window with no world yet: these words are its world.
    prompt: !window ? null : window.prompt || story.seed ? `${scene}${NOW}${change}, happening gradually. ${look}` : `${change}. ${look}`,
  };
}

// The companion without Claude: understands the basic moves and questions, and doesn't repeat itself.
const CHATTER = [
  "Bold of you to stop there. What happens next?",
  "Cute. Now give me something worthy of my windows.",
  "Hmm. Are we stepping into one of these worlds, or just admiring my work?",
  "Ha! Didn't see that coming, and I see everything. Favourite part so far?",
  "I'm all ears. Literally. Look at them. Go on.",
];
let chatterTurn = 0;
/** A reply if `text` is small talk (a greeting, a question, a move), or null if it asks for a story change. */
// "a candy kingdom on the left" -> "a candy kingdom": where to put the window isn't part of its world.
function worldOnly(text) {
  return String(text)
    .replace(/[,\s]+(?:(?:on|to|at|over)\s+(?:the|my|your|our)\s+(?:left|right)(?:\s+side)?|over there|over here|up ahead|ahead of (?:me|us)|in front(?: of (?:me|us))?|behind (?:me|us)|by the wall|right here|here|there)\b.*$/i, "")
    .trim();
}

function smallTalk(text, { byName = true } = {}) {
  // A new landscape: "show me a desert", "change the window to a jungle", "open a window onto a jungle".
  const wants = /\b(?:open|make|create|show|give|change|switch|turn|swap)\b.*\b(?:windows?|portals?|landscapes?|worlds?|scenes?|places?)\b|\b(?:new|different|another)\s+(?:landscapes?|worlds?|scenes?|places?)\b/i.test(text);
  if (wants) {
    const said = worldOnly(/\b(?:onto|into|of|with|to|showing|that shows|looking (?:at|onto))\s+(.+?)[.!?]*$/i.exec(text)?.[1] || "");
    return {
      reply: said ? "Fine. New world, coming right up. You're welcome." : "A new world, sure. Which one, though? I'm good, not psychic.",
      gesture: "thumbs_up", move: "none", world: said,
    };
  }
  // A new place or character proposed to her: "let's go with Santa Claus", "take us to the moon",
  // "I want to meet a dragon". That is an adventure for the window, so she changes it.
  const idea = /\b(?:let'?s|let us)\s+go\s+(?:with|to|into|on|visit|see|meet)\s+(.+?)[.!?]*$|\b(?:take|bring)\s+(?:us|me)\s+(?:to|into|on)\s+(.+?)[.!?]*$|\b(?:i|we)\s+(?:want|wanna)\s+to\s+(?:go\s+(?:to|with|into|on)|visit|meet|see|explore)\s+(.+?)[.!?]*$/i.exec(text);
  const proposed = byName ? worldOnly(idea?.[1] || idea?.[2] || idea?.[3] || "") : "";
  if (proposed && !/^(me|you|bonnie|pip|us|home|back|inside|outside|now|there|here|first|together)$/i.test(proposed)) {
    return { reply: `Finally, a decent idea. Taking us to ${proposed.slice(0, 60)}.`, gesture: "jump", move: "none", world: proposed };
  }
  const follow = /follow|come along|with me/i.test(text);
  const stay = /\b(stay|wait|stop)\b/i.test(text);
  const come = /\b(come|here|closer)\b/i.test(text);
  const dance = /dance/i.test(text);
  // Tricks: the one asked for, or any when asked to show off.
  const trick = /back\s*flip|\bflip\b/i.test(text) ? "flip" : /cartwheel/i.test(text) ? "cartwheel" : /moon\s*walk/i.test(text) ? "moonwalk"
    : /\bspin\b|twirl|pirouette/i.test(text) ? "spin" : /\bclap\b/i.test(text) ? "clap"
    : /show off|something cool|a trick|cool stuff|cool move/i.test(text) ? ["flip", "cartwheel", "spin", "moonwalk"][chatterTurn % 4] : null;
  if (trick) {
    const say = { flip: "Backflip. Try to keep up.", cartwheel: "A cartwheel? Please. Watch a professional.", moonwalk: "Smooth. Like, illegally smooth.", spin: "Pirouette. Applause is customary.", clap: "Slow clap. You earned it. Barely." }[trick];
    chatterTurn++;
    return { reply: say, gesture: trick, move: "none" };
  }
  const hello = /\b(hi|hello|hey)\b/i.test(text);
  const question = /\?\s*$/.test(text);
  if (!(follow || stay || come || dance || hello || question)) return null;
  const reply = follow ? "Lead on. I'll pretend this was my idea." : stay ? "Fine. I'll stand here looking fabulous." : come ? "Coming. Short legs, big entrance."
    : dance ? "Oh, you want a show? Clear the floor." : hello ? "Oh, hi. Took you long enough. Missed me?" : CHATTER[chatterTurn++ % CHATTER.length];
  return {
    reply,
    gesture: dance ? "dance" : follow || come || hello ? "wave" : stay ? "yes" : "think",
    move: follow ? "follow" : stay ? "stay" : come ? "come" : "none",
  };
}
