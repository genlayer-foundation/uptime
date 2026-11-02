// Email alerts for Uptime jobs (docs/PRODUCT.md §11). NOT AUDITED, TESTNET ONLY.
//
// The scheduler's entry point, called from reconcile once a run is DECIDED
// (pass or fail, so a passing run can send the recovery email):
//
//   import { notifyRunDecided } from "@/lib/mailer";
//   await notifyRunDecided(job, run, { consecutiveFailures });
//
// The daily digest is a cron (`GET /api/alerts/digest`) that calls `sendDigest`
// per opted-in job. Neither ever throws; both return what they did. Off unless
// MAILER_ENABLED, and inert until `configureMailer` has registered a repo.

import { readConfig } from "./config";
import { notifyRunDecidedWith, sendDigestWith } from "./policy";
import { mailerDeps } from "./runtime";
import type { AlertJob, AlertRun, NotifyResult } from "./types";

export async function notifyRunDecided(
  job: AlertJob,
  run: AlertRun,
  opts: { consecutiveFailures?: number } = {}
): Promise<NotifyResult> {
  const cfg = readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  const deps = mailerDeps();
  if (!deps) return { status: "not_wired" };
  return notifyRunDecidedWith(deps, job, run, { ...opts, config: cfg });
}

/** Back-compat name: passing it a passing run is fine, it may send a recovery email. */
export const notifyRunFailed = notifyRunDecided;

export async function sendDigest(job: AlertJob, runs: AlertRun[]): Promise<NotifyResult> {
  const cfg = readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  const deps = mailerDeps();
  if (!deps) return { status: "not_wired" };
  return sendDigestWith(deps, job, runs, { config: cfg });
}

export { configureMailer, resetMailer } from "./runtime";
export type { MailerWiring } from "./runtime";
export type { AlertsRepo, EmailClaim, EmailFilter } from "./repo";
export type { AlertJob, AlertRun, NotifyResult } from "./types";
export { memoryAlertsRepo } from "./memoryRepo";
