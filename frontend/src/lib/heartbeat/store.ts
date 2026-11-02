import { Redis } from "@upstash/redis";
import type { Grade } from "./questions";

export type ProbeKind = "deploy" | "fetch" | "llm" | "appeal";

export interface VoteCounts {
  agree: number;
  disagree: number;
  timeout: number;
  other: number;
}

export interface ProbeRecord {
  id: string; // `${tick}:${kind}:${qid ?? ""}`
  tick: number;
  kind: ProbeKind;
  qid?: string;
  qkind?: string;
  txHash?: `0x${string}`;
  submittedAt: number; // unix seconds, wall clock
  // Set on llm probes chosen to be appealed once they are ACCEPTED.
  appealDue?: boolean;
  // appeal records: the llm probe being appealed, and its answer before
  appealOf?: string;
  answerBefore?: string;

  // Filled in by reconcile.
  status?: string; // final statusName, or SUBMIT_FAILED / TIMEOUT
  error?: string;
  resolvedAt?: number;
  latencySec?: number; // chain lastVoteTimestamp - createdTimestamp
  rounds?: number;
  votes?: VoteCounts;
  answer?: string;
  grade?: Grade;
  upheld?: boolean; // appeal records: answer unchanged and still correct
}

const PENDING = "hb:pending"; // hash id → record
const RESULTS = "hb:results"; // list of resolved records, newest last
const TICK = "hb:tick";
const MAX_RESULTS = 20000; // ~1 year at ~5 probes an hour

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
