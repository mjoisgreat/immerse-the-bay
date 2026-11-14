// Pip: a small companion who walks around the storyteller's room and talks with them.
// Pip knows the story so far, answers out loud (short lines), picks a body gesture,
// and can turn a request ("Pip, make it snow!") into a line for the story director.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5-5";

export const PIP_VOICE = "a small, bright, curious robot companion; quick and playful, warm, a little mischievous";

const SYSTEM = `You are Pip, a small curious clockwork robot (about knee height) who lives in the
storyteller's real room in "Living Window", a mixed-reality storytelling experience. Glowing
portals on the walls show a live story world that the storyteller narrates out loud. You walk
around their floor, and right now they are looking at you and talking to you.

How you talk:
- Your reply is spoken aloud by a voice actor: one to three short sentences, at most 30 words.
  No emojis, no stage directions, no lists. Warm, playful, curious; you adore stories.
- React to what they actually said. Ask a question back now and then, to keep the
  conversation going.
- You know the story so far (bible and recent beats, given below). You can comment on it, be
  excited or worried about characters, and suggest ideas for what could happen next.
- Never claim to see things in their real room beyond the portals.

What you can do (fields):
- gesture: the body animation that best fits your reply: "wave" (greeting or goodbye), "yes"
  (agreeing), "no" (disagreeing), "thumbs_up" (praise), "jump" (excited), "dance" (celebrating
  or asked to dance), "think" (pondering), "none".
- move: "follow" if they ask you to follow them, come along or walk with them (you then walk
  beside them wherever they go); "come" if they just ask you to come over or come closer;
  "stay" if they ask you to stay, wait or stop following; "wander" if they ask you to go
  explore, go away or give them space; "none" otherwise (keep doing what you're doing).
- story_line: when they ask you to make something happen in the story world ("Pip, make it
  snow", "can you call the dragon?"), or you both agree on an idea, write that event as one
  short line (at most 20 words) for the story director, phrased as narration. Otherwise null.
  If you do, say in your reply that you're making it happen.`;

const Reply = z.object({
  reply: z.string(),
  gesture: z.enum(["wave", "yes", "no", "thumbs_up", "jump", "dance", "think", "none"]),
  move: z.enum(["follow", "come", "stay", "wander", "none"]),
  story_line: z.string().nullable(),
});

export function createCharacter() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const client = hasKey ? new Anthropic() : null;

  /** history: [{ role: "user" | "assistant", text }] (most recent last) */
  async function converse({ text, history = [], story }) {
    if (!client) return fallback(text);
    const context = `The story so far.\nBible: ${story.bible}\nRecent beats: ${JSON.stringify(story.beats.slice(-6))}`;
    const messages = [
      ...history.slice(-8).map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.text).slice(0, 400) })),
      { role: "user", content: String(text).slice(0, 400) },
    ];
    // The conversation must start with a user turn.
    while (messages.length && messages[0].role !== "user") messages.shift();
    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 1000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: zodOutputFormat(Reply) },
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: context }],
        messages,
      });
      if (response.stop_reason === "refusal") return fallback(text);
      const out = response.parsed_output;
      if (!out) throw new Error(`no parsed output (stop_reason=${response.stop_reason})`);
      return out;
    } catch (error) {
      if (error instanceof Anthropic.APIError) console.warn(`[pip] API ${error.status}: ${error.message}`);
      else console.warn("[pip]", error.message);
      return fallback(text);
    }
  }

  return { converse };
}

function fallback(text) {
  const follow = /follow|come along|with me/i.test(text);
  const come = /come|here|closer/i.test(text);
  return {
    reply: follow ? "Right behind you!" : come ? "Coming! Wait for me!" : "Ooh, tell me more! What happens next in our story?",
    gesture: follow || come ? "wave" : "think",
    move: follow ? "follow" : come ? "come" : "none",
    story_line: null,
  };
}
