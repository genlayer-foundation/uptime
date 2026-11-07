-- "Run now": a visitor's manual run is a run in group 'manual', signed and paid
-- by the visitor (lib/jobs/manual.ts). These indexes serve its two checks:
-- the per-job rate limit, and "this tx hash was never recorded before".
CREATE INDEX IF NOT EXISTS runs_manual_idx ON runs (job_id, scheduled_for DESC) WHERE grp = 'manual';
CREATE INDEX IF NOT EXISTS step_runs_tx_idx ON step_runs (lower(tx_hash)) WHERE tx_hash IS NOT NULL;
