// Bonnie's fixed lines: everything she says that is not written fresh by the director. Each one has a
// pre-recorded audio file (public/voice/bonnie/, listed in src/voiceLines.json) so it plays at once.
// After changing or adding a line, run `npm run voice-lines` (needs OPENAI_API_KEY) to record it.
// Plain data, no browser or server imports: the page, the server's fallback and the script all use it.

export const BONNIE_VOICE =
  "a bright young voice dripping with sass; quick, dry and dramatic, eye-rolling diva energy with a warm heart underneath, deadpan on the one-liners";

export const HELLO = "Hi! I'm Bonnie. Ask me for ideas any time, or just talk to me!";
export const COMING = "Coming!";
export const FOLLOW_ON = "Lead the way! I'm right beside you.";
export const FOLLOW_OFF = "Okay, I'll wait here!";
export const HEART = "Aww! I love you too!";
export const THROWN = ["Wheeeee!", "I can flyyy!", "Woooah!"];
export const LANDED_HARD = ["Oof. I'm okay!", "Bunnies bounce. Mostly."];
export const LANDED_OK = ["Again! Again!", "Ta-da!", "Nice throw!"];

// The director's fallback (no model): small talk, moves, tricks.
export const FALLBACK = {
  world: "Fine. One world, coming right up. You're welcome.",
  calling: "Yes? You have my undivided attention. Use it wisely.",
  busy: "Fine, fine. Watch the window, I'm working.",
  newWorld: "Fine. New world, coming right up. You're welcome.",
  whichWorld: "A new world, sure. Which one, though? I'm good, not psychic.",
  follow: "Lead on. I'll pretend this was my idea.",
  stay: "Fine. I'll stand here looking fabulous.",
  come: "Coming. Short legs, big entrance.",
  dance: "Oh, you want a show? Clear the floor.",
  hello: "Oh, hi. Took you long enough. Missed me?",
};
export const TRICKS = {
  flip: "Backflip. Try to keep up.",
  cartwheel: "A cartwheel? Please. Watch a professional.",
  moonwalk: "Smooth. Like, illegally smooth.",
  spin: "Pirouette. Applause is customary.",
  clap: "Slow clap. You earned it. Barely.",
};
export const CHATTER = [
  "Bold of you to stop there. What happens next?",
  "Cute. Now give me something worthy of my windows.",
  "Hmm. Are we stepping into one of these worlds, or just admiring my work?",
  "Ha! Didn't see that coming, and I see everything. Favourite part so far?",
  "I'm all ears. Literally. Look at them. Go on.",
];

/** Every line to record. */
export const ALL_LINES = [
  HELLO, COMING, FOLLOW_ON, FOLLOW_OFF, HEART,
  ...THROWN, ...LANDED_HARD, ...LANDED_OK,
  ...Object.values(FALLBACK), ...Object.values(TRICKS), ...CHATTER,
].filter((l, i, a) => a.indexOf(l) === i);
