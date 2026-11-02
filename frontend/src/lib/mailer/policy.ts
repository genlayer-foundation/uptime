// Send policy for job-failure alerts (docs/PRODUCT.md §11). Order is the design:
//
//   0. ENABLED         MAILER_ENABLED, else nothing at all
//   1. ARMED           provider + credential + From + token secret + public URL
//                      (+ price, mailer key, pool address on Bradbury), else nothing
//   2. FAILURE         the run failed: an assertion, or a step not ACCEPTED/FINALIZED
//   3. RULE            the job's rule is on, owned by the job's owner, streak >= failAfter
//   4. NETWORK GATE    Studio: owner allowlisted. Bradbury: job has a pool id
//   5. JOB COOLDOWN    no alert for this job from another run in the last N min
//   per recipient:
//   6. RECIPIENT       verified, not removed, bound to the job owner (checked again at send)
//   7. SUPPRESSION     suppressed => recorded as `suppressed`, nothing sent or charged.
//                      A store failure REFUSES.
//   8. COUNTERS        per job/day, per mailbox cooldown + per day, global ceiling,
//                      Studio per-wallet quota. Checked BEFORE the chain is touched
//   9. CLAIM           idempotent per (job, run, recipient): a retry never double-sends
//  10. CHARGE          Bradbury only: pool.charge as role 2, BEFORE sending. Only a
//                      simulated + mined Charged event lets the email out; ChargeSkipped
//                      or any doubt => `refused`
//  11. SUPPRESSION     re-checked right before delivery
//  12. DELIVER         once. No automatic retry: a duplicate email costs more than a missed one
//
// Gates 0-8 write NO row. The on-chain allowance is the hard bound; the product
// counters are best-effort under concurrency and exist so the chain is not hit
// for nothing.

import { normalizeWallet } from "./address";
import { armedMissing, bradburyMissing, readConfig, tokenSecret, type MailerConfig } from "./config";
import type { PoolCharger } from "./charger";
import type { MailProvider } from "./provider";
import type { AlertsRepo } from "./repo";
import { alertMessage } from "./templates";
import { unsubscribeUrl } from "./tokens";
import type { AlertJob, AlertRun, Network, NotifyResult, RecipientDecision } from "./types";

