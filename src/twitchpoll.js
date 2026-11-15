// Twitch chat → the next story line, in rounds of two stages (run by the director console):
//   collect: chat sends ideas with "!idea <text>". Thousands are fine: they are only counted here.
//   vote:    5 of them are drawn at random (an idea more people sent is more likely), shortened to a
//            few words, and chat votes with "!vote 2" (or just "2"). The winner becomes the next line.
// Ideas sent while a vote runs go into the next round.

export const IDEAS_PER_VOTE = 5;
const MAX_POOL = 5000;
const MAX_PER_USER = 3; // ideas per person per round

const key = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/** "!idea a dragon lands" → { idea }, "!vote 3" / "3" → { vote: 3 }, anything else → null. */
export function parseChat(text) {
  const t = String(text || "").trim();
  const idea = /^!(?:idea|i|suggest)\s+(.+)$/i.exec(t);
  if (idea) return { idea: idea[1].replace(/\s+/g, " ").trim().slice(0, 200) };
  const vote = /^(?:!v(?:ote)?\s*)?#?([1-9])\s*$/i.exec(t);
  if (vote) return { vote: Number(vote[1]) };
  return null;
}

/** Draws up to n items without replacement, each with probability ∝ weight(x). */
export function weightedSample(items, n, weight, rand = Math.random) {
  const left = [...items], out = [];
  while (out.length < n && left.length) {
    const total = left.reduce((s, x) => s + weight(x), 0);
    let r = rand() * total, i = 0;
    while (i < left.length - 1 && (r -= weight(left[i])) > 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

export class TwitchPoll {
  /**
   * shorten(texts) → Promise<labels>; onChange() after anything visible changed;
   * onWinner(idea) when a vote ends. Durations in seconds.
   */
  constructor({ collectSec = 45, voteSec = 25, shorten = async (t) => t, onChange = () => {}, onWinner = () => {}, rand = Math.random } = {}) {
    Object.assign(this, { collectSec, voteSec, shorten, onChange, onWinner, rand });
    this.pool = new Map(); // key → { text, by, users: Set, at }
    this.perUser = new Map(); // user → ideas sent this round
    this.stage = "off";
    this.ends = 0;
    this.options = []; // [{ text, short, by, supporters }]
    this.votes = new Map(); // user → option number (1-based)
    this.lastWinner = null;
  }

  start(now = Date.now()) {
    this.stage = "collect";
    this.ends = now + this.collectSec * 1000;
    this.onChange();
  }
  stop() {
    this.stage = "off";
    this.options = [];
    this.votes.clear();
    this.onChange();
  }

  /** One chat line. Returns what it was ("idea", "vote") or null. */
  handle({ user, text }, now = Date.now()) {
    const c = parseChat(text);
    if (!c || !user || this.stage === "off") return null;
    if (c.idea) {
      const k = key(c.idea);
      if (!k) return null;
      const known = this.pool.get(k);
      if (known) {
        known.users.add(user); // the same idea from someone else counts as support
        return "idea";
      }
      if ((this.perUser.get(user) || 0) >= MAX_PER_USER || this.pool.size >= MAX_POOL) return null;
      this.perUser.set(user, (this.perUser.get(user) || 0) + 1);
      this.pool.set(k, { text: c.idea, by: user, users: new Set([user]), at: now });
      return "idea";
    }
    if (c.vote && this.stage === "vote" && c.vote <= this.options.length) {
      this.votes.set(user, c.vote); // one vote each; a later one replaces it
      return "vote";
    }
    return null;
  }

  tally() {
    const t = this.options.map(() => 0);
    for (const n of this.votes.values()) t[n - 1]++;
    return t;
  }

  /** Call about once a second: moves to the next stage when the time is up. */
  async tick(now = Date.now()) {
    if (this.stage === "collect" && now >= this.ends) {
      if (this.pool.size < 2) {
        this.ends = now + 10_000; // not enough to vote on yet: keep collecting
        return this.onChange();
      }
      await this.beginVote(now);
    } else if (this.stage === "vote" && now >= this.ends) this.endVote(now);
  }

  /** Draws the options from the pool (a fresh pool starts for the next round) and opens the vote. */
  async beginVote(now = Date.now()) {
    if (this.pool.size === 0) return;
    const picked = weightedSample([...this.pool.values()], IDEAS_PER_VOTE, (x) => x.users.size, this.rand);
    this.pool = new Map();
    this.perUser = new Map();
    this.votes.clear();
    this.stage = "choosing";
    this.onChange();
    let labels = picked.map((x) => x.text);
    try {
      labels = (await this.shorten(labels)) || labels;
    } catch {
      /* the full texts will do */
    }
    this.options = picked.map((x, i) => ({ text: x.text, short: labels[i] || x.text, by: x.by, supporters: x.users.size }));
    this.stage = "vote";
    this.ends = Date.now() + this.voteSec * 1000;
    this.onChange();
  }

  /** Closes the vote: most votes wins; a tie goes to the idea more people sent, then by chance. */
  endVote(now = Date.now()) {
    if (this.stage !== "vote") return;
    const t = this.tally();
    const best = Math.max(...t);
    const top = this.options.map((x, i) => ({ ...x, votes: t[i] })).filter((x) => x.votes === best);
    const most = Math.max(...top.map((x) => x.supporters));
    const tied = top.filter((x) => x.supporters === most);
    const winner = tied[Math.floor(this.rand() * tied.length)];
    this.lastWinner = winner;
    this.options = [];
    this.votes.clear();
    this.stage = "collect";
    this.ends = now + this.collectSec * 1000;
    this.onWinner(winner);
    this.onChange();
  }

  /** What the room sees (server/core.js cleanPoll). */
  snapshot(channel) {
    const t = this.tally();
    return {
      stage: this.stage === "choosing" ? "collect" : this.stage,
      ends: this.ends,
      channel,
      pool: this.pool.size,
      ideas: this.options.map((x, i) => ({ text: x.text, short: x.short, by: x.by, votes: t[i] })),
    };
  }
}
