// Story state + event log in Upstash Redis (Vercel functions share nothing in memory).
import { Redis } from "@upstash/redis";
import { initialState } from "../../server/core.js";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export let redis = url && token ? new Redis({ url, token }) : null;
/** Tests only: swap in another client. */
export const _setClient = (c) => (redis = c);

const STATE = "lw:state", EVENTS = "lw:events", SEQ = "lw:seq";
const KEEP = 100;

export async function loadState() {
  const s = await redis.get(STATE);
  return s || initialState();
}

export async function saveState(s) {
  await redis.set(STATE, s);
}

/** Appends events with increasing sequence numbers so pollers can ask "what's new since N". */
export async function pushEvents(events) {
  if (!events.length) return;
  const first = await redis.incrby(SEQ, events.length);
  const base = first - events.length + 1;
  const p = redis.pipeline();
  events.forEach((e, i) => p.rpush(EVENTS, JSON.stringify({ ...e, seq: base + i })));
  p.ltrim(EVENTS, -KEEP, -1);
  await p.exec();
}

/** One round trip: current state + recent events. */
export async function poll() {
  const [state, raw, seq] = await redis.pipeline().get(STATE).lrange(EVENTS, 0, -1).get(SEQ).exec();
  const events = (raw || []).map((e) => (typeof e === "string" ? JSON.parse(e) : e));
  return { state: state || initialState(), events, seq: Number(seq || 0) };
}
