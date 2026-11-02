// Registers the backend's pieces with the mailer once per server instance:
// the Postgres AlertsRepo, the Studio allowlist check, the job-owner lookup.
// Called from src/instrumentation.ts at boot and, defensively, by the cron
// wiring. Without DATABASE_URL nothing is registered, so the mailer stays
// fail-closed (its routes answer 503, notifyRunFailed says "not_wired").

import { configureMailer, notifyRunFailed } from "@/lib/mailer";
import { isStudioAllowed } from "./allowlist";
import { pgAlertsRepo } from "./alertsRepo";
import { getPool, hasDatabase } from "./db";
import { isId } from "./ids";
import { getRepo } from "./repo";
import type { Job, Run } from "./types";

let wired = false;

export function ensureMailerWired(): boolean {
  if (wired) return true;
  if (!hasDatabase()) return false;
  configureMailer({
    repo: pgAlertsRepo(getPool()),
    studioAllowed: (w) => isStudioAllowed(w),
    jobOwner: async (jobId) => (isId(jobId) ? ((await getRepo().getJob(jobId))?.owner ?? null) : null),
  });
  wired = true;
  return true;
}

// The executor's hook: never throws, never blocks the scheduler on mail.
export async function onRunFailed(job: Job, run: Run, consecutiveFailures: number): Promise<void> {
  try {
    ensureMailerWired();
    const r = await notifyRunFailed(job, run, { consecutiveFailures });
    if (r.status === "error") console.warn(`mailer: job ${job.id} run ${run.id}: ${r.error}`);
  } catch (e) {
    console.warn(`mailer: job ${job.id} run ${run.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
