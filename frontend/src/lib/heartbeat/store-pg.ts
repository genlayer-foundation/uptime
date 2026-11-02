// Postgres backend for the Bradbury Heartbeat (migrations/011_heartbeat.sql),
// on the app's one pool (lib/jobs/db.ts). Same contract as the KV store it
// replaces: records come back exactly as they went in, results in the order
// they were resolved (oldest first), pending in submission order.
//
// The first use on a migrated database copies the KV history in, once
// (importOnce): results in list order, pending, and the tick counter, so tick
// numbers continue instead of restarting at 1 (the contract keys its probes by
// `${tick}:${qid}`, and a restarted counter would overwrite old probes).
import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/jobs/db";
import type { HeartbeatSnapshot, ProbeRecord } from "./types";

export type SnapshotSource = () => Promise<HeartbeatSnapshot>;

const IMPORTED = "kv_imported";
const CHUNK = 1000;

let ready = false;

// Test hook: forget the per-instance "ready" cache.
export function resetPgStoreCache(): void {
  ready = false;
}

// True once migration 011 is applied and the one-time KV import has run.
// False while the tables do not exist yet (the caller falls back to KV).
// Only a true answer is cached, so the switch happens on the first call after
// `npm run db:migrate`, without a redeploy.
export async function pgReady(importFrom: SnapshotSource | null): Promise<boolean> {
  if (ready) return true;
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT to_regclass('heartbeat_probes') IS NOT NULL AND to_regclass('heartbeat_state') IS NOT NULL AS ok"
  );
  if (!rows[0].ok) return false;
  await importOnce(pool, importFrom);
  ready = true;
  return true;
}

async function imported(db: Pool | PoolClient): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM heartbeat_state WHERE name = $1", [IMPORTED]);
  return (rowCount ?? 0) > 0;
}

// Copy the KV state in, exactly once across all instances (advisory lock +
// marker row, in one transaction: a failed read of KV rolls back and is
// retried on the next call). KV itself is only read, never changed.
export async function importOnce(pool: Pool, source: SnapshotSource | null): Promise<number> {
  if (await imported(pool)) return 0;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('heartbeat_kv_import'))");
    if (await imported(c)) {
      await c.query("COMMIT");
      return 0;
    }
    let count = 0;
    if (source) {
      const snap = await source();
      count = await insertSnapshot(c, snap);
    }
    await c.query("INSERT INTO heartbeat_state (name, value) VALUES ($1, $2)", [IMPORTED, count]);
    await c.query("COMMIT");
    return count;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function columns(recs: ProbeRecord[]) {
  return [
    recs.map((r) => r.id),
    recs.map((r) => r.tick),
    recs.map((r) => r.kind),
    recs.map((r) => r.submittedAt),
    recs.map((r) => JSON.stringify(r)),
  ];
}

async function insertSnapshot(c: PoolClient, snap: HeartbeatSnapshot): Promise<number> {
  // A list can hold an id twice (a resolve retried after a failed hdel): the
  // later entry wins, at its own position.
  const last = new Map<string, number>();
  snap.results.forEach((r, i) => last.set(r.id, i));
  const results = snap.results.filter((r, i) => last.get(r.id) === i);

  // Reserve one contiguous block of the sequence so list order is kept.
  const base = Number((await c.query("SELECT nextval('heartbeat_resolved_seq') AS v")).rows[0].v);
  for (let i = 0; i < results.length; i += CHUNK) {
    const chunk = results.slice(i, i + CHUNK);
    await c.query(
      `INSERT INTO heartbeat_probes (id, tick, kind, submitted_at, resolved_seq, record)
       SELECT id, tick, kind, sub, $6::bigint + ord - 1, rec::json
       FROM unnest($1::text[], $2::bigint[], $3::text[], $4::bigint[], $5::text[])
         WITH ORDINALITY AS t(id, tick, kind, sub, rec, ord)
       ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, resolved_seq = EXCLUDED.resolved_seq`,
      [...columns(chunk), base + i]
    );
  }
  if (results.length > 0) {
    await c.query("SELECT setval('heartbeat_resolved_seq', $1)", [base + results.length]);
  }

  // Pending that is also already resolved stays resolved.
  const pending = snap.pending.filter((r) => !last.has(r.id));
  for (let i = 0; i < pending.length; i += CHUNK) {
    await c.query(
      `INSERT INTO heartbeat_probes (id, tick, kind, submitted_at, resolved_seq, record)
       SELECT id, tick, kind, sub, NULL, rec::json
       FROM unnest($1::text[], $2::bigint[], $3::text[], $4::bigint[], $5::text[]) AS t(id, tick, kind, sub, rec)
       ON CONFLICT (id) DO NOTHING`,
      columns(pending.slice(i, i + CHUNK))
    );
  }

  await c.query(
    `INSERT INTO heartbeat_state (name, value) VALUES ('tick', $1)
     ON CONFLICT (name) DO UPDATE SET value = GREATEST(heartbeat_state.value, EXCLUDED.value), updated_at = now()`,
    [snap.tick]
  );
  return results.length + pending.length;
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
