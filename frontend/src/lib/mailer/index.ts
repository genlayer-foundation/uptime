// Email alerts for Uptime jobs (docs/PRODUCT.md §11). NOT AUDITED, TESTNET ONLY.
//
// The scheduler's only entry point:
//
//   import { notifyRunFailed } from "@/lib/mailer";
//   await notifyRunFailed(job, run, { consecutiveFailures });
//
// Call it from reconcile once a run is decided. It never throws and never
// blocks on anything but its own sends; it returns what it did. Off unless
// MAILER_ENABLED, and inert until `configureMailer` has registered a repo.

import { readConfig } from "./config";
import { notifyRunFailedWith } from "./policy";
import { mailerDeps } from "./runtime";
import type { AlertJob, AlertRun, NotifyResult } from "./types";

export async function notifyRunFailed(
  job: AlertJob,
  run: AlertRun,
  opts: { consecutiveFailures?: number } = {}
): Promise<NotifyResult> {
  const cfg = readConfig();
  if (!cfg.enabled) return { status: "disabled" };
  const deps = mailerDeps();
  if (!deps) return { status: "not_wired" };
  return notifyRunFailedWith(deps, job, run, { ...opts, config: cfg });
}

export { configureMailer, resetMailer } from "./runtime";
export type { MailerWiring } from "./runtime";
export type { AlertsRepo, EmailClaim, EmailFilter } from "./repo";
export type { AlertJob, AlertRun, NotifyResult } from "./types";
export { memoryAlertsRepo } from "./memoryRepo";
