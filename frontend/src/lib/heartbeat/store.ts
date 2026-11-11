// Where the Bradbury Heartbeat keeps its records. One data store: the app's
// Postgres (DATABASE_URL, store-pg.ts). Upstash KV (store-kv.ts) is only a
// fallback, used when
//   - DATABASE_URL is unset, or
//   - DATABASE_URL is set but migrations 011/013 are not applied yet (so a
//     deploy that lands before `npm run db:migrate` keeps recording into KV).
// Nothing is ever copied between the two.
import { hasDatabase } from "@/lib/jobs/db";
import * as kv from "./store-kv";
import * as pg from "./store-pg";
import type { ProbeRecord } from "./types";

export type { ProbeKind, ProbeRecord, VoteCounts } from "./types";

type Backend = Pick<typeof kv, "nextTick" | "addPending" | "claim" | "getPending" | "resolve" | "getResults">;

// Something to read or write: Postgres, KV, or neither (the API answers 503).
export function storeConfigured(): boolean {
  return hasDatabase() || kv.kvConfigured();
}

async function backend(): Promise<Backend> {
  if (hasDatabase()) {
    if (await pg.pgReady()) return pg;
    if (kv.kvConfigured()) return kv;
    throw new Error("Heartbeat tables missing: run `npm run db:migrate` (migrations/011_heartbeat.sql, 013_heartbeat_write.sql)");
  }
  if (kv.kvConfigured()) return kv;
  throw new Error("No Heartbeat store configured (DATABASE_URL, or KV_REST_API_URL + KV_REST_API_TOKEN)");
}

export async function nextTick(): Promise<number> {
  return (await backend()).nextTick();
}

export async function addPending(rec: ProbeRecord): Promise<void> {
  return (await backend()).addPending(rec);
}

export async function claim(rec: ProbeRecord): Promise<boolean> {
  return (await backend()).claim(rec);
}

export async function getPending(): Promise<ProbeRecord[]> {
  return (await backend()).getPending();
}

export async function resolve(rec: ProbeRecord): Promise<void> {
  return (await backend()).resolve(rec);
}

export async function getResults(sinceSec: number): Promise<ProbeRecord[]> {
  return (await backend()).getResults(sinceSec);
}
