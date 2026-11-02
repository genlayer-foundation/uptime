// Send policy for job alerts (docs/PRODUCT.md §11). Order is the design:
//
//   0. ENABLED         MAILER_ENABLED, else nothing at all
//   1. ARMED           provider + credential + From + token secret + public URL
//                      (+ price, mailer key, pool address on Bradbury), else nothing
//   2. CLASSIFY        pending / pass / step failure / assertion failure
//   3. RULE            the job's rule is on, owned by the job's owner, has recipients,
//                      and the trigger for this class is switched on
//   3a. failure:       streak >= failAfter
//   3b. recovery:      the job's last SENT alert was a failure or assertion alert
//                      (so recoveries <= failure alerts, and flapping stays bounded)
//   4. NETWORK GATE    Studio: owner allowlisted. Bradbury: job has a pool id
//   5. JOB COOLDOWN    failure alerts only: no alert (any trigger) for this job from
//                      another run in the last rule.cooldownMin minutes
//   per recipient:
//   6. RECIPIENT       verified, not removed, bound to the job owner (checked again at send)
//   7. SUPPRESSION     suppressed => recorded as `suppressed`, nothing sent or charged.
//                      A store failure REFUSES.
//   8. COUNTERS        per job/day (rule.perJobPerDay), per mailbox cooldown (failure only)
//                      + per day (the address's own cap), operator global ceiling, Studio
//                      per-wallet quota. Checked BEFORE the chain is touched
//   9. CLAIM           idempotent per (trigger, job, run|day, recipient): a retry never double-sends
//  10. CHARGE          Bradbury only: pool.charge as role 2, BEFORE sending. Only a
//                      simulated + mined Charged event lets the email out; ChargeSkipped
//                      or any doubt => `refused`
//  11. SUPPRESSION     re-checked right before delivery
//  12. DELIVER         once. No automatic retry: a duplicate email costs more than a missed one
//
// The daily digest (sendDigestWith) runs steps 0-1, 3-4 and 6-12: it is exempt
// from both cooldowns and from the per-job alert cap, and counts toward the
// mailbox and global caps. Gates before CLAIM write NO row. The on-chain
// allowance is the hard bound; the product counters are best-effort under
// concurrency and exist so the chain is not hit for nothing.

import { normalizeWallet } from "./address";
import { armedMissing, bradburyMissing, readConfig, tokenSecret, type MailerConfig } from "./config";
import type { PoolCharger } from "./charger";
import { LIMITS } from "./limits";
import type { MailProvider } from "./provider";
import type { AlertsRepo } from "./repo";
import { alertMessage, digestMessage, recoveryMessage, summarizeRuns, type Message } from "./templates";
import { unsubscribeUrl } from "./tokens";
import type { AlertJob, AlertRule, AlertRun, AlertTrigger, EmailKind, Network, NotifyResult, Recipient, RecipientDecision } from "./types";

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

export type RunClass = "pending" | "pass" | "step_failure" | "assertion_failure";

const OK_STEP = (s: string) => s === "ACCEPTED" || s === "FINALIZED";

/**
 * A step that did not reach ACCEPTED/FINALIZED (and is not still PENDING) is a
 * step failure, whatever `pass` says. All steps fine but `pass === false` is an
 * assertion failure. No verdict yet and nothing failed is not decided.
 */
export function classifyRun(run: AlertRun): RunClass {
  const steps = (run.steps ?? []).map((s) => String(s.status));
  if (steps.some((s) => s !== "PENDING" && !OK_STEP(s))) return "step_failure";
  if (run.pass === false) return "assertion_failure";
  if (run.pass === true) return "pass";
  return "pending";
}

/** A decided run that did not pass. */
export function isFailure(run: AlertRun): boolean {
  const c = classifyRun(run);
  return c === "step_failure" || c === "assertion_failure";
}

/** Which trigger a run would fire, before the rule is consulted. null = not decided. */
export function triggerFor(run: AlertRun): AlertTrigger | null {
  const c = classifyRun(run);
  return c === "step_failure" ? "failure" : c === "assertion_failure" ? "assertion" : c === "pass" ? "recovery" : null;
}

export function triggerEnabled(rule: Pick<AlertRule, "onFailure" | "onAssertion" | "onRecovery" | "digest">, t: AlertTrigger): boolean {
  return t === "failure" ? rule.onFailure : t === "assertion" ? rule.onAssertion : t === "recovery" ? rule.onRecovery : rule.digest;
}

/**
 * Product counters for one email to `email`. Returns the first exceeded limit, or null.
 * Shared by alerts, digests and confirmation mails so all draw on the same mailbox and global budget.
 */
