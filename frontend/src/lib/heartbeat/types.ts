import type { Grade } from "./questions";

export type ProbeKind = "deploy" | "fetch" | "llm" | "appeal";

export interface VoteCounts {
  agree: number;
  disagree: number;
  timeout: number;
  other: number;
}

export interface ProbeRecord {
  id: string; // `${tick}:${kind}:${qid ?? ""}`
  tick: number;
  kind: ProbeKind;
  qid?: string;
  qkind?: string;
  txHash?: `0x${string}`;
  submittedAt: number; // unix seconds, wall clock
  // Set on llm probes chosen to be appealed once they are ACCEPTED.
  appealDue?: boolean;
  // appeal records: the llm probe being appealed, and its answer before
  appealOf?: string;
  answerBefore?: string;

  // Filled in by reconcile.
  status?: string; // final statusName, or SUBMIT_FAILED / TIMEOUT
  error?: string;
  resolvedAt?: number;
  latencySec?: number; // chain lastVoteTimestamp - createdTimestamp
  rounds?: number;
  votes?: VoteCounts;
  answer?: string;
  grade?: Grade;
  upheld?: boolean; // appeal records: answer unchanged and still correct
}

// Everything the old KV store held, in its own order: the tick counter, the
// pending hash, and the results list (oldest first).
export interface HeartbeatSnapshot {
  tick: number;
  pending: ProbeRecord[];
  results: ProbeRecord[];
}
