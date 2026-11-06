import type { TestType } from "./probes";
import type { ProbeKind, ProbeRecord } from "./types";

export interface Stat {
  total: number;
  submitFailed: number;
  accepted: number; // reached ACCEPTED, READY_TO_FINALIZE or FINALIZED
  undetermined: number; // decided without agreement
  timedOut: number; // LEADER/VALIDATORS timeout, CANCELED, or our 6h TIMEOUT
  graded: number; // carries an on-chain (or canary/bump) grade
  correct: number;
  wrong: number;
  injected: number;
  errored: number; // decided, but the contract stored an agreed error (fixture drift, 4xx, ...)
  upheld: number; // appeals only
  overturned: number; // appeals only
  withdrawn: number; // appeals only
  latencyP50?: number; // time to decision
  latencyP90?: number;
  finalizedP50?: number; // deploys only: time to FINALIZED
  finalizedP90?: number;
  agreement?: number; // AGREE votes / all votes cast, 0..1
  avgRounds?: number;
}

const OK = new Set(["ACCEPTED", "FINALIZED", "READY_TO_FINALIZE"]);

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
    wrong: 0,
    injected: 0,
    errored: 0,
    upheld: 0,
    overturned: 0,
    withdrawn: 0,
  };
  const lat: number[] = [];
  const fin: number[] = [];
  let agree = 0;
  let cast = 0;
  let rounds = 0;
  let roundsN = 0;
  for (const r of recs) {
    if (r.status === "SUBMIT_FAILED") s.submitFailed++;
    else if (OK.has(r.status ?? "")) s.accepted++;
    else if (r.status === "UNDETERMINED") s.undetermined++;
    else s.timedOut++;
    if (r.grade) s.graded++;
    if (r.grade === "correct") s.correct++;
    if (r.grade === "wrong") s.wrong++;
    if (r.grade === "injected") s.injected++;
    if (!r.grade && r.error && OK.has(r.status ?? "")) s.errored++;
    if (r.outcome === "upheld") s.upheld++;
    if (r.outcome === "overturned") s.overturned++;
    if (r.outcome === "withdrawn") s.withdrawn++;
    if (r.latencySec !== undefined) lat.push(r.latencySec);
    if (r.finalizedSec !== undefined) fin.push(r.finalizedSec);
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
  fin.sort((a, b) => a - b);
  s.latencyP50 = pct(lat, 0.5);
  s.latencyP90 = pct(lat, 0.9);
  s.finalizedP50 = pct(fin, 0.5);
  s.finalizedP90 = pct(fin, 0.9);
  if (cast > 0) s.agreement = agree / cast;
  if (roundsN > 0) s.avgRounds = rounds / roundsN;
  return s;
}

export const KINDS: ProbeKind[] = ["deploy", "write", "fetch", "llm", "appeal"];
export const TYPES: TestType[] = ["deploy", "write", "llm", "web", "image"];
export type SeriesKey = TestType | "appeal";

export function summarize(recs: ProbeRecord[], bucketSec = 3600) {
  const probes = recs.filter((r) => r.kind !== "appeal");
  const appeals = recs.filter((r) => r.kind === "appeal");
  const byKind = Object.fromEntries(KINDS.map((k) => [k, stat(recs.filter((r) => r.kind === k))])) as Record<ProbeKind, Stat>;
  // The five test types count probes only; appeals are their own figure.
  const byType = Object.fromEntries(TYPES.map((t) => [t, stat(probes.filter((r) => r.type === t))])) as Record<TestType, Stat>;
  const withQid = probes.filter((r) => r.qid);
  const byProbe = Object.fromEntries(
    [...new Set(withQid.map((r) => r.qid!))].map((q) => [q, stat(withQid.filter((r) => r.qid === q))])
  );
  const appealsByProbe = Object.fromEntries(
    [...new Set(appeals.map((r) => r.qid ?? ""))].map((q) => [q, stat(appeals.filter((r) => (r.qid ?? "") === q))])
  );

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
      ...(Object.fromEntries(TYPES.map((k) => [k, stat(rs.filter((r) => r.kind !== "appeal" && r.type === k))])) as Record<TestType, Stat>),
      appeal: stat(rs.filter((r) => r.kind === "appeal")),
    }));

  return { byKind, byType, byProbe, appeals: byKind.appeal, appealsByProbe, series };
}

// ---------------------------------------------------------------- runs
//
// One RUN is one tick: five actions (deploy, write, fetch, two rotating
// questions). Appeals are judged separately and never decide a run.
//
// A run's outcome keeps OUR failures apart from the NETWORK's:
//   passed   every action was sent and graded correct
//   failed   at least one sent action was not correct (wrong, injected,
//            no agreement, timed out, or an agreed error): a network result
//   missed   we failed to send at least one action (SUBMIT_FAILED), and none
//            of the sent ones failed: our side, not the network's
//   pending  some action is still waiting for validators
// Hourly slots with no run at all (the scheduler never fired) are counted
// as missed too, from the first run in the window up to the last due slot.

