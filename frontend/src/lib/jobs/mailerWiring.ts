// Registers the backend's pieces with the mailer once per server instance:
// the Postgres AlertsRepo (migrations 010 + 012), the Studio allowlist check,
// the job-owner lookup and the digest's data source. Called from
// src/instrumentation.ts at boot and, defensively, by the cron wiring.
// Without DATABASE_URL nothing is registered, so the mailer stays fail-closed
// (its routes answer 503, notifyRunDecided says "not_wired").

import { configureMailer, notifyRunDecided } from "@/lib/mailer";
import { isStudioAllowed } from "./allowlist";
import { pgAlertsRepo } from "./alertsRepo";
import { getPool, hasDatabase } from "./db";
import { toPublicRun } from "./executor";
import { isId } from "./ids";
import { toJob } from "./internal";
import { getRepo } from "./repo";
import type { Job, Run } from "./types";

// A day of runs at the fastest schedule (5 min) is 288; leave headroom.
const DIGEST_MAX_RUNS = 400;

export async function jobOwner(jobId: string): Promise<string | null> {
  return isId(jobId) ? ((await getRepo().getJob(jobId))?.owner ?? null) : null;
}

// The digest's data source: the job and its DECIDED runs scheduled since `since`.
export async function digestSource(jobId: string, since: Date) {
  if (!isId(jobId)) return null;
  const repo = getRepo();
  const job = await repo.getJob(jobId);
  if (!job) return null;
  const sinceSec = Math.floor(since.getTime() / 1000);
  const runs = (await repo.listRuns(jobId, DIGEST_MAX_RUNS)).filter((r) => r.state === "DONE" && r.scheduledFor >= sinceSec);
  return { job: toJob(job), runs: runs.map(toPublicRun) };
}

let wired = false;

export function ensureMailerWired(): boolean {
  if (wired) return true;
  if (!hasDatabase()) return false;
  configureMailer({
    repo: pgAlertsRepo(getPool()),
    studioAllowed: (w) => isStudioAllowed(w),
    jobOwner,
    digestSource,
  });
  wired = true;
  return true;
}

// The executor's hook, for EVERY decided run (pass or fail): never throws,
// never blocks the scheduler on mail.
export async function onRunDecided(job: Job, run: Run, consecutiveFailures: number): Promise<void> {
  try {
    ensureMailerWired();
    const r = await notifyRunDecided(job, run, { consecutiveFailures });
    if (r.status === "error") console.warn(`mailer: job ${job.id} run ${run.id}: ${r.error}`);
  } catch (e) {
    console.warn(`mailer: job ${job.id} run ${run.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