export async function counterGate(
  repo: AlertsRepo,
  cfg: MailerConfig,
  now: Date,
  q: {
    email: string;
    ownerWallet: string;
    network: Network | null;
    /** The mailbox's own cap (Recipient.dailyCap); null/undefined = default. */
    recipientDailyCap?: number | null;
    /** Alert-kind emails: the job's own daily cap applies. */
    job?: { id: string; perJobPerDay: number };
    /** Recovery, digest and confirmation mails skip the mailbox cooldown. */
    skipRecipientCooldown?: boolean;
  }
): Promise<string | null> {
  const day = new Date(now.getTime() - DAY);
  const L = cfg.limits;
  if (q.job) {
    if ((await repo.countEmails({ kind: "alert", jobId: q.job.id, since: day })) >= q.job.perJobPerDay) return "job_daily_cap";
  }
  if (!q.skipRecipientCooldown && L.recipientCooldownMin > 0) {
    const since = new Date(now.getTime() - L.recipientCooldownMin * MIN);
    if (await repo.lastEmailAt({ email: q.email, since })) return "recipient_cooldown";
  }
  const perRecipient = q.recipientDailyCap ?? LIMITS.perRecipientPerDay.default;
  if ((await repo.countEmails({ email: q.email, since: day })) >= perRecipient) return "recipient_daily_cap";
  if ((await repo.countEmails({ since: day })) >= L.globalPerDay) return "global_ceiling";
  if (q.network === "studio") {
    const used = await repo.countEmails({ ownerWallet: q.ownerWallet, network: "studio", since: day });
    if (used >= L.studioPerWalletPerDay) return "studio_quota";
  }
  return null;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

type Gate = { ok: true; owner: string; jobId: string; rule: AlertRule } | { ok: false; result: NotifyResult };

/** Steps 1 and 3, shared by run alerts and digests. */
async function commonGates(deps: MailerDeps, cfg: MailerConfig, job: AlertJob, trigger: AlertTrigger | null): Promise<Gate> {
  const missing = armedMissing(cfg);
  if (!deps.provider && !missing.includes("MAILER_PROVIDER")) missing.push("MAILER_PROVIDER");
  if (job.network === "bradbury") {
    missing.push(...bradburyMissing(cfg));
    if (!deps.charger && !missing.includes("MAILER_KEY")) missing.push("MAILER_KEY");
  }
  if (missing.length) {
    deps.log(`mailer: NOT ARMED, missing ${missing.join(", ")}`);
    return { ok: false, result: { status: "not_armed", missing } };
  }
  if (trigger === null) return { ok: false, result: { status: "not_decided" } };
  const owner = normalizeWallet(job.owner);
  if (!owner) return { ok: false, result: { status: "error", error: "job owner is not a wallet" } };
  const jobId = String(job.id);
  const rule = await deps.repo.getRule(jobId);
  if (!rule || !rule.enabled || rule.ownerWallet !== owner || rule.recipientIds.length === 0) {
    return { ok: false, result: { status: "no_rule" } };
  }
  if (!triggerEnabled(rule, trigger)) return { ok: false, result: { status: "trigger_off", trigger } };
  return { ok: true, owner, jobId, rule };
}

/** Step 4. */
async function networkGate(deps: MailerDeps, job: AlertJob, owner: string): Promise<NotifyResult | null> {
  if (job.network === "studio" && !(await deps.studioAllowed(owner))) return { status: "throttled", reason: "studio_not_allowed" };
  if (job.network === "bradbury" && !(job.poolId && BYTES32.test(job.poolId))) return { status: "throttled", reason: "no_pool" };
  return null;
}

/**
 * The scheduler's entry point: call once per DECIDED run, pass or fail. A
 * failing run may send a failure or assertion alert; a passing run may send a
 * recovery email. Never throws; returns what it did.
 */
export async function notifyRunDecidedWith(
  deps: MailerDeps,
  job: AlertJob,
  run: AlertRun,
  opts: { consecutiveFailures?: number; config?: MailerConfig } = {}
): Promise<NotifyResult> {
  const cfg = opts.config ?? readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  try {
    const trigger = triggerFor(run);
    const g = await commonGates(deps, cfg, job, trigger);
    if (!g.ok) return g.result;
    const t = trigger!;
    const { owner, jobId, rule } = g;
    const runId = String(run.id);
    const now = deps.now();

    if (t === "recovery") {
      const last = await deps.repo.lastEmail({ kind: "alert", jobId, outcomes: ["sent"], since: new Date(0) });
      if (!last || last.trigger === "recovery" || last.runId === runId) return { status: "not_down" };
    } else {
      const streak = opts.consecutiveFailures ?? 1;
      if (streak < rule.failAfter) return { status: "below_threshold", streak, failAfter: rule.failAfter };
    }

    const blocked = await networkGate(deps, job, owner);
    if (blocked) return blocked;

    if (t !== "recovery") {
      const cooldownSince = new Date(now.getTime() - rule.cooldownMin * MIN);
      if (await deps.repo.lastEmailAt({ kind: "alert", jobId, excludeRunId: runId, since: cooldownSince })) {
        return { status: "throttled", reason: "job_cooldown" };
      }
    }

    const secret = tokenSecret()!; // armed => present
    const base = cfg.publicUrl!;
    const dashboard = `${base}/jobs/${encodeURIComponent(jobId)}`;
    const decisions: RecipientDecision[] = [];
    for (const rid of [...new Set(rule.recipientIds)].slice(0, 3)) {
      decisions.push(
        await sendOne(deps, cfg, {
          job,
          owner,
          jobId,
          rid,
          kind: "alert",
          trigger: t,
          claimKey: (r) => `${t === "recovery" ? "recovery" : "alert"}:${jobId}:${runId}:${r}`,
          runId,
          perJobPerDay: rule.perJobPerDay,
          skipRecipientCooldown: t === "recovery",
          compose: (r) => {
            const links = { unsubscribe: unsubscribeUrl(base, secret, r.email), dashboard };
            return t === "recovery" ? recoveryMessage(r.email, job, run, links) : alertMessage(r.email, job, run, links);
          },
        })
      );
    }
    return { status: "done", trigger: t, decisions };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log(`mailer: notifyRunDecided error: ${error.slice(0, 200)}`);
    return { status: "error", error };
  }
}

/** Back-compat name from the first scheduler wiring, which only passed failed runs. */
export const notifyRunFailedWith = notifyRunDecidedWith;

/** UTC calendar day: the digest's idempotency window. */
export function digestDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * One job's daily digest: at most one email per recipient per UTC day, however
 * often the cron fires. `runs` is the job's recent history; only the last 24 h
 * is summarized, and nothing is sent for a job with no runs in that window.
 */
export async function sendDigestWith(
  deps: MailerDeps,
  job: AlertJob,
  runs: AlertRun[],
  opts: { config?: MailerConfig } = {}
): Promise<NotifyResult> {
  const cfg = opts.config ?? readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  try {
    const g = await commonGates(deps, cfg, job, "digest");
    if (!g.ok) return g.result;
    const { owner, jobId } = g;
    const now = deps.now();
    const summary = summarizeRuns(runs, now);
    if (summary.total === 0) return { status: "nothing_to_report" };
    const blocked = await networkGate(deps, job, owner);
    if (blocked) return blocked;

    const secret = tokenSecret()!;
    const base = cfg.publicUrl!;
    const day = digestDay(now);
    const decisions: RecipientDecision[] = [];
    for (const rid of [...new Set(g.rule.recipientIds)].slice(0, 3)) {
      decisions.push(
        await sendOne(deps, cfg, {
          job,
          owner,
          jobId,
          rid,
          kind: "digest",
          trigger: "digest",
          claimKey: (r) => `digest:${jobId}:${day}:${r}`,
          runId: null,
          skipRecipientCooldown: true,
          compose: (r) =>
            digestMessage(r.email, job, summary, {
              unsubscribe: unsubscribeUrl(base, secret, r.email),
              dashboard: `${base}/jobs/${encodeURIComponent(jobId)}`,
            }),
        })
      );
    }
    return { status: "done", trigger: "digest", decisions };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log(`mailer: sendDigest error: ${error.slice(0, 200)}`);
    return { status: "error", error };
  }
}

async function sendOne(
  deps: MailerDeps,
  cfg: MailerConfig,
  c: {
    job: AlertJob;
    owner: string;
    jobId: string;
    rid: number;
    kind: Exclude<EmailKind, "verification">;
    trigger: AlertTrigger;
    claimKey: (recipientId: number) => string;
    runId: string | null;
    /** Alert-kind only: the job's own daily cap. */
    perJobPerDay?: number;
    skipRecipientCooldown: boolean;
    compose: (r: Recipient) => Message;
  }
): Promise<RecipientDecision> {
  const { repo } = deps;
  const now = deps.now();
  const r = await repo.getRecipient(c.rid);
  if (!r || r.ownerWallet !== c.owner || !r.verifiedAt || r.removedAt) {
    return { recipientId: c.rid, outcome: "skipped", reason: "not_verified" };
  }
  const network = c.job.network;
  const priceWei = network === "bradbury" ? cfg.priceWei!.toString() : null;
  const base = {
    claimKey: c.claimKey(r.id),
    kind: c.kind,
    trigger: c.trigger,
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

  const blocked = await counterGate(repo, cfg, now, {
    email: r.email,
    ownerWallet: c.owner,
    network,
    recipientDailyCap: r.dailyCap,
    job: c.kind === "alert" ? { id: c.jobId, perJobPerDay: c.perJobPerDay ?? LIMITS.perJobPerDay.default } : undefined,
    skipRecipientCooldown: c.skipRecipientCooldown,
  });
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

  const sent = await deps.provider!.deliver(c.compose(r), { from: cfg.from!, fromName: cfg.fromName, replyTo: cfg.replyTo });
  if (sent.ok) {
    await repo.finishEmail(row.id, { outcome: "sent", chargeTx: chargeTx ?? null, providerMessageId: sent.id }, deps.now());
    return { recipientId: r.id, outcome: "sent", emailId: row.id, chargeTx };
  }
  const reason = `${sent.kind}:${sent.error}`;
  await repo.finishEmail(row.id, { outcome: "failed", reason, chargeTx: chargeTx ?? null }, deps.now());
  return { recipientId: r.id, outcome: "failed", reason, emailId: row.id, chargeTx };
}