export type RunOutcome = "passed" | "failed" | "missed" | "pending";

export interface RunView {
  tick: number;
  submittedAt: number;
  outcome: RunOutcome;
  actions: number; // non-appeal records of this tick
  notCorrect: number; // sent actions that were not graded correct
  notSent: number; // SUBMIT_FAILED actions
}

export interface RunsSummary {
  runs: number; // ticks recorded in the window (resolved or pending)
  passed: number;
  failed: number;
  missed: number; // runs with an action we failed to send + slots that never ran
  missedSlots: number; // of which: hourly slots with no run at all
  pending: number;
  actionsGraded: number; // sent, decided actions
  actionsCorrect: number;
  lastRunAt: number | null; // newest submission, pending included
  lastCompleted: RunView | null; // newest run that is not pending
}

function actionOutcome(r: ProbeRecord): "correct" | "bad" | "notSent" | "pending" {
  if (r.status === "SUBMIT_FAILED") return "notSent";
  if (!r.status) return "pending";
  if (r.grade === "correct" && OK.has(r.status)) return "correct";
  return "bad";
}

export function runViews(results: ProbeRecord[], pending: ProbeRecord[] = []): RunView[] {
  const byTick = new Map<number, ProbeRecord[]>();
  for (const r of [...results, ...pending]) {
    if (r.kind === "appeal") continue;
    if (!byTick.has(r.tick)) byTick.set(r.tick, []);
    byTick.get(r.tick)!.push(r);
  }
  return [...byTick.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tick, rs]) => {
      const o = rs.map(actionOutcome);
      const notCorrect = o.filter((x) => x === "bad").length;
      const notSent = o.filter((x) => x === "notSent").length;
      const outcome: RunOutcome = o.includes("pending") ? "pending" : notCorrect > 0 ? "failed" : notSent > 0 ? "missed" : "passed";
      return { tick, submittedAt: Math.min(...rs.map((r) => r.submittedAt)), outcome, actions: rs.length, notCorrect, notSent };
    });
}

/** Hourly runs: how many due slots since the first run have no run at all. */
export function missedSlots(runs: RunView[], nowSec: number, everySec = 3600, graceSec = 15 * 60): number {
  if (runs.length === 0) return 0;
  const slot = (t: number) => Math.floor(t / everySec);
  const seen = new Set(runs.map((r) => slot(r.submittedAt)));
  const first = Math.min(...seen);
  const lastDue = slot(nowSec - graceSec);
  let n = 0;
  for (let s = first; s <= lastDue; s++) if (!seen.has(s)) n++;
  return n;
}

export function runsSummary(results: ProbeRecord[], pending: ProbeRecord[], nowSec: number): RunsSummary {
  const views = runViews(results, pending);
  const count = (o: RunOutcome) => views.filter((v) => v.outcome === o).length;
  const slots = missedSlots(views, nowSec);
  const sent = results.filter((r) => r.kind !== "appeal").map(actionOutcome);
  const all = [...results, ...pending];
  const completed = views.filter((v) => v.outcome !== "pending");
  return {
    runs: views.length,
    passed: count("passed"),
    failed: count("failed"),
    missed: count("missed") + slots,
    missedSlots: slots,
    pending: count("pending"),
    actionsGraded: sent.filter((x) => x === "correct" || x === "bad").length,
    actionsCorrect: sent.filter((x) => x === "correct").length,
    lastRunAt: all.length ? Math.max(...all.map((r) => r.submittedAt)) : null,
    lastCompleted: completed.at(-1) ?? null,
  };
}

/** The newest run, every action as recorded (pending ones too), plus its appeal if any. */
export function latestRun(results: ProbeRecord[], pending: ProbeRecord[]) {
  const all = [...results, ...pending];
  const ticks = all.filter((r) => r.kind !== "appeal").map((r) => r.tick);
  if (ticks.length === 0) return null;
  const tick = Math.max(...ticks);
  const order = (r: ProbeRecord) => ["deploy", "write", "fetch", "llm"].indexOf(r.kind);
  const actions = all.filter((r) => r.tick === tick && r.kind !== "appeal").sort((a, b) => order(a) - order(b));
  const appeals = all.filter((r) => r.kind === "appeal").sort((a, b) => a.tick - b.tick);
  return {
    tick,
    submittedAt: Math.min(...actions.map((r) => r.submittedAt)),
    actions,
    lastAppeal: appeals.at(-1) ?? null,
  };
}
