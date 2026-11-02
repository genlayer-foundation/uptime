// Types for the email-alert mailer (docs/PRODUCT.md §11).
//
// AlertJob / AlertRun are the SUBSET of the shared job contract
// (lib/jobs/types.ts `Job` / `Run`, on the backend branch) that the mailer
// reads. They are structural on purpose: a full `Job` and `Run` satisfy them,
// so the scheduler calls `notifyRunDecided(job, run)` with what it already has.

import type { RuleSettings } from "./limits";

export type Network = "studio" | "bradbury";

export type StepStatus =
  | "PENDING"
  | "ACCEPTED"
  | "FINALIZED"
  | "UNDETERMINED"
  | "TIMEOUT"
  | "SUBMIT_FAILED"
  | "ERROR";

export interface AlertJob {
  id: string | number;
  owner: string; // wallet, any case
  name: string; // user-controlled: the ONLY user text that reaches a template
  network: Network;
  poolId?: string; // bytes32 hex of the job's Bradbury pool
}

export interface AlertRun {
  id: string | number;
  jobId?: string | number;
  startedAt?: string;
  steps: { status: StepStatus | string }[];
  pass: boolean | null;
}

/** Ledger outcomes, the CHECK in migrations/010_alerts.sql. */
export const OUTCOMES = ["queued", "sent", "bounced", "suppressed", "refused", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that consumed sending capacity: counted by every cap and cooldown. */
export const COUNTED_OUTCOMES: readonly Outcome[] = ["queued", "sent", "bounced", "failed"];

/** `alert` = failure, assertion or recovery email (counted by the per-job cap); `digest` = daily summary. */
export type EmailKind = "alert" | "digest" | "verification";

/** Why an alert-kind or digest email went out (alert_emails.trigger_kind). */
export const TRIGGERS = ["failure", "assertion", "recovery", "digest"] as const;
export type AlertTrigger = (typeof TRIGGERS)[number];

/** Closed suppression vocabulary (the CHECK on alert_suppressions.reason). */
export type SuppressionReason = "hard_bounce" | "spam_complaint" | "unsubscribe" | "manual";

export interface Recipient {
  id: number;
  ownerWallet: string; // lowercased
  email: string; // lowercased
  createdAt: Date;
  verificationSentAt: Date | null;
  verifiedAt: Date | null;
  removedAt: Date | null;
  /** The owner's own emails-per-day cap for this mailbox; null = LIMITS.perRecipientPerDay.default. */
  dailyCap: number | null;
}

/**
 * Per-job alert rule, set self-serve by the job owner (lib/mailer/limits.ts has
 * the defaults and bounds). `failAfter`: mail after this many consecutive
 * failed runs (the caller passes the streak).
 */
export interface AlertRule extends RuleSettings {
  jobId: string;
  ownerWallet: string;
}

export interface EmailRow {
  id: number; // also the on-chain settlementId of the mailer's charge
  claimKey: string;
  kind: EmailKind;
  jobId: string | null;
  runId: string | null;
  recipientId: number | null;
  email: string;
  ownerWallet: string;
  network: Network | null;
  trigger: AlertTrigger | null;
  outcome: Outcome;
  reason: string | null;
  priceWei: string | null;
  chargeTx: string | null;
  providerMessageId: string | null;
  createdAt: Date;
}

/** What `notifyRunDecided` / `sendDigest` report per recipient. Never thrown, always returned. */
export interface RecipientDecision {
  recipientId: number;
  outcome: Outcome | "skipped";
  reason?: string;
  emailId?: number;
  chargeTx?: string;
}

export type NotifyResult =
  | { status: "disabled" }
  | { status: "not_armed"; missing: string[] }
  | { status: "not_wired" }
  | { status: "not_a_failure" }
  | { status: "not_decided" }
  | { status: "no_rule" }
  | { status: "trigger_off"; trigger: AlertTrigger }
  | { status: "not_down" }
  | { status: "nothing_to_report" }
  | { status: "below_threshold"; streak: number; failAfter: number }
  | { status: "throttled"; reason: string }
  | { status: "done"; trigger: AlertTrigger; decisions: RecipientDecision[] }
  | { status: "error"; error: string };
