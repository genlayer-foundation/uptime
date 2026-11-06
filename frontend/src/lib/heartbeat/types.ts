import type { TestType } from "./probes";

export type { TestType };

// deploy  the canary, every tick                 (type deploy)
// write   bump(tick), every tick                 (type write)
// fetch   probe_status, F0, every tick           (type web)
// llm     probe(tick, id), 2 rotating per tick   (type llm | web | image)
// appeal  an appeal of a tick's first rotating probe, every 5th tick
export type ProbeKind = "deploy" | "write" | "fetch" | "llm" | "appeal";

// Graded ON-CHAIN by contracts/heartbeat.py; the runner only copies it.
export type Grade = "correct" | "wrong" | "injected";

// upheld      the appeal round kept the answer and grade (and the status)
// overturned  the status, answer or grade changed
// withdrawn   no new round was ever decided: the tx finalized (or 6h passed)
//             with no more rounds than before the appeal
export type AppealOutcome = "upheld" | "overturned" | "withdrawn";

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
  type: TestType; // appeals carry the appealed probe's type
  qid?: string; // probe id (f0-status, r1-extract, ...); absent for deploy and write
  txHash?: `0x${string}`;
  submittedAt: number; // unix seconds, wall clock
  // Set on the first rotating probe of every 5th tick: appeal it once decided.
  appealDue?: boolean;
  // Appeal records: the probe being appealed, and its state before.
  appealOf?: string;
  statusBefore?: string;
  answerBefore?: string;
  gradeBefore?: Grade;

  // Filled in by reconcile.
  status?: string; // final statusName, or SUBMIT_FAILED / TIMEOUT
  error?: string; // submit/read failure, or the contract's agreed error ([EXTERNAL] fixture drift, ...)
  resolvedAt?: number;
  latencySec?: number; // time to decision: chain lastVoteTimestamp - createdTimestamp
  acceptedAt?: number; // deploy only: when reconcile first saw it decided (kept while it waits to finalize)
  finalizedSec?: number; // deploy only: createdTimestamp -> first seen FINALIZED (reconcile-cadence resolution)
  address?: string; // deploy only: the canary this tick deployed
  rounds?: number;
  votes?: VoteCounts;
  answer?: string;
  grade?: Grade;
  outcome?: AppealOutcome; // appeals only
}
