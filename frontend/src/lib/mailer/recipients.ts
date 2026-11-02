// Verified recipients (§11.4.1-2) and the address-level STOP (§11.4.4).
//
// add -> one confirmation email with a signed, expiring link -> confirm.
// The address is bound to the owner wallet that added it, max 3 per wallet.
// Only confirmed, non-suppressed addresses of the job's own owner can receive
// alerts, checked when a rule is saved and again at send time.
//
// Responses never reveal whether an address is suppressed or known elsewhere:
// "pending" is the answer for a fresh address, a suppressed one and a resend
// inside the cooldown alike.

import { maskEmail, normalizeEmail, normalizeWallet } from "./address";
import { armedMissing, MAX_RECIPIENTS_PER_WALLET, readConfig, tokenSecret, VERIFY_TTL_SEC, type MailerConfig } from "./config";
import { counterGate, type MailerDeps } from "./policy";
import { verificationMessage } from "./templates";
import { checkUnsubscribeToken, checkVerifyToken, unsubscribeUrl, verifyUrl } from "./tokens";
import { LIMITS, validateRecipientCap, validateRuleSettings, type FieldErrors } from "./limits";
import type { AlertRule, Recipient, SuppressionReason } from "./types";

const VERIFY_RESEND_MIN = 10;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; fields?: FieldErrors };

export interface RecipientView {
  id: number;
  email: string;
  state: "pending" | "verified";
  createdAt: string;
  /** Emails per day to this address, all jobs together (the owner's own cap or the default). */
  dailyCap: number;
  /** True when dailyCap is the default, not a value the owner set. */
  dailyCapDefault: boolean;
}

export function view(r: Recipient): RecipientView {
  return {
    id: r.id,
    email: r.email,
    state: r.verifiedAt ? "verified" : "pending",
    createdAt: r.createdAt.toISOString(),
    dailyCap: r.dailyCap ?? LIMITS.perRecipientPerDay.default,
    dailyCapDefault: r.dailyCap == null,
  };
}

export async function listRecipients(deps: MailerDeps, wallet: string): Promise<RecipientView[]> {
  return (await deps.repo.listRecipients(wallet)).map(view);
}

export async function addRecipient(
  deps: MailerDeps,
  walletIn: string,
  emailIn: unknown,
  cfg: MailerConfig = readConfig()
): Promise<Result<RecipientView & { mailed: "sent" | "pending" }>> {
  const missing = armedMissing(cfg);
  if (missing.length || !deps.provider) return { ok: false, status: 503, error: "email alerts are not enabled" };
  const wallet = normalizeWallet(walletIn);
  if (!wallet) return { ok: false, status: 401, error: "not signed in" };
  const email = normalizeEmail(emailIn);
  if (!email) return { ok: false, status: 400, error: "not a valid email address" };

  const current = await deps.repo.listRecipients(wallet);
  if (!current.some((r) => r.email === email) && current.length >= MAX_RECIPIENTS_PER_WALLET) {
    return { ok: false, status: 409, error: `at most ${MAX_RECIPIENTS_PER_WALLET} addresses per wallet` };
  }
  const now = deps.now();
  const { recipient } = await deps.repo.upsertRecipient(wallet, email, now);
  if (recipient.verifiedAt) return { ok: true, value: { ...view(recipient), mailed: "pending" } };

  const pending = { ok: true as const, value: { ...view(recipient), mailed: "pending" as const } };
  if (await deps.repo.isSuppressed(email)) return pending;
  if (recipient.verificationSentAt && now.getTime() - recipient.verificationSentAt.getTime() < VERIFY_RESEND_MIN * 60_000) {
    return pending;
  }
  const blocked = await counterGate(deps.repo, cfg, now, { email, ownerWallet: wallet, network: null, recipientDailyCap: recipient.dailyCap });
  if (blocked) return { ok: false, status: 429, error: "too many emails right now, try again later" };

  const row = await deps.repo.claimEmail(
    {
      claimKey: `verify:${recipient.id}:${now.getTime()}`,
      kind: "verification",
      jobId: null,
      runId: null,
      recipientId: recipient.id,
      email,
      ownerWallet: wallet,
      network: null,
      priceWei: null,
    },
    now
  );
  if (!row) return pending;
  const secret = tokenSecret()!;
  const base = cfg.publicUrl!;
  const exp = Math.floor(now.getTime() / 1000) + VERIFY_TTL_SEC;
  const msg = verificationMessage(email, wallet, {
    confirm: verifyUrl(base, secret, recipient.id, email, wallet, exp),
    unsubscribe: unsubscribeUrl(base, secret, email),
  });
  const sent = await deps.provider.deliver(msg, { from: cfg.from!, fromName: cfg.fromName, replyTo: cfg.replyTo });
  await deps.repo.markVerificationSent(recipient.id, now);
  if (sent.ok) {
    await deps.repo.finishEmail(row.id, { outcome: "sent", providerMessageId: sent.id }, deps.now());
    return { ok: true, value: { ...view(recipient), mailed: "sent" } };
  }
  await deps.repo.finishEmail(row.id, { outcome: "failed", reason: `${sent.kind}:${sent.error}` }, deps.now());
  deps.log(`mailer: confirmation to ${maskEmail(email)} failed (${sent.kind}:${sent.error})`);
  return { ok: false, status: 502, error: "could not send the confirmation email, try again later" };
}

