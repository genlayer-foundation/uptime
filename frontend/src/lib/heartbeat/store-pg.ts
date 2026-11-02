// Postgres backend for the Bradbury Heartbeat (migrations/011_heartbeat.sql +
// 013_heartbeat_write.sql), on the app's one pool (lib/jobs/db.ts). Records
// come back exactly as they went in, results in the order they were resolved
// (oldest first), pending in submission order.
import { getPool } from "@/lib/jobs/db";
import type { ProbeRecord } from "./types";

let ready = false;

// Test hook: forget the per-instance "ready" cache.
export function resetPgStoreCache(): void {
  ready = false;
}

// True once migrations 011 and 013 are applied (013 lets kind = 'write' in).
// False before (the caller falls back to KV). Only a true answer is cached,
// so the switch happens on the first call after `npm run db:migrate`, without
// a redeploy.
export async function pgReady(): Promise<boolean> {
  if (ready) return true;
  const { rows } = await getPool().query(
    `SELECT to_regclass('heartbeat_probes') IS NOT NULL AND to_regclass('heartbeat_state') IS NOT NULL
        AND COALESCE((SELECT pg_get_constraintdef(c.oid) LIKE '%write%' FROM pg_constraint c
                      WHERE c.conname = 'heartbeat_probes_kind_check'
                        AND c.conrelid = to_regclass('heartbeat_probes')), true) AS ok`
  );
  if (!rows[0].ok) return false;
  ready = true;
  return true;
}

export async function nextTick(): Promise<number> {
  const { rows } = await getPool().query(
    `INSERT INTO heartbeat_state (name, value) VALUES ('tick', 1)
     ON CONFLICT (name) DO UPDATE SET value = heartbeat_state.value + 1, updated_at = now()
     RETURNING value`
  );
  return Number(rows[0].value);
}

const UPSERT = `INSERT INTO heartbeat_probes (id, tick, kind, submitted_at, resolved_seq, record)
  VALUES ($1, $2, $3, $4, %SEQ%, $5::json)
  ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick, kind = EXCLUDED.kind,
    submitted_at = EXCLUDED.submitted_at, resolved_seq = EXCLUDED.resolved_seq, record = EXCLUDED.record`;

const params = (r: ProbeRecord) => [r.id, r.tick, r.kind, r.submittedAt, JSON.stringify(r)];

export async function addPending(rec: ProbeRecord): Promise<void> {
  await getPool().query(UPSERT.replace("%SEQ%", "NULL"), params(rec));
}

export async function getPending(): Promise<ProbeRecord[]> {
  const { rows } = await getPool().query(
    "SELECT record FROM heartbeat_probes WHERE resolved_seq IS NULL ORDER BY submitted_at, id"
  );
  return rows.map((r) => r.record as ProbeRecord);
}

export async function resolve(rec: ProbeRecord): Promise<void> {
  await getPool().query(UPSERT.replace("%SEQ%", "nextval('heartbeat_resolved_seq')"), params(rec));
}

export async function getResults(sinceSec: number): Promise<ProbeRecord[]> {
  const { rows } = await getPool().query(
    "SELECT record FROM heartbeat_probes WHERE resolved_seq IS NOT NULL AND submitted_at >= $1 ORDER BY resolved_seq",
    [sinceSec]
  );
  return rows.map((r) => r.record as ProbeRecord);
}
