// Job CRUD rules, independent of HTTP so the gate is testable without a
// server. Routes in app/api/jobs/* are thin wrappers over these.

import { studioMaxJobs } from "./allowlist";
import { runGate, studioGate, type GateDeps } from "./gate";
import { isId, newId, poolIdFor } from "./ids";
import type { JobRow } from "./internal";
import type { JobPatch, Repo } from "./repo";
import { initialSchedule, resumeSchedule, toSpec } from "./schedule";
import { groupsOf, InvalidJob, validateAssertions, validateJobInput, validateSteps } from "./spec";
import { validateSchedule } from "./schedule";
import type { Schedule, Step } from "./types";

export interface ServiceDeps {
  repo: Repo;
  gate: GateDeps;
  nowSec: () => number;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Outcome<never> => ({ ok: false, status, error });
const WEI = /^\d{1,40}$/;

function schedulesFor(job: { schedule: Schedule; steps: Step[] }, now: number) {
  return groupsOf(job).map((g) => initialSchedule(toSpec(g.key, g.schedule), now));
}

export async function createJob(deps: ServiceDeps, wallet: string, body: Record<string, unknown>): Promise<Outcome<JobRow>> {
  const owner = wallet.toLowerCase();

  // Studio gate FIRST, before anything else is even validated.
  if (body.network === "studio") {
    const g = studioGate(owner, deps.gate.allowlist);
    if (!g.ok) return fail(403, g.reason);
    if ((await deps.repo.countLiveJobs(owner, "studio")) >= studioMaxJobs()) {
      return fail(429, `Studio quota reached: at most ${studioMaxJobs()} jobs per wallet`);
    }
  }
  if (body.preset === "heartbeat") return fail(403, "The Bradbury Heartbeat is run by the Foundation and cannot be created");

  let input;
  try {
    input = validateJobInput(body);
  } catch (e) {
    if (e instanceof InvalidJob) return fail(400, e.message);
    throw e;
  }
  const cap = body.perRunCapWei;
  if (cap !== undefined && cap !== null && cap !== "" && !(typeof cap === "string" && WEI.test(cap))) {
    return fail(400, "perRunCapWei must be a whole number of wei");
  }

  const now = deps.nowSec();
  const id = newId();
  const value = await deps.repo.createJob({
    id,
    owner,
    ...input,
    // Bradbury starts as a draft: it schedules once the owner has funded the
    // pool and resumes it. The funding gate is checked again on every run.
    state: input.network === "bradbury" ? "draft" : "active",
    poolId: poolIdFor(id),
    perRunCapWei: typeof cap === "string" && cap ? cap : null,
    schedules: schedulesFor(input, now),
  });
  return { ok: true, value };
}

// Owner-only. A missing or foreign job is 404 either way (no probing ids).
export async function getOwned(deps: ServiceDeps, wallet: string, id: string): Promise<Outcome<JobRow>> {
  const j = isId(id) ? await deps.repo.getJob(id) : null;
  if (!j || j.owner !== wallet.toLowerCase()) return fail(404, "job not found");
  return { ok: true, value: j };
}

function mutable(j: JobRow): Outcome<JobRow> | null {
  if (j.system) return fail(403, "system jobs are managed by the Foundation");
  return null;
}

// Owner, or an operator (UPTIME_ADMIN_WALLETS) for ANY job, system jobs included.
export async function pauseJob(deps: ServiceDeps, wallet: string, id: string, opts: { admin?: boolean } = {}): Promise<Outcome<JobRow>> {
  if (opts.admin) {
    const j = isId(id) ? await deps.repo.getJob(id) : null;
    if (!j) return fail(404, "job not found");
    return found(await deps.repo.updateJob(id, { state: "paused", stateReason: `paused by operator ${wallet.toLowerCase()}` }));
  }
  const got = await getOwned(deps, wallet, id);
  if (!got.ok) return got;
  const no = mutable(got.value);
  if (no) return no;
  return found(await deps.repo.updateJob(id, { state: "paused", stateReason: null }));
}

// Resume (also: activate a Bradbury draft after funding). Same gate as the
// scheduler, checked now; slots slept through are skipped, not replayed.
export async function resumeJob(deps: ServiceDeps, wallet: string, id: string): Promise<Outcome<JobRow>> {
  const got = await getOwned(deps, wallet, id);
  if (!got.ok) return got;
  const j = got.value;
  const no = mutable(j);
  if (no) return no;
  const gate = await runGate(j, deps.gate);
  if (!gate.ok) return fail(j.network === "studio" ? 403 : 409, gate.reason);
  const now = deps.nowSec();
  await deps.repo.replaceSchedules(j.id, j.schedules.map((s) => resumeSchedule(s, now)));
  return found(await deps.repo.updateJob(j.id, { state: "active", stateReason: null }));
}

export async function deleteJob(deps: ServiceDeps, wallet: string, id: string): Promise<Outcome<JobRow>> {
  const got = await getOwned(deps, wallet, id);
  if (!got.ok) return got;
  const no = mutable(got.value);
  if (no) return no;
  // Soft delete: history stays (and unsettled Bradbury runs can still be charged).
  await deps.repo.updateJob(id, { state: "deleted" });
  return { ok: true, value: got.value };
}

// PATCH: any of name, schedule, steps, assertions, public, perRunCapWei.
// Network is fixed at creation (its pool and allowlist differ).
export async function editJob(deps: ServiceDeps, wallet: string, id: string, body: Record<string, unknown>): Promise<Outcome<JobRow>> {
  const got = await getOwned(deps, wallet, id);
  if (!got.ok) return got;
  const j = got.value;
  const no = mutable(j);
  if (no) return no;
  if (j.network === "studio") {
    const g = studioGate(j.owner, deps.gate.allowlist);
    if (!g.ok) return fail(403, g.reason);
  }
  if (body.network !== undefined && body.network !== j.network) return fail(400, "network cannot be changed");
  const patch: JobPatch = {};
  try {
    if (body.name !== undefined) {
      const n = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (!n) throw new InvalidJob("name is required");
      patch.name = n;
    }
    if (body.schedule !== undefined) {
      const err = validateSchedule(body.schedule);
      if (err) throw new InvalidJob(`schedule: ${err}`);
      const s = body.schedule as Schedule;
      patch.schedule = s.cron ? { cron: s.cron.trim() } : { everyMinutes: s.everyMinutes };
    }
    const steps = body.steps !== undefined ? validateSteps(body.steps) : j.steps;
    if (body.steps !== undefined) patch.steps = steps;
    if (body.assertions !== undefined || body.steps !== undefined) {
      patch.assertions = validateAssertions(body.assertions ?? j.assertions, steps);
    }
  } catch (e) {
    if (e instanceof InvalidJob) return fail(400, e.message);
    throw e;
  }
  if (typeof body.public === "boolean") patch.public = body.public;
  if ("perRunCapWei" in body) {
    const c = body.perRunCapWei;
    if (c === null || c === "") patch.perRunCapWei = null;
    else if (typeof c === "string" && WEI.test(c)) patch.perRunCapWei = c;
    else return fail(400, "perRunCapWei must be a whole number of wei");
  }
  if (patch.schedule || patch.steps) {
    const now = deps.nowSec();
    await deps.repo.replaceSchedules(j.id, schedulesFor({ schedule: patch.schedule ?? j.schedule, steps: patch.steps ?? j.steps }, now));
  }
  return found(await deps.repo.updateJob(j.id, patch));
}

function found(j: JobRow | null): Outcome<JobRow> {
  return j ? { ok: true, value: j } : fail(404, "job not found");
}
