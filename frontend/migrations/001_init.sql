-- GenLayer Uptime: a generic paid cron for GenLayer. Applied in filename
-- order by scripts/migrate.mjs, each file once, recorded in schema_migrations.
-- Plain Postgres (14+): the same file runs on a laptop and on Neon.
-- The public JSON shapes are in src/lib/jobs/types.ts.

CREATE TABLE IF NOT EXISTS users (
  wallet      text PRIMARY KEY CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz
);

-- SIWE nonces: issued by POST /api/auth/nonce, consumed once by /verify.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz
);

-- Ids are TEXT (UUIDs minted by the app) so other tables (e.g. 010_alerts)
-- can reference them with the same string the API returns.
CREATE TABLE IF NOT EXISTS jobs (
  id            text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner         text NOT NULL REFERENCES users(wallet),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  network       text NOT NULL CHECK (network IN ('studio', 'bradbury')),
  preset        text,                       -- which preset prefilled it; informational
  schedule      jsonb NOT NULL,             -- {"everyMinutes": n} | {"cron": "..."}
  steps         jsonb NOT NULL,             -- Step[]
  assertions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- draft: Bradbury job waiting for its pool; errored: the scheduler refused
  -- it (state_reason says why); deleted: soft-deleted, history kept
  state         text NOT NULL DEFAULT 'active'
                CHECK (state IN ('draft', 'active', 'paused', 'errored', 'deleted')),
  state_reason  text,
  system        boolean NOT NULL DEFAULT false, -- run by the Foundation (Bradbury Heartbeat)
  public        boolean NOT NULL DEFAULT false,
  -- bytes32 key of the job's Bradbury pool: the job UUID's 16 bytes,
  -- left-padded with zeros (see poolIdFor in src/lib/jobs/ids.ts). Pool ids
  -- are first-come on-chain, so the scheduler checks the pool's owner first.
  pool_id       text NOT NULL UNIQUE CHECK (pool_id ~ '^0x0{32}[0-9a-f]{32}$'),
  per_run_cap_wei numeric(78, 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs (owner);
CREATE INDEX IF NOT EXISTS jobs_public_idx ON jobs (public) WHERE public;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_system_preset_idx ON jobs (network, preset) WHERE system;

-- One row per schedule GROUP of a job: "job" (the steps without their own
-- schedule, run in order) and one per step that has its own schedule.
-- Either a fixed interval (slots anchor_at + k * interval_sec) or a 5-field
-- UTC cron. The 5-minute floor is a CHECK for intervals, and an API check
-- (sampled minimum gap) for cron.
CREATE TABLE IF NOT EXISTS schedules (
  job_id        text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  grp           text NOT NULL,
  interval_sec  integer CHECK (interval_sec >= 300),
  cron          text,
  anchor_at     timestamptz NOT NULL,
  next_due_at   timestamptz NOT NULL,
  last_slot_at  timestamptz,
  CHECK ((interval_sec IS NULL) <> (cron IS NULL)),
  PRIMARY KEY (job_id, grp)
);
CREATE INDEX IF NOT EXISTS schedules_due_idx ON schedules (next_due_at);

-- One row per dispatched slot of a group. Its steps run in order: a write or
-- deploy is submitted, and the next step starts once reconcile sees it decided.
CREATE TABLE IF NOT EXISTS runs (
  id             text PRIMARY KEY,
  job_id         text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  grp            text NOT NULL,
  scheduled_for  timestamptz NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  state          text NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('RUNNING', 'DONE', 'SKIPPED')),
  cursor         integer NOT NULL DEFAULT 0,
  pass           boolean,
  error          text,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (job_id, grp, scheduled_for)
);
CREATE INDEX IF NOT EXISTS runs_running_idx ON runs (state) WHERE state = 'RUNNING';
CREATE INDEX IF NOT EXISTS runs_job_idx ON runs (job_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS step_runs (
  run_id         text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx            integer NOT NULL,
  step_id        text NOT NULL,
  kind           text NOT NULL,
  status         text NOT NULL CHECK (status IN
                   ('PENDING', 'ACCEPTED', 'FINALIZED', 'UNDETERMINED', 'TIMEOUT', 'SUBMIT_FAILED', 'ERROR')),
  chain_status   text,
  tx_hash        text,
  submitted_at   timestamptz,
  resolved_at    timestamptz,
  result         jsonb,
  time_to_accepted_ms bigint,
  rounds         integer,
  votes          jsonb,
  gas_wei        numeric(78, 0),
  error          text,
  -- billing (Bradbury): the settlement that charged it, and retry count
  settled_in     bigint,
  charge_attempts integer NOT NULL DEFAULT 0,
  charge_outcome text,
  PRIMARY KEY (run_id, idx)
);
CREATE INDEX IF NOT EXISTS step_runs_pending_idx ON step_runs (status) WHERE status = 'PENDING';

-- Batched pool charges: one `charge` tx per settlement, scheduler role 1.
-- onchain_id is the settlementId sent (strictly increasing per role on-chain).
CREATE TABLE IF NOT EXISTS settlements (
  id            bigserial PRIMARY KEY,
  onchain_id    numeric(78, 0),
  network       text NOT NULL,
  period_end    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  tx_hash       text,
  total_wei     numeric(78, 0) NOT NULL DEFAULT 0,
  charged_wei   numeric(78, 0),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One line per step run (the pool's maxPerCharge is a per-run cap). The
-- outcome comes from the receipt's Charged / ChargeSkipped events, in order.
CREATE TABLE IF NOT EXISTS settlement_lines (
  settlement_id bigint NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  line          integer NOT NULL,
  run_id        text NOT NULL,
  idx           integer NOT NULL,
  job_id        text NOT NULL REFERENCES jobs(id),
  amount_wei    numeric(78, 0) NOT NULL,
  outcome       text NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'CHARGED', 'SKIPPED')),
  skip_reason   text,
  PRIMARY KEY (settlement_id, line),
  FOREIGN KEY (run_id, idx) REFERENCES step_runs(run_id, idx)
);
