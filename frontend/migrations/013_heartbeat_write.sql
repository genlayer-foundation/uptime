-- Bradbury Heartbeat: the WRITE probe (bump(tick)) records kind = 'write'.
-- Widens the kind check from 011. Idempotent, Postgres 14+.
ALTER TABLE heartbeat_probes DROP CONSTRAINT IF EXISTS heartbeat_probes_kind_check;
ALTER TABLE heartbeat_probes ADD CONSTRAINT heartbeat_probes_kind_check
  CHECK (kind IN ('deploy', 'write', 'fetch', 'llm', 'appeal'));
