// The AI "story director": turns what people say into Orbis prompts for each
// portal while keeping characters and setting consistent across portals.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5-5";

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
- Never put text, captions, logos or UI in the picture. No real people or brands.
- Keep every recurring character described with the same words in every prompt
  (same name, clothing, colors) so they stay recognisable across portals.

Portals:
- The FOCUSED portal is the one the person is looking at; their words mainly steer it.
- Other portals show other places or viewpoints in the same story world. Update them
  only when the story clearly affects them (time of day, weather, a character moving
  between places), so the room feels like one connected world.
- When a portal is newly opened, give it a fresh view that fits the story so far
  (a different location or angle, never a copy of another portal).

Stepping inside:
- If immersed_portal is set, the person has walked INTO that portal: its video fills their
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
});

export function createDirector() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const client = hasKey ? new Anthropic() : null;

  async function direct({ event, story, portals, focusId, immersedId = null }) {
    if (!client) return fallback({ event, story, portals, focusId, immersedId });

    const payload = {
      event,
      focused_portal: focusId,
      immersed_portal: immersedId,
      story_bible: story.bible,
      recent_beats: story.beats.slice(-8),
      portals: portals.map((p) => ({ portal_id: p.id, current_prompt: p.prompt || null })),
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
        system: SYSTEM,
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") {
        console.warn("[director] refusal", response.stop_details?.category);
        return fallback({ event, story, portals, focusId, immersedId });
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
      return fallback({ event, story, portals, focusId, immersedId });
    }
  }

  return { direct, usingClaude: hasKey };
}

const IMMERSIVE =
  "First-person view from standing eye level through a 20 mm wide-angle lens, no fisheye, horizon level across the middle of the frame, sharp detail, an almost still camera, one continuous take.";

// Works with no Claude key: the words go straight to the focused portal.
function fallback({ event, story, portals, focusId, immersedId = null }) {
  const style =
    "Cinematic, one continuous unbroken take, slow gentle camera drift, soft volumetric light, rich detail.";
  const extra = { choices: [], speech: null };
  if (event.type === "step_inside") {
    const p = portals.find((x) => x.id === event.portal_id);
    const base = (p?.prompt || story.seed).replace(style, "");
    return {
      ...extra,
      narration: "You step through, and the world closes around you.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${base} ${IMMERSIVE}` }],
    };
  }
  if (event.type === "touch") {
    const p = portals.find((x) => x.id === event.portal_id);
    return {
      ...extra,
      narration: "Where you touch, the world shimmers and wakes.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${p?.prompt || story.seed} A soft ripple of golden light spreads from one spot, and the scene gently stirs.` }],
    };
  }
  if (event.type === "portal_added") {
    const base = story.beats.at(-1) || story.seed;
    return {
      ...extra,
      narration: "A new window opens onto the story.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${base}. A different corner of the same world. ${style}` }],
    };
  }
  const target = focusId || portals[0]?.id;
  const look = target && target === immersedId ? IMMERSIVE : style;
  return {
    ...extra,
    narration: event.text,
    bible: story.bible,
    updates: target ? [{ portal_id: target, prompt: `${story.seed}. ${event.text}. ${look}` }] : [],
  };
}