/** The confirmation link. Token is bound to (row, address, wallet, expiry). */
export async function confirmRecipient(
  deps: MailerDeps,
  q: { r: unknown; x: unknown; t: unknown }
): Promise<boolean> {
  const secret = tokenSecret();
  if (!secret) return false;
  const id = Number(q.r);
  const exp = Number(q.x);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof q.t !== "string") return false;
  const r = await deps.repo.getRecipient(id);
  if (!r || r.removedAt) return false;
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  if (!checkVerifyToken(secret, r, exp, q.t, nowSec)) return false;
  return deps.repo.confirmRecipient(id, deps.now());
}

export async function removeRecipient(deps: MailerDeps, wallet: string, id: number): Promise<boolean> {
  return deps.repo.removeRecipient(id, wallet, deps.now());
}

/** The owner sets how many emails per day one of their addresses may get (null = default). */
export async function setRecipientCap(deps: MailerDeps, wallet: string, id: number, cap: unknown): Promise<Result<RecipientView>> {
  const v = validateRecipientCap(cap);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  if (!(await deps.repo.setRecipientCap(id, wallet, v.value, deps.now()))) return { ok: false, status: 404, error: "not found" };
  const r = await deps.repo.getRecipient(id);
  return r ? { ok: true, value: view(r) } : { ok: false, status: 404, error: "not found" };
}

/** One-click unsubscribe. Does exactly one thing: suppress that address. Says nothing back. */
export async function unsubscribe(deps: MailerDeps, q: { e: unknown; t: unknown }): Promise<void> {
  const secret = tokenSecret();
  const email = normalizeEmail(q.e);
  if (!secret || !email || typeof q.t !== "string") return;
  if (!checkUnsubscribeToken(secret, email, q.t)) return;
  await deps.repo.suppress(email, "unsubscribe", "one-click link", deps.now());
}

/**
 * Bounce hook, for a webhook or any other source of a provider verdict.
 * Closed vocabulary; suppression is one-way.
 */
export async function recordBounce(
  deps: MailerDeps,
  emailIn: string,
  reason: SuppressionReason,
  detail: string
): Promise<boolean> {
  const email = normalizeEmail(emailIn);
  if (!email) return false;
  return deps.repo.suppress(email, reason, detail.slice(0, 120), deps.now());
}

/** Bounce sweep: merge the provider's suppression list into ours. A poll, never a mailbox. */
export async function sweepBounces(deps: MailerDeps): Promise<{ seen: number; added: number }> {
  if (!deps.provider) return { seen: 0, added: 0 };
  const rows = await deps.provider.suppressions(null);
  let added = 0;
  for (const row of rows) if (await recordBounce(deps, row.email, row.reason, row.detail)) added++;
  return { seen: rows.length, added };
}

/**
 * Save a job's alert rule: which of the owner's CONFIRMED addresses get it,
 * which triggers fire, and the owner's own limits (lib/mailer/limits.ts).
 */
export async function setJobRule(
  deps: MailerDeps,
  wallet: string,
  jobOwner: string | null,
  jobId: string,
  input: Record<string, unknown>
): Promise<Result<AlertRule>> {
  if (!jobOwner || normalizeWallet(jobOwner) !== wallet) return { ok: false, status: 404, error: "job not found" };
  const v = validateRuleSettings(input);
  if (!v.ok) return { ok: false, status: 400, error: Object.values(v.errors)[0] ?? "invalid rule", fields: v.errors };
  const mine = new Map((await deps.repo.listRecipients(wallet)).map((r) => [r.id, r]));
  if (v.value.recipientIds.some((id) => !mine.get(id)?.verifiedAt)) {
    const error = "every recipient must be one of your confirmed addresses";
    return { ok: false, status: 400, error, fields: { recipientIds: error } };
  }
  const rule: AlertRule = { ...v.value, jobId, ownerWallet: wallet };
  await deps.repo.setRule(rule, deps.now());
  return { ok: true, value: rule };
}
