// Server-side shapes. The public ones (Job, Run, StepRun) are in ./types.ts
// and are what the API returns; these carry what only the backend needs.

import type { ScheduleRow } from "./schedule";
import type { Assertion, Job, Network, Schedule, Step, StepRun } from "./types";

export type JobState = "draft" | "active" | "paused" | "errored" | "deleted";

export interface JobRow {
  id: string; // UUID
  owner: string; // lowercased wallet
  name: string;
  network: Network;
  preset: string | null;
  schedule: Schedule;
  steps: Step[];
  assertions: Assertion[];
  state: JobState;
  stateReason: string | null;
  system: boolean;
  public: boolean;
  poolId: string; // bytes32 hex derived from id (pool ids are first-come on-chain)
  perRunCapWei: string | null;
  createdAt: number;
  updatedAt: number;
  schedules: ScheduleRow[];
}

export interface NewJob {
  id: string;
  owner: string;
  name: string;
  network: Network;
  preset: string | null;
  schedule: Schedule;
  steps: Step[];
  assertions: Assertion[];
  state: JobState;
  system?: boolean;
  public?: boolean;
  poolId: string;
  perRunCapWei?: string | null;
  schedules: ScheduleRow[];
}

export type RunState = "RUNNING" | "DONE" | "SKIPPED";

export interface StepRunRow extends StepRun {
  idx: number;
  kind: Step["kind"] | "probe";
  submittedAt: number | null;
  resolvedAt: number | null;
  rounds?: number;
  votes?: { agree: number; disagree: number; timeout: number; other: number };
  gasWei?: string;
  chainStatus?: string; // raw statusName, e.g. LEADER_TIMEOUT
}

export interface RunRow {
  id: string; // UUID
  jobId: string;
  group: string; // schedule group key ("job" or a step id)
  scheduledFor: number;
  startedAt: number;
  state: RunState;
  cursor: number; // index (within the group's steps) of the next step to start
  pass: boolean | null;
  error: string | null;
  meta: Record<string, unknown>;
  steps: StepRunRow[];
}

export function toJob(j: JobRow): Job {
  return {
    id: j.id,
    owner: j.owner,
    name: j.name,
    network: j.network,
    schedule: j.schedule,
    steps: j.steps,
    assertions: j.assertions,
    poolId: j.network === "bradbury" ? j.poolId : undefined,
    paused: j.state !== "active",
    ...(j.preset ? { preset: j.preset } : {}),
    public: j.public,
    createdAt: new Date(j.createdAt * 1000).toISOString(),
  };
}

// What the API adds next to a Job: the backend's own view of it.
export interface JobStatus {
  state: JobState;
  reason: string | null;
  system: boolean;
  nextRunAt: string | null;
  perRunCapWei: string | null;
}

export function toStatus(j: JobRow): JobStatus {
  const next = j.state === "active" ? Math.min(...j.schedules.map((s) => s.nextDueAt)) : null;
  return {
    state: j.state,
    reason: j.stateReason,
    system: j.system,
    nextRunAt: next && Number.isFinite(next) ? new Date(next * 1000).toISOString() : null,
    perRunCapWei: j.perRunCapWei,
  };
}
