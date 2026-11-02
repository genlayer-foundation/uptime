-- Bradbury Heartbeat results (src/lib/heartbeat/store-pg.ts), replacing the
-- Upstash KV keys hb:pending / hb:results / hb:tick. Idempotent, Postgres 14+.
--
-- One row per probe record. `record` is the ProbeRecord exactly as the runner
-- wrote it, stored as `json` (not jsonb) so its text, and therefore the key
-- order /api/heartbeat serves, is kept byte for byte. The other columns are
-- copies for filtering and ordering only.
--
--   pending   resolved_seq IS NULL
--   resolved  resolved_seq = order of resolution (the old list order, newest last)
CREATE SEQUENCE IF NOT EXISTS heartbeat_resolved_seq;

CREATE TABLE IF NOT EXISTS heartbeat_probes (
  id            text PRIMARY KEY,               -- `${tick}:${kind}:${qid ?? ""}`
  tick          bigint NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('deploy', 'fetch', 'llm', 'appeal')),
  submitted_at  bigint NOT NULL,                -- unix seconds, = record.submittedAt
  resolved_seq  bigint,
  record        json NOT NULL
);
CREATE INDEX IF NOT EXISTS heartbeat_probes_pending_idx
  ON heartbeat_probes (submitted_at) WHERE resolved_seq IS NULL;
CREATE INDEX IF NOT EXISTS heartbeat_probes_resolved_idx
  ON heartbeat_probes (submitted_at, resolved_seq) WHERE resolved_seq IS NOT NULL;

-- Small named counters: 'tick' (the hb:tick successor) and 'kv_imported'
-- (set once the KV history has been copied in; value = records imported).
CREATE TABLE IF NOT EXISTS heartbeat_state (
  name        text PRIMARY KEY,
  value       bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
