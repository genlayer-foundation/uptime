// Upstash KV backend: the original store, now only the fallback for a server
// without DATABASE_URL, and the source of the one-time import into Postgres
// (store-pg.ts). Keys: hb:pending (hash id → record), hb:results (list,
// newest last), hb:tick (counter).
import { Redis } from "@upstash/redis";
import type { HeartbeatSnapshot, ProbeRecord } from "./types";

const PENDING = "hb:pending";
const RESULTS = "hb:results";
const TICK = "hb:tick";
const MAX_RESULTS = 20000; // ~1 year at ~5 probes an hour

export function kvConfigured(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
}

function redis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

function parse<T>(v: unknown): T {
  return typeof v === "string" ? JSON.parse(v) : (v as T);
}

export async function nextTick(): Promise<number> {
  return await redis().incr(TICK);
}

export async function addPending(rec: ProbeRecord): Promise<void> {
  await redis().hset(PENDING, { [rec.id]: JSON.stringify(rec) });
}

export async function getPending(): Promise<ProbeRecord[]> {
  const all = await redis().hgetall<Record<string, unknown>>(PENDING);
  return Object.values(all ?? {}).map((v) => parse<ProbeRecord>(v));
}

export async function resolve(rec: ProbeRecord): Promise<void> {
  const r = redis();
  await r.rpush(RESULTS, JSON.stringify(rec));
  await r.ltrim(RESULTS, -MAX_RESULTS, -1);
  await r.hdel(PENDING, rec.id);
}

export async function getResults(sinceSec: number): Promise<ProbeRecord[]> {
  // Newest are at the tail; walk back in pages until we pass `sinceSec`.
  const r = redis();
  const page = 500;
  const out: ProbeRecord[] = [];
  for (let end = -1; ; end -= page) {
    const items = await r.lrange<unknown>(RESULTS, end - page + 1, end);
    if (items.length === 0) break;
    const recs = items.map((v) => parse<ProbeRecord>(v));
    out.unshift(...recs.filter((x) => x.submittedAt >= sinceSec));
    if (recs[0].submittedAt < sinceSec || items.length < page) break;
  }
  return out;
}

// The whole KV state, for the import. Read-only: KV is left as it was.
export async function snapshot(): Promise<HeartbeatSnapshot> {
  const r = redis();
  const tick = Number((await r.get<unknown>(TICK)) ?? 0) || 0;
  const pending = await getPending();
  const results: ProbeRecord[] = [];
  const page = 1000;
  for (let start = 0; ; start += page) {
    const items = await r.lrange<unknown>(RESULTS, start, start + page - 1);
    results.push(...items.map((v) => parse<ProbeRecord>(v)));
    if (items.length < page) break;
  }
  return { tick, pending, results };
}
