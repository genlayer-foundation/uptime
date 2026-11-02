-- Email alerts (docs/PRODUCT.md §11). Tables for src/lib/mailer (AlertsRepo).
-- Applied after 001_init.sql (backend branch) by scripts/migrate.mjs in filename
-- order; numbered 010 to leave room for the backend's own migrations.
-- Idempotent, plain Postgres 14+.
--
-- job_id / run_id are TEXT and carry no foreign key on purpose: the shared job
-- contract (lib/jobs/types.ts) uses string ids while 001's uptimes.id is a
-- bigint. Add the FKs once that is settled.

-- An address an owner wallet asked to receive alerts at. Usable only once
-- verified_at is set (the confirmation link). Max 3 live rows per wallet is
-- enforced in src/lib/mailer/recipients.ts (MAX_RECIPIENTS_PER_WALLET).
CREATE TABLE IF NOT EXISTS alert_recipients (
  id                    bigserial PRIMARY KEY,
  owner_wallet          text NOT NULL CHECK (owner_wallet = lower(owner_wallet) AND owner_wallet ~ '^0x[0-9a-f]{40}$'),
  email                 text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 6 AND 254),
  created_at            timestamptz NOT NULL DEFAULT now(),
  verification_sent_at  timestamptz,
  verified_at           timestamptz,
  removed_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_recipients_live_idx
  ON alert_recipients (owner_wallet, email) WHERE removed_at IS NULL;

-- The STOP. One row per mailbox, no wallet. One-way: there is no un-suppress
-- path in the product; removing a row is a manual DELETE by a person with a reason.
CREATE TABLE IF NOT EXISTS alert_suppressions (
  email       text PRIMARY KEY CHECK (email = lower(email)),
  reason      text NOT NULL CHECK (reason IN ('hard_bounce', 'spam_complaint', 'unsubscribe', 'manual')),
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which of the owner's verified addresses get a job's failure alerts.
CREATE TABLE IF NOT EXISTS alert_rules (
  job_id         text PRIMARY KEY,
  owner_wallet   text NOT NULL CHECK (owner_wallet = lower(owner_wallet) AND owner_wallet ~ '^0x[0-9a-f]{40}$'),
  enabled        boolean NOT NULL DEFAULT true,
  fail_after     integer NOT NULL DEFAULT 1 CHECK (fail_after BETWEEN 1 AND 100),
  recipient_ids  bigint[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipient_ids) <= 3),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The ledger: one row per email we decided to send (or recorded as suppressed).
-- id doubles as the on-chain settlementId of the mailer's pool.charge (role 2),
-- which must be strictly increasing. claim_key makes a retry of the same
-- (job, run, recipient) a no-op instead of a second email.
CREATE TABLE IF NOT EXISTS alert_emails (
  id                   bigserial PRIMARY KEY,
  claim_key            text NOT NULL UNIQUE,
  kind                 text NOT NULL CHECK (kind IN ('alert', 'verification')),
  job_id               text,
  run_id               text,
  recipient_id         bigint REFERENCES alert_recipients(id),
  email                text NOT NULL CHECK (email = lower(email)),
  owner_wallet         text NOT NULL,
  network              text CHECK (network IN ('studio', 'bradbury')),
  outcome              text NOT NULL DEFAULT 'queued'
                       CHECK (outcome IN ('queued', 'sent', 'bounced', 'suppressed', 'refused', 'failed')),
  reason               text,
  price_wei            numeric(78, 0),
  charge_tx            text,
  provider_message_id  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'alert' OR (job_id IS NOT NULL AND run_id IS NOT NULL AND network IS NOT NULL))
);
-- One index per counter in src/lib/mailer/policy.ts (counterGate + job cooldown).
CREATE INDEX IF NOT EXISTS alert_emails_job_idx ON alert_emails (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_emails_email_idx ON alert_emails (email, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_emails_wallet_idx ON alert_emails (owner_wallet, network, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_emails_created_idx ON alert_emails (created_at DESC);
