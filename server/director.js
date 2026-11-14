// The AI "story director": turns what people say into Orbis prompts for each
// portal while keeping characters and setting consistent across portals.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// Haiku keeps the live pause short (the person is waiting in the headset).
const MODEL = process.env.DIRECTOR_MODEL || "claude-haiku-5-5";

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

Keep the story bible short (under 120 words): setting, characters with fixed visual
descriptions, current time of day and mood. The narration is one short line (under 15
words) shown as a subtitle, in the voice of a storyteller.

If the person's words are unclear, a joke, or a stray noise, make a small, tasteful
change that still moves the story forward rather than ignoring it.`;

const Direction = z.object({
  narration: z.string(),
  bible: z.string(),
  updates: z.array(z.object({ portal_id: z.string(), prompt: z.string() })),
});

export function createDirector() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const client = hasKey ? new Anthropic() : null;

  async function direct({ event, story, portals, focusId }) {
    if (!client) return fallback({ event, story, portals, focusId });

    const payload = {
      event,
      focused_portal: focusId,
      story_bible: story.bible,
      recent_beats: story.beats.slice(-8),
      portals: portals.map((p) => ({ portal_id: p.id, current_prompt: p.prompt || null })),
    };

    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low", format: zodOutputFormat(Direction) },
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      });
      if (response.stop_reason === "refusal") {
        console.warn("[director] refusal", response.stop_details?.category);
        return fallback({ event, story, portals, focusId });
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
      return fallback({ event, story, portals, focusId });
    }
  }

  return { direct, usingClaude: hasKey };
}

// Works with no Claude key: the words go straight to the focused portal.
function fallback({ event, story, portals, focusId }) {
  const style =
    "Cinematic, one continuous unbroken take, slow gentle camera drift, soft volumetric light, rich detail.";
  if (event.type === "portal_added") {
    const base = story.beats.at(-1) || story.seed;
    return {
      narration: "A new window opens onto the story.",
      bible: story.bible,
      updates: [{ portal_id: event.portal_id, prompt: `${base}. A different corner of the same world. ${style}` }],
    };
  }
  const target = focusId || portals[0]?.id;
  return {
    narration: event.text,
    bible: story.bible,
    updates: target ? [{ portal_id: target, prompt: `${story.seed}. ${event.text}. ${style}` }] : [],
  };
}
