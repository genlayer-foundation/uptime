// What the jobs UI shows for a job's state and a run's result. Pure, so the
// labels are tested without rendering (test/display.test.ts).

import type { Job, Run } from "./types";

type Tone = "neutral" | "success" | "danger" | "warn" | "purple";

// draft: never started, pool not funded yet. ready: funded, never started.
// running: scheduling. out-of-gen: scheduling, but runs are skipped because the
// pool cannot cover them. paused: the owner (or an on-chain pause) stopped it.
// stopped: the scheduler stopped it (state reason says why).
export type JobPhase = "draft" | "ready" | "running" | "out-of-gen" | "paused" | "stopped";

export type JobAction = "fund" | "start" | "pause" | "top-up" | "resume";

/**
 * `funded`: whether the job's pool can cover a run now (null = unknown or not
 * read). Only a draft needs it, to tell "Draft" from "Ready".
 */
export function jobPhase(job: Pick<Job, "paused" | "state">, funded: boolean | null = null): JobPhase {
  switch (job.state) {
    case "draft":
      return funded ? "ready" : "draft";
    case "unfunded":
      return "out-of-gen";
    case "errored":
      return "stopped";
    case "paused":
      return "paused";
    case "active":
      return "running";
    default:
      // Older backend without `state`.
      return job.paused ? "paused" : "running";
  }
}

export const PHASE: Record<JobPhase, { label: string; tone: Tone; action: JobAction; actionLabel: string }> = {
  draft: { label: "Draft", tone: "neutral", action: "fund", actionLabel: "Fund & start" },
  ready: { label: "Ready", tone: "purple", action: "start", actionLabel: "Start" },
  running: { label: "Running", tone: "success", action: "pause", actionLabel: "Pause" },
  "out-of-gen": { label: "Out of GEN", tone: "danger", action: "top-up", actionLabel: "Top up" },
  paused: { label: "Paused", tone: "warn", action: "resume", actionLabel: "Resume" },
  stopped: { label: "Stopped", tone: "danger", action: "resume", actionLabel: "Resume" },
};

/** A job that is not scheduling has no next run; a never-started one says so. */
export function nextRunLabel(phase: JobPhase): string | null {
  if (phase === "draft" || phase === "ready") return "not started";
  if (phase === "paused" || phase === "stopped") return "paused";
  return null; // compute from the schedule
}

/** A run's result cell: a skipped slot is never drawn as running. */
export function runVerdict(r: Pick<Run, "pass" | "skipped" | "unfunded">): { label: string; tone: Tone; pulse: boolean } {
  if (r.pass === true) return { label: "pass", tone: "success", pulse: false };
  if (r.pass === false) return { label: "fail", tone: "danger", pulse: false };
  if (r.unfunded) return { label: "Skipped — out of GEN", tone: "neutral", pulse: false };
  if (r.skipped !== undefined) return { label: "skipped", tone: "neutral", pulse: false };
  return { label: "running", tone: "warn", pulse: true };
}
