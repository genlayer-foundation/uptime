// Where the Bradbury Heartbeat keeps its records. One data store: the app's
// Postgres (DATABASE_URL, store-pg.ts). Upstash KV (store-kv.ts) is only a
// fallback, used when
//   - DATABASE_URL is unset, or
//   - DATABASE_URL is set but migration 011 is not applied yet (so a deploy
//     that lands before `npm run db:migrate` keeps recording into KV).
// On the first call against a migrated database the KV history is copied into
// Postgres once (store-pg.ts importOnce); from then on KV is not touched.
import { hasDatabase } from "@/lib/jobs/db";
import * as kv from "./store-kv";
import * as pg from "./store-pg";
import type { ProbeRecord } from "./types";

export type { HeartbeatSnapshot, ProbeKind, ProbeRecord, VoteCounts } from "./types";

type Backend = Pick<typeof kv, "nextTick" | "addPending" | "getPending" | "resolve" | "getResults">;

// Something to read or write: Postgres, KV, or neither (the API answers 503).
export function storeConfigured(): boolean {
  return hasDatabase() || kv.kvConfigured();
}

async function backend(): Promise<Backend> {
  if (hasDatabase()) {
    if (await pg.pgReady(kv.kvConfigured() ? kv.snapshot : null)) return pg;
    if (kv.kvConfigured()) return kv;
    throw new Error("Heartbeat tables missing: run `npm run db:migrate` (migrations/011_heartbeat.sql)");
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

export async function getPending(): Promise<ProbeRecord[]> {
  return (await backend()).getPending();
}

export async function resolve(rec: ProbeRecord): Promise<void> {
  return (await backend()).resolve(rec);
}

export async function getResults(sinceSec: number): Promise<ProbeRecord[]> {
  return (await backend()).getResults(sinceSec);
}
