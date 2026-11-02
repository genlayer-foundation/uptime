-- Self-serve alert settings (owner decision 2026-11-02): per-job triggers and
-- limits, a per-address daily cap, recovery and digest emails.
-- Defaults and bounds mirror src/lib/mailer/limits.ts; change both together.
-- Idempotent, plain Postgres 14+. Applied after 010_alerts.sql.

-- Per-job rule: which triggers fire, and the owner's own limits.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS on_failure     boolean NOT NULL DEFAULT true;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS on_assertion   boolean NOT NULL DEFAULT true;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS on_recovery    boolean NOT NULL DEFAULT true;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS digest         boolean NOT NULL DEFAULT false;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS per_job_per_day integer NOT NULL DEFAULT 10;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS cooldown_min   integer NOT NULL DEFAULT 15;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_per_job_per_day_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_per_job_per_day_check CHECK (per_job_per_day BETWEEN 1 AND 50);
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_cooldown_min_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_cooldown_min_check CHECK (cooldown_min BETWEEN 5 AND 120);

-- The digest cron's work list.
CREATE INDEX IF NOT EXISTS alert_rules_digest_idx ON alert_rules (job_id) WHERE enabled AND digest;

-- Per-address cap, all of the wallet's jobs together. NULL = the default (20).
ALTER TABLE alert_recipients ADD COLUMN IF NOT EXISTS daily_cap integer;
ALTER TABLE alert_recipients DROP CONSTRAINT IF EXISTS alert_recipients_daily_cap_check;
ALTER TABLE alert_recipients ADD CONSTRAINT alert_recipients_daily_cap_check CHECK (daily_cap IS NULL OR daily_cap BETWEEN 1 AND 100);

-- Ledger: a new `digest` kind, and which trigger sent each alert/digest.
-- `alert` rows are failure, assertion and recovery emails (the per-job cap counts them).
ALTER TABLE alert_emails ADD COLUMN IF NOT EXISTS trigger_kind text;
ALTER TABLE alert_emails DROP CONSTRAINT IF EXISTS alert_emails_trigger_kind_check;
ALTER TABLE alert_emails ADD CONSTRAINT alert_emails_trigger_kind_check
  CHECK (trigger_kind IS NULL OR trigger_kind IN ('failure', 'assertion', 'recovery', 'digest'));

ALTER TABLE alert_emails DROP CONSTRAINT IF EXISTS alert_emails_kind_check;
ALTER TABLE alert_emails ADD CONSTRAINT alert_emails_kind_check CHECK (kind IN ('alert', 'digest', 'verification'));

-- A digest belongs to one job on one network; it has no run.
ALTER TABLE alert_emails DROP CONSTRAINT IF EXISTS alert_emails_digest_check;
ALTER TABLE alert_emails ADD CONSTRAINT alert_emails_digest_check
  CHECK (kind <> 'digest' OR (job_id IS NOT NULL AND network IS NOT NULL AND trigger_kind = 'digest'));

-- Recovery reads a job's newest SENT alert.
CREATE INDEX IF NOT EXISTS alert_emails_job_sent_idx ON alert_emails (job_id, created_at DESC) WHERE kind = 'alert' AND outcome = 'sent';
