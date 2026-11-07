// "Run now": what a visitor's manual run executes. Pure and client-safe: the
// API (lib/jobs/manual.ts) and the button (components/jobs/RunNow.tsx) share it.
//
// A manual run is ONE extra run of the job's main schedule group, signed and
// paid by the visitor's own wallet. The Bradbury Heartbeat is the exception:
// its contract lets only its operator call bump/probe_status/probe (the frozen
// benchmark), so a visitor's run there is the permissionless canary deploy.

import { DEFAULT_BRADBURY_FEES } from "@/lib/genlayer/fees";
import { groupsOf } from "./spec";
import type { Network, Schedule, Step } from "./types";

export const MANUAL_GROUP = "manual";
export const MANUAL_MIN_GAP_SEC = 60;

type JobLike = { steps: Step[]; schedule: Schedule };

export function manualSteps(job: JobLike, heartbeat: boolean): Step[] {
  if (heartbeat) return job.steps.filter((s) => s.kind === "deploy");
  const groups = groupsOf(job);
  return (groups.find((g) => g.key === "job") ?? groups[0])?.steps ?? [];
}

/** Why this job cannot be run by a visitor, or null. */
export function manualBlocker(job: JobLike, heartbeat: boolean): string | null {
  const steps = manualSteps(job, heartbeat);
  if (!steps.some((s) => s.kind !== "read")) return "This job has nothing to sign";
  // The visitor's value would go to the contract: keep GEN transfers owner-only.
  if (steps.some((s) => s.kind === "write" && s.value && s.value !== "0")) return "This job sends GEN to a contract";
  return null;
}

export const signableCount = (job: JobLike, heartbeat: boolean) =>
  manualSteps(job, heartbeat).filter((s) => s.kind !== "read").length;

/**
 * Rough Phase 2 deposit per transaction at the default fee distribution: the
 * execution budget for the leader round and its one rotation. Unused budget
 * is refunded at finalization, so this is an upper estimate. Studio is free.
 */
export function approxDepositWei(network: Network, txs: number): bigint {
  if (network !== "bradbury") return BigInt(0);
  const d = DEFAULT_BRADBURY_FEES;
  return d.executionBudgetPerRound * BigInt(2) * (d.appealRounds + BigInt(1)) * BigInt(txs);
}

// ---------------------------------------------------------------------------
// Call arguments travel as JSON: bigints are tagged so the browser encodes
// exactly the calldata the server will compare against.

export function tagArgs(v: unknown): unknown {
  if (typeof v === "bigint") return { $bigint: v.toString() };
  if (Array.isArray(v)) return v.map(tagArgs);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tagArgs(x)]));
  return v;
}

export function untagArgs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(untagArgs);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$bigint === "string" && /^-?\d+$/.test(o.$bigint)) return BigInt(o.$bigint);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, untagArgs(x)]));
  }
  return v;
}

/** One transaction the visitor signs. `args` are tagged (tagArgs). */
export type ManualCall =
  | { kind: "write"; idx: number; stepId: string; address: `0x${string}`; method: string; args: unknown[] }
  | { kind: "deploy"; idx: number; stepId: string; code: string; args: unknown[] };

/** Fee distribution with bigints as decimal strings (lib/genlayer/fees.ts shape). */
export type WireFees = Record<string, string | string[]> | null;

export type ManualStatus =
  | { state: "sign"; runId: string | null; token?: string; call: ManualCall; fees: WireFees; network: Network }
  | { state: "pending"; runId: string }
  | { state: "done"; runId: string; pass: boolean | null; error?: string | null };
