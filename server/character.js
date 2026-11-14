// The companion (Bunny, or Pip the robot) who walks around the storyteller's room and talks with
// them. It knows the story so far, answers out loud (short lines), picks a body gesture, and can
// turn a request ("Bunny, make it snow!") into a line for the story director.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5-5";

// Who the companion is. Bunny is the default (after the Stanford XR mascot); Pip is the robot.
export const PERSONAS = {
  bunny: {
    name: "Bunny",
    voice: "a bright, friendly young voice; bubbly, quick and a little cheeky, full of wonder",
    who: `You are Bunny, a small white rabbit (about knee height) who always wears a sleek black VR
headset and loves anything mixed reality. You live in the storyteller's real room in "Living
Window", a mixed-reality storytelling experience. Glowing portals on the walls show a live story
world that the storyteller narrates out loud. You hop around their floor, and right now they are
looking at you and talking to you. You see the story worlds through your visor, so you often say
what you "see" in them. You're curious, upbeat and a bit cheeky; you adore stories and carrots.`,
  },
  pip: {
    name: "Pip",
    voice: "a small, bright, curious robot companion; quick and playful, warm, a little mischievous",
    who: `You are Pip, a small curious clockwork robot (about knee height) who lives in the
storyteller's real room in "Living Window", a mixed-reality storytelling experience. Glowing
portals on the walls show a live story world that the storyteller narrates out loud. You walk
around their floor, and right now they are looking at you and talking to you.`,
  },
};

const RULES = `
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
- story_line: when they ask you to make something happen in the story world ("make it
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
  async function converse({ text, history = [], story, character = "bunny" }) {
    const persona = PERSONAS[character] || PERSONAS.bunny;
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
        system: [{ type: "text", text: persona.who + "\n" + RULES }, { type: "text", text: context }],
        messages,
      });
      if (response.stop_reason === "refusal") return fallback(text);
      const out = response.parsed_output;
      if (!out) throw new Error(`no parsed output (stop_reason=${response.stop_reason})`);
      return out;
    } catch (error) {
      if (error instanceof Anthropic.APIError) console.warn(`[companion] API ${error.status}: ${error.message}`);
      else console.warn("[companion]", error.message);
      return fallback(text);
    }
  }

  return { converse };
}

// Used when Claude is unavailable: understands the basic moves, and doesn't repeat itself.
const CHATTER = [
  "Ooh, tell me more! What happens next in our story?",
  "I love that! What should we try in the windows?",
  "Hmm, interesting. Do you want to step inside one of the worlds with me?",
  "Ha! You always surprise me. What's your favourite part so far?",
  "I'm all ears. Literally, look at them! What next?",
];
let chatterTurn = 0;
function fallback(text) {
  const follow = /follow|come along|with me/i.test(text);
  const stay = /\b(stay|wait|stop)\b/i.test(text);
  const come = /\b(come|here|closer)\b/i.test(text);
  const dance = /dance/i.test(text);
  const hello = /\b(hi|hello|hey)\b/i.test(text);
  const reply = follow ? "Right behind you!" : stay ? "Okay, I'll wait right here." : come ? "Coming! Wait for me!"
    : dance ? "Watch these moves!" : hello ? "Hi there! I'm so happy you're here." : CHATTER[chatterTurn++ % CHATTER.length];
  return {
    reply,
    gesture: dance ? "dance" : follow || come || hello ? "wave" : stay ? "yes" : "think",
    move: follow ? "follow" : stay ? "stay" : come ? "come" : "none",
    story_line: null,
  };
}
