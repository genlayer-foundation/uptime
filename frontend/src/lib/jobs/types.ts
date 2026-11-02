// SHARED CONTRACT for GenLayer Uptime (a generic paid cron for GenLayer).
// Several workstreams code against this file: the backend (lib/jobs/*,
// app/api/*), the jobs UI and the UI shell. Change it only by agreement.
//
// A Job runs its steps in order on `schedule`. A step with its own
// `schedule` runs on that schedule instead, independently (e.g. deploy
// hourly, call the deployed address every 5 minutes). Schedules are
// `everyMinutes` (>= 5) or a 5-field UTC `cron` (fires at most every 5 min).
//
// `contract` is a 0x address or "$<stepId>.address": the contract created by
// that deploy step in the same run, else by its latest accepted run.
// String args may use placeholders, expanded per run:
//   {{job_id}} {{run_id}} {{slot}} (unix seconds) {{relayer}} (the signer)
// Assertions run on a step's recorded `result` (dot `path`, e.g.
// "result.ok"); a run passes when every step succeeded and every assertion
// on a step of that run holds.

export type Network = "studio" | "bradbury";

export type Schedule = { everyMinutes?: number; cron?: string }; // min 5 min

export type Step =
  | {
      id: string;
      kind: "write";
      contract: string /* address or '$<stepId>.address' */;
      method: string;
      args: unknown[];
      value?: string;
      schedule?: Schedule;
    }
  | { kind: "deploy"; id: string; code?: string; preset?: string; args: unknown[]; schedule?: Schedule }
  | { kind: "read"; id: string; contract: string; method: string; args: unknown[]; schedule?: Schedule };

export type Assertion = {
  step: string;
  path?: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";
  expected?: unknown;
};

export type Job = {
  id: string;
  owner: string;
  name: string;
  network: Network;
  schedule: Schedule;
  steps: Step[];
  assertions: Assertion[];
  poolId?: string;
  paused: boolean;
  preset?: string;
  public?: boolean;
  createdAt: string;
};

export type StepRun = {
  stepId: string;
  txHash?: string;
  status: "PENDING" | "ACCEPTED" | "FINALIZED" | "UNDETERMINED" | "TIMEOUT" | "SUBMIT_FAILED" | "ERROR";
  result?: unknown;
  timeToAcceptedMs?: number;
  gasGen?: string;
  error?: string;
};

export type Run = { id: string; jobId: string; startedAt: string; steps: StepRun[]; pass: boolean | null };
