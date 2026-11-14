// Story state + event log in Upstash Redis (Vercel functions share nothing in memory).
import { Redis } from "@upstash/redis";
import { initialState } from "../../server/core.js";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export let redis = url && token ? new Redis({ url, token }) : null;
/** Tests only: swap in another client. */
export const _setClient = (c) => (redis = c);

const KEEP = 100;
/** Each room is a separate story: ?room=name in the page URL. */
export const roomOf = (v) => String(v || "main").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "main";
const keys = (room) => ({ STATE: `lw:${room}:state`, EVENTS: `lw:${room}:events`, SEQ: `lw:${room}:seq` });
const TTL = 60 * 60 * 24 * 7; // rooms expire after a quiet week

export async function loadState(room) {
  const { STATE } = keys(room);
  const s = await redis.get(STATE);
  return s || initialState();
}

export async function saveState(room, s) {
  await redis.set(keys(room).STATE, s, { ex: TTL });
}

/** Appends events with increasing sequence numbers so pollers can ask "what's new since N". */
export async function pushEvents(room, events) {
  if (!events.length) return;
  const { EVENTS, SEQ } = keys(room);
  const first = await redis.incrby(SEQ, events.length);
  const base = first - events.length + 1;
  const p = redis.pipeline();
  events.forEach((e, i) => p.rpush(EVENTS, JSON.stringify({ ...e, seq: base + i })));
  p.ltrim(EVENTS, -KEEP, -1);
  p.expire(EVENTS, TTL);
  p.expire(SEQ, TTL);
  await p.exec();
}

/** One round trip: current state + recent events. */
export async function poll(room) {
  const { STATE, EVENTS, SEQ } = keys(room);
  const [state, raw, seq] = await redis.pipeline().get(STATE).lrange(EVENTS, 0, -1).get(SEQ).exec();
  const events = (raw || []).map((e) => (typeof e === "string" ? JSON.parse(e) : e));
  return { state: state || initialState(), events, seq: Number(seq || 0) };
}
