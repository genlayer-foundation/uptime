// In-memory AlertsRepo. Reference semantics for the Postgres version, and the
// test double. Not for production: serverless instances do not share memory.

import type { AlertsRepo, EmailFilter } from "./repo";
import { COUNTED_OUTCOMES, type AlertRule, type EmailRow, type Recipient, type SuppressionReason } from "./types";

export function memoryAlertsRepo() {
  const recipients: Recipient[] = [];
  const suppressions = new Map<string, { reason: SuppressionReason; detail: string | null; at: Date }>();
  const rules = new Map<string, AlertRule>();
  const emails: EmailRow[] = [];

  const match = (f: EmailFilter) => (e: EmailRow) =>
    e.createdAt >= f.since &&
    (f.outcomes ?? COUNTED_OUTCOMES).includes(e.outcome) &&
    (f.kind === undefined || e.kind === f.kind) &&
    (f.jobId === undefined || e.jobId === f.jobId) &&
    (f.email === undefined || e.email === f.email) &&
    (f.ownerWallet === undefined || e.ownerWallet === f.ownerWallet) &&
    (f.network === undefined || e.network === f.network) &&
    (f.excludeRunId === undefined || e.runId !== f.excludeRunId);

  const repo: AlertsRepo & {
    emails: EmailRow[];
    recipients: Recipient[];
    suppressions: typeof suppressions;
  } = {
    emails,
    recipients,
    suppressions,

    async listRecipients(wallet) {
      return recipients.filter((r) => r.ownerWallet === wallet && !r.removedAt).map((r) => ({ ...r }));
    },
    async getRecipient(id) {
      const r = recipients.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async upsertRecipient(wallet, email, now) {
      const existing = recipients.find((r) => r.ownerWallet === wallet && r.email === email && !r.removedAt);
      if (existing) return { recipient: { ...existing }, created: false };
      const r: Recipient = {
        id: recipients.length + 1,
        ownerWallet: wallet,
        email,
        createdAt: now,
        verificationSentAt: null,
        verifiedAt: null,
        removedAt: null,
        dailyCap: null,
      };
      recipients.push(r);
      return { recipient: { ...r }, created: true };
    },
    async markVerificationSent(id, now) {
      const r = recipients.find((x) => x.id === id);
      if (r) r.verificationSentAt = now;
    },
    async confirmRecipient(id, now) {
      const r = recipients.find((x) => x.id === id);
      if (!r || r.removedAt) return false;
      if (!r.verifiedAt) r.verifiedAt = now;
      return true;
    },
    async removeRecipient(id, wallet, now) {
      const r = recipients.find((x) => x.id === id && x.ownerWallet === wallet && !x.removedAt);
      if (!r) return false;
      r.removedAt = now;
      for (const rule of rules.values()) rule.recipientIds = rule.recipientIds.filter((x) => x !== id);
      return true;
    },

    async setRecipientCap(id, wallet, cap) {
      const r = recipients.find((x) => x.id === id && x.ownerWallet === wallet && !x.removedAt);
      if (!r) return false;
      r.dailyCap = cap;
      return true;
    },

    async isSuppressed(email) {
      return suppressions.has(email);
    },
    async suppress(email, reason, detail, now) {
      if (suppressions.has(email)) return false;
      suppressions.set(email, { reason, detail, at: now });
      return true;
    },

    async getRule(jobId) {
      const r = rules.get(jobId);
      return r ? { ...r, recipientIds: [...r.recipientIds] } : null;
    },
    async setRule(rule) {
      rules.set(rule.jobId, { ...rule, recipientIds: [...rule.recipientIds] });
    },

    async listDigestRules() {
      return [...rules.values()].filter((r) => r.enabled && r.digest).map((r) => ({ ...r, recipientIds: [...r.recipientIds] }));
    },

    async claimEmail(c, now) {
      if (emails.some((e) => e.claimKey === c.claimKey)) return null;
      const row: EmailRow = {
        id: emails.length + 1,
        claimKey: c.claimKey,
        kind: c.kind,
        trigger: c.trigger ?? null,
        jobId: c.jobId,
        runId: c.runId,
        recipientId: c.recipientId,
        email: c.email,
        ownerWallet: c.ownerWallet,
        network: c.network,
        outcome: c.outcome ?? "queued",
        reason: c.reason ?? null,
        priceWei: c.priceWei,
        chargeTx: null,
        providerMessageId: null,
        createdAt: now,
      };
      emails.push(row);
      return { ...row };
    },
    async finishEmail(id, patch) {
      const e = emails.find((x) => x.id === id);
      if (!e) return;
      e.outcome = patch.outcome;
      if (patch.reason !== undefined) e.reason = patch.reason;
      if (patch.chargeTx !== undefined) e.chargeTx = patch.chargeTx;
      if (patch.providerMessageId !== undefined) e.providerMessageId = patch.providerMessageId;
    },
    async countEmails(f) {
      return emails.filter(match(f)).length;
    },
    async lastEmailAt(f) {
      return (await repo.lastEmail(f))?.createdAt ?? null;
    },
    async lastEmail(f) {
      const hits = emails.filter(match(f));
      // Ties on createdAt go to the later row (higher id).
      return hits.length ? { ...hits.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) } : null;
    },
  };
  return repo;
}
