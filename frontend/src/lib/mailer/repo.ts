// Storage seam for the mailer. The tables are in migrations/010_alerts.sql;
// the Postgres implementation is wired by the backend (see runtime.ts
// `configureMailer`). `memoryAlertsRepo` is the reference implementation and
// what the tests run against.

import type { AlertRule, EmailKind, EmailRow, Network, Outcome, Recipient, SuppressionReason } from "./types";

export interface EmailClaim {
  claimKey: string; // unique: a second claim with the same key returns null
  kind: EmailKind;
  jobId: string | null;
  runId: string | null;
  recipientId: number | null;
  email: string;
  ownerWallet: string;
  network: Network | null;
  priceWei: string | null;
  outcome?: Outcome; // default "queued"; "suppressed" for a recorded non-send
  reason?: string | null;
}

export interface EmailFilter {
  kind?: EmailKind;
  jobId?: string;
  email?: string;
  ownerWallet?: string;
  network?: Network;
  excludeRunId?: string;
  since: Date;
  /** Defaults to COUNTED_OUTCOMES. */
  outcomes?: readonly Outcome[];
}

export interface AlertsRepo {
  // recipients (bound to an owner wallet)
  listRecipients(wallet: string): Promise<Recipient[]>; // not removed
  getRecipient(id: number): Promise<Recipient | null>;
  /** Insert, or return the existing non-removed row for (wallet, email). */
  upsertRecipient(wallet: string, email: string, now: Date): Promise<{ recipient: Recipient; created: boolean }>;
  markVerificationSent(id: number, now: Date): Promise<void>;
  confirmRecipient(id: number, now: Date): Promise<boolean>;
  removeRecipient(id: number, wallet: string, now: Date): Promise<boolean>;

  // suppression: address-level, one-way. There is no unsuppress.
  isSuppressed(email: string): Promise<boolean>;
  suppress(email: string, reason: SuppressionReason, detail: string | null, now: Date): Promise<boolean>; // true = new

  // per-job alert rule
  getRule(jobId: string): Promise<AlertRule | null>;
  setRule(rule: AlertRule, now: Date): Promise<void>;

  // email ledger
  claimEmail(c: EmailClaim, now: Date): Promise<EmailRow | null>;
  finishEmail(
    id: number,
    patch: { outcome: Outcome; reason?: string | null; chargeTx?: string | null; providerMessageId?: string | null },
    now: Date
  ): Promise<void>;
  countEmails(f: EmailFilter): Promise<number>;
  lastEmailAt(f: EmailFilter): Promise<Date | null>;
}
