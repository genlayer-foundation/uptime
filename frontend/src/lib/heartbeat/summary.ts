import type { ProbeKind, ProbeRecord } from "./store";

export interface Stat {
  total: number;
  submitFailed: number;
  accepted: number; // reached ACCEPTED or FINALIZED
  undetermined: number; // decided without agreement
  timedOut: number; // LEADER/VALIDATORS timeout, CANCELED, or our 6h TIMEOUT
  graded: number;
  correct: number;
  injected: number;
  upheld: number; // appeals only
  latencyP50?: number;
  latencyP90?: number;
  agreement?: number; // AGREE votes / all votes cast, 0..1
  avgRounds?: number;
}

function pct(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function stat(recs: ProbeRecord[]): Stat {
  const s: Stat = {
    total: recs.length,
    submitFailed: 0,
    accepted: 0,
    undetermined: 0,
    timedOut: 0,
    graded: 0,
    correct: 0,
    injected: 0,
    upheld: 0,
  };
  const lat: number[] = [];
  let agree = 0;
  let cast = 0;
  let rounds = 0;
  let roundsN = 0;
  for (const r of recs) {
    if (r.status === "SUBMIT_FAILED") s.submitFailed++;
    else if (r.status === "ACCEPTED" || r.status === "FINALIZED") s.accepted++;
    else if (r.status === "UNDETERMINED") s.undetermined++;
    else s.timedOut++;
    if (r.grade && r.grade !== "ungraded") s.graded++;
    if (r.grade === "correct") s.correct++;
    if (r.grade === "injected") s.injected++;
    if (r.upheld) s.upheld++;
    if (r.latencySec !== undefined) lat.push(r.latencySec);
    if (r.votes) {
      agree += r.votes.agree;
      cast += r.votes.agree + r.votes.disagree + r.votes.timeout;
    }
    if (r.rounds) {
      rounds += r.rounds;
      roundsN++;
    }
  }
  lat.sort((a, b) => a - b);
  s.latencyP50 = pct(lat, 0.5);
  s.latencyP90 = pct(lat, 0.9);
  if (cast > 0) s.agreement = agree / cast;
  if (roundsN > 0) s.avgRounds = rounds / roundsN;
  return s;
}

const KINDS: ProbeKind[] = ["deploy", "fetch", "llm", "appeal"];

export function summarize(recs: ProbeRecord[], bucketSec = 3600) {
  const byKind = Object.fromEntries(
    KINDS.map((k) => [k, stat(recs.filter((r) => r.kind === k))])
  );

  const llm = recs.filter((r) => r.kind === "llm");
  const groupBy = (key: (r: ProbeRecord) => string) =>
    Object.fromEntries(
      [...new Set(llm.map(key))].map((k) => [k, stat(llm.filter((r) => key(r) === k))])
    );
  const byQuestionKind = groupBy((r) => r.qkind!);
  const byQuestion = groupBy((r) => r.qid!);

  // Time series, one bucket per tick-interval, keyed by submission time.
  const buckets = new Map<number, ProbeRecord[]>();
  for (const r of recs) {
    const b = Math.floor(r.submittedAt / bucketSec) * bucketSec;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(r);
  }
  const series = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, rs]) => ({
      t,
      ...Object.fromEntries(KINDS.map((k) => [k, stat(rs.filter((r) => r.kind === k))])),
    }));

  return { byKind, byQuestionKind, byQuestion, series };
}