export interface MailerDeps {
  repo: AlertsRepo;
  provider: MailProvider | null;
  charger: PoolCharger | null;
  /** Studio emails only for allowlisted wallets (§11.4.5). Default wiring denies. */
  studioAllowed: (wallet: string) => boolean | Promise<boolean>;
  now: () => Date;
  log: (line: string) => void;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A decided run that did not pass. Undecided (still PENDING) runs are not failures yet. */
export function isFailure(run: AlertRun): boolean {
  if (run.pass === false) return true;
  if (run.pass === true) return false;
  const steps = run.steps ?? [];
  return steps.some((s) => s.status !== "PENDING" && s.status !== "ACCEPTED" && s.status !== "FINALIZED");
}

/**
 * Product counters for one email to `email`. Returns the first exceeded limit, or null.
 * Shared by alerts and confirmation mails so both draw on the same mailbox and global budget.
 */
export async function counterGate(
  repo: AlertsRepo,
  cfg: MailerConfig,
  now: Date,
  q: { email: string; ownerWallet: string; network: Network | null; jobId?: string }
): Promise<string | null> {
  const day = new Date(now.getTime() - DAY);
  const L = cfg.limits;
  if (q.jobId !== undefined) {
    if ((await repo.countEmails({ kind: "alert", jobId: q.jobId, since: day })) >= L.perJobPerDay) return "job_daily_cap";
  }
  if (L.recipientCooldownMin > 0) {
    const since = new Date(now.getTime() - L.recipientCooldownMin * MIN);
    if (await repo.lastEmailAt({ email: q.email, since })) return "recipient_cooldown";
  }
  if ((await repo.countEmails({ email: q.email, since: day })) >= L.perRecipientPerDay) return "recipient_daily_cap";
  if ((await repo.countEmails({ since: day })) >= L.globalPerDay) return "global_ceiling";
  if (q.network === "studio") {
    const used = await repo.countEmails({ kind: "alert", ownerWallet: q.ownerWallet, network: "studio", since: day });
    if (used >= L.studioPerWalletPerDay) return "studio_quota";
  }
  return null;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export async function notifyRunFailedWith(
  deps: MailerDeps,
  job: AlertJob,
  run: AlertRun,
  opts: { consecutiveFailures?: number; config?: MailerConfig } = {}
): Promise<NotifyResult> {
  const cfg = opts.config ?? readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  try {
    const missing = armedMissing(cfg);
    if (!deps.provider && !missing.includes("MAILER_PROVIDER")) missing.push("MAILER_PROVIDER");
    if (job.network === "bradbury") {
      missing.push(...bradburyMissing(cfg));
      if (!deps.charger && !missing.includes("MAILER_KEY")) missing.push("MAILER_KEY");
    }
    if (missing.length) {
      deps.log(`mailer: NOT ARMED, missing ${missing.join(", ")}`);
      return { status: "not_armed", missing };
    }
    if (!isFailure(run)) return { status: "not_a_failure" };

    const owner = normalizeWallet(job.owner);
    if (!owner) return { status: "error", error: "job owner is not a wallet" };
    const jobId = String(job.id);
    const runId = String(run.id);
    const now = deps.now();

    const rule = await deps.repo.getRule(jobId);
    if (!rule || !rule.enabled || rule.ownerWallet !== owner || rule.recipientIds.length === 0) {
      return { status: "no_rule" };
    }
    const streak = opts.consecutiveFailures ?? 1;
    if (streak < rule.failAfter) return { status: "below_threshold", streak, failAfter: rule.failAfter };

    if (job.network === "studio" && !(await deps.studioAllowed(owner))) {
      return { status: "throttled", reason: "studio_not_allowed" };
    }
    if (job.network === "bradbury" && !(job.poolId && BYTES32.test(job.poolId))) {
      return { status: "throttled", reason: "no_pool" };
    }

    const cooldownSince = new Date(now.getTime() - cfg.limits.jobCooldownMin * MIN);
    if (await deps.repo.lastEmailAt({ kind: "alert", jobId, excludeRunId: runId, since: cooldownSince })) {
      return { status: "throttled", reason: "job_cooldown" };
    }

    const secret = tokenSecret()!; // armed => present
    const base = cfg.publicUrl!;
    const decisions: RecipientDecision[] = [];

    for (const rid of [...new Set(rule.recipientIds)].slice(0, 3)) {
      decisions.push(await sendOne(deps, cfg, { job, run, owner, jobId, runId, rid, secret, base }));
    }
    return { status: "done", decisions };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log(`mailer: notifyRunFailed error: ${error.slice(0, 200)}`);
    return { status: "error", error };
  }
}

async function sendOne(
  deps: MailerDeps,
  cfg: MailerConfig,
  c: { job: AlertJob; run: AlertRun; owner: string; jobId: string; runId: string; rid: number; secret: string; base: string }
): Promise<RecipientDecision> {
  const { repo } = deps;
  const now = deps.now();
  const r = await repo.getRecipient(c.rid);
  if (!r || r.ownerWallet !== c.owner || !r.verifiedAt || r.removedAt) {
    return { recipientId: c.rid, outcome: "skipped", reason: "not_verified" };
  }
  const network = c.job.network;
  const claimKey = `alert:${c.jobId}:${c.runId}:${r.id}`;
  const priceWei = network === "bradbury" ? cfg.priceWei!.toString() : null;
  const base = {
    claimKey,
    kind: "alert" as const,
    jobId: c.jobId,
    runId: c.runId,
    recipientId: r.id,
    email: r.email,
    ownerWallet: c.owner,
    network,
    priceWei,
  };

  let suppressed: boolean;
  try {
    suppressed = await repo.isSuppressed(r.email);
  } catch {
    return { recipientId: r.id, outcome: "skipped", reason: "suppression_check_failed" };
  }
  if (suppressed) {
    const row = await repo.claimEmail({ ...base, outcome: "suppressed", reason: "suppressed" }, now);
    return { recipientId: r.id, outcome: row ? "suppressed" : "skipped", reason: row ? "suppressed" : "duplicate" };
  }

  const blocked = await counterGate(repo, cfg, now, { email: r.email, ownerWallet: c.owner, network, jobId: c.jobId });
  if (blocked) return { recipientId: r.id, outcome: "skipped", reason: blocked };

  const row = await repo.claimEmail(base, now);
  if (!row) return { recipientId: r.id, outcome: "skipped", reason: "duplicate" };

  let chargeTx: string | undefined;
  if (network === "bradbury") {
    let res;
    try {
      res = await deps.charger!.charge({
        poolId: c.job.poolId as `0x${string}`,
        ownerWallet: c.owner,
        amountWei: cfg.priceWei!,
        settlementId: BigInt(row.id),
      });
    } catch (e) {
      res = { outcome: "failed" as const, reason: `charge_error:${e instanceof Error ? e.name : "error"}` };
    }
    chargeTx = res.txHash || undefined;
    if (res.outcome !== "charged") {
      const reason = `charge_${res.outcome}:${res.reason}`;
      await repo.finishEmail(row.id, { outcome: "refused", reason, chargeTx: chargeTx ?? null }, deps.now());
      return { recipientId: r.id, outcome: "refused", reason, emailId: row.id, chargeTx };
    }
  }

  // Last look before the irreversible step.
  let stillSuppressed: boolean;
  try {
    stillSuppressed = await repo.isSuppressed(r.email);
  } catch {
    stillSuppressed = true; // refuse on doubt; the charge (if any) is recorded on the row
  }
  if (stillSuppressed) {
    await repo.finishEmail(row.id, { outcome: "suppressed", reason: "suppressed_before_send", chargeTx: chargeTx ?? null }, deps.now());
    return { recipientId: r.id, outcome: "suppressed", reason: "suppressed_before_send", emailId: row.id, chargeTx };
  }

  const msg = alertMessage(r.email, c.job, c.run, {
    unsubscribe: unsubscribeUrl(c.base, c.secret, r.email),
    dashboard: `${c.base}/`,
  });
  const sent = await deps.provider!.deliver(msg, { from: cfg.from!, fromName: cfg.fromName, replyTo: cfg.replyTo });
  if (sent.ok) {
    await repo.finishEmail(row.id, { outcome: "sent", chargeTx: chargeTx ?? null, providerMessageId: sent.id }, deps.now());
    return { recipientId: r.id, outcome: "sent", emailId: row.id, chargeTx };
  }
  const reason = `${sent.kind}:${sent.error}`;
  await repo.finishEmail(row.id, { outcome: "failed", reason, chargeTx: chargeTx ?? null }, deps.now());
  return { recipientId: r.id, outcome: "failed", reason, emailId: row.id, chargeTx };
}
