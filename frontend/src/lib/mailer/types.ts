// Types for the email-alert mailer (docs/PRODUCT.md §11).
//
// AlertJob / AlertRun are the SUBSET of the shared job contract
// (lib/jobs/types.ts `Job` / `Run`, on the backend branch) that the mailer
// reads. They are structural on purpose: a full `Job` and `Run` satisfy them,
// so the scheduler calls `notifyRunFailed(job, run)` with what it already has.

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

export type EmailKind = "alert" | "verification";

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
}

export interface AlertRule {
  jobId: string;
  ownerWallet: string;
  enabled: boolean;
  /** Mail after this many consecutive failed runs (the caller passes the streak). */
  failAfter: number;
  recipientIds: number[];
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
  outcome: Outcome;
  reason: string | null;
  priceWei: string | null;
  chargeTx: string | null;
  providerMessageId: string | null;
  createdAt: Date;
}

/** What `notifyRunFailed` reports per recipient. Never thrown, always returned. */
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
  | { status: "no_rule" }
  | { status: "below_threshold"; streak: number; failAfter: number }
  | { status: "throttled"; reason: string }
  | { status: "done"; decisions: RecipientDecision[] }
  | { status: "error"; error: string };
