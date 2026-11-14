// Two interchangeable stores with the same async API:
//   memoryStore() for the laptop server, redisStore() for Vercel (Upstash).
import { initialState } from "./core.js";

const KEEP_EVENTS = 100;
const ROOM_TTL = 60 * 60 * 24 * 7; // quiet rooms expire after a week
const AUTH_TTL = 60 * 60 * 24 * 30;
const SNAP_TTL = 120;
const PUBLIC_WINDOW_MS = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function memoryStore() {
  const rooms = new Map(); // room -> { state, events, seq, auth, snaps, lock }
  const pub = new Map(); // room -> lastActive
  const room = (r) => {
    if (!rooms.has(r)) rooms.set(r, { state: null, events: [], seq: 0, auth: null, snaps: {}, lock: Promise.resolve() });
    return rooms.get(r);
  };
  const clone = (x) => (x == null ? x : structuredClone(x));

  return {
    async getState(r) {
      return clone(room(r).state) || initialState();
    },
    async setState(r, s) {
      room(r).state = clone(s);
    },
    async pushEvents(r, events) {
      const x = room(r);
      for (const e of events) x.events.push({ ...e, seq: ++x.seq });
      x.events = x.events.slice(-KEEP_EVENTS);
    },
    async poll(r) {
      const x = room(r);
      return { state: clone(x.state) || initialState(), events: x.events.slice(), seq: x.seq };
    },
    async getAuth(r) {
      return clone(room(r).auth);
    },
    async claimAuth(r, auth) {
      const x = room(r);
      if (x.auth) return false;
      x.auth = clone(auth);
      return true;
    },
    async withLock(r, fn) {
      const x = room(r);
      const run = x.lock.then(fn, fn);
      x.lock = run.catch(() => {});
      return run;
    },
    async setSnapshot(r, id, data) {
      room(r).snaps[id] = { data, at: Date.now() };
    },
    async getSnapshots(r) {
      const out = {};
      for (const [id, v] of Object.entries(room(r).snaps)) if (Date.now() - v.at < SNAP_TTL * 1000) out[id] = v.data;
      return out;
    },
    async touchPublic(r, shared) {
      if (shared) pub.set(r, Date.now());
      else pub.delete(r);
    },
    async listPublic(n) {
      const cutoff = Date.now() - PUBLIC_WINDOW_MS;
      const rs = [...pub.entries()].filter(([, t]) => t > cutoff).sort((a, b) => b[1] - a[1]).slice(0, n).map(([r]) => r);
      return Promise.all(rs.map(async (r) => ({ room: r, state: await this.getState(r), snaps: await this.getSnapshots(r) })));
    },
  };
}

export async function redisStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url, token });
  const k = (r, part) => `lw:${r}:${part}`;
  const PUBLIC = "lw:public";

  return {
    redis,
    async getState(r) {
      return (await redis.get(k(r, "state"))) || initialState();
    },
    async setState(r, s) {
      await redis.set(k(r, "state"), s, { ex: ROOM_TTL });
    },
    async pushEvents(r, events) {
      if (!events.length) return;
      const last = await redis.incrby(k(r, "seq"), events.length);
      const base = last - events.length + 1;
      const p = redis.pipeline();
      events.forEach((e, i) => p.rpush(k(r, "events"), JSON.stringify({ ...e, seq: base + i })));
      p.ltrim(k(r, "events"), -KEEP_EVENTS, -1);
      p.expire(k(r, "events"), ROOM_TTL);
      p.expire(k(r, "seq"), ROOM_TTL);
      await p.exec();
    },
    async poll(r) {
      const [state, raw, seq] = await redis.pipeline().get(k(r, "state")).lrange(k(r, "events"), 0, -1).get(k(r, "seq")).exec();
      const events = (raw || []).map((e) => (typeof e === "string" ? JSON.parse(e) : e));
      return { state: state || initialState(), events, seq: Number(seq || 0) };
    },
    async getAuth(r) {
      return await redis.get(k(r, "auth"));
    },
    async claimAuth(r, auth) {
      return (await redis.set(k(r, "auth"), auth, { nx: true, ex: AUTH_TTL })) === "OK";
    },
    /** Short per-room lock so concurrent votes can't overwrite the headset's updates. */
    async withLock(r, fn) {
      const key = k(r, "lock"), me = Math.random().toString(36).slice(2);
      for (let i = 0; i < 80; i++) {
        if ((await redis.set(key, me, { nx: true, px: 5000 })) === "OK") {
          try {
            return await fn();
          } finally {
            if ((await redis.get(key)) === me) await redis.del(key);
          }
        }
        await sleep(40 + Math.random() * 40);
      }
      throw Object.assign(new Error("room is busy, try again"), { status: 503 });
    },
    async setSnapshot(r, id, data) {
      await redis.pipeline().hset(k(r, "snap"), { [id]: data }).expire(k(r, "snap"), SNAP_TTL).exec();
    },
    async getSnapshots(r) {
      return (await redis.hgetall(k(r, "snap"))) || {};
    },
    async touchPublic(r, shared) {
      if (shared) await redis.zadd(PUBLIC, { score: Date.now(), member: r });
      else await redis.zrem(PUBLIC, r);
    },
    async listPublic(n) {
      await redis.zremrangebyscore(PUBLIC, 0, Date.now() - PUBLIC_WINDOW_MS);
      const rooms = await redis.zrange(PUBLIC, 0, n - 1, { rev: true });
      if (!rooms.length) return [];
      const p = redis.pipeline();
      for (const r of rooms) p.get(k(r, "state")).hgetall(k(r, "snap"));
      const out = await p.exec();
      return rooms.map((r, i) => ({ room: r, state: out[i * 2] || initialState(), snaps: out[i * 2 + 1] || {} }));
    },
  };
}
