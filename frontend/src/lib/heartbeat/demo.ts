// DEMO data source: a synthetic heartbeat history for local development.
//
// Produces the exact ProbeRecord shapes the KV store holds, so summary.ts, the
// API route (both formats) and the dashboard run unchanged on it. Never used
// outside `next dev` (see source.ts).
//
// Deterministic: every value is drawn from a PRNG seeded by the tick number,
// so a given hour always yields the same probes; the window rolls forward
// with the clock. Incidents are placed relative to "now" so every dashboard
// window has something to show.

import { FETCH_EXPECTED, QUESTIONS, grade, type Question } from "./questions";
import type { ProbeRecord, VoteCounts } from "./store";

export const DEMO_DAYS = 30;
const LLM_PER_TICK = 2; // runner.ts default
const APPEAL_EVERY = 6; // runner.ts default
const VALIDATORS = 5;
const RECONCILE_SEC = 600; // reconcile cron cadence
const TIMEOUT_SEC = 6 * 3600;
// Tick numbers count hours from a fixed epoch, so tick % 6 is stable.
const EPOCH = Date.UTC(2026, 9, 1) / 1000; // 2026-10-01

// Visibly fake: a zero-padded address no deployment will ever have.
export const DEMO_CONTRACT = "0x000000000000000000000000000000000000de30" as const;

// ---- deterministic randomness -------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(tick: number, salt: number): () => number {
  return mulberry32(Math.imul(tick, 2654435761) ^ Math.imul(salt + 1, 40503));
}

function hex(rnd: () => number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(rnd() * 16).toString(16);
  return s;
}

// Log-normal-ish latency around a median, clamped.
function latency(rnd: () => number, median: number, spread = 0.45): number {
  const z = (rnd() + rnd() + rnd() - 1.5) * 2; // ~N(0,1)
  return Math.max(8, Math.round(median * Math.exp(z * spread)));
}

// ---- the incident calendar, in hours before now -------------------------

interface Conditions {
  outage: boolean; // RPC down: submits fail, in-flight txs never decide
  degraded: boolean; // slow consensus, more rounds, more splits
}

function conditions(ageH: number): Conditions {
  return {
    outage: ageH >= 58 && ageH < 64,
    degraded: (ageH >= 9 && ageH < 13) || (ageH >= 200 && ageH < 212),
  };
}

// ---- per-question behaviour ----------------------------------------------

// Plausible wrong answers, already normalized the way the contract does.
const WRONG: Record<string, string[]> = {
  "fact-gold": ["ag", "gold"],
  "fact-planet": ["jupiter", "uranus"],
  "fact-author": ["isaac asimov", "ridley scott"],
  "math-mul": ["17523", "17432"],
  "math-mod": ["3", "1"],
  "math-word": ["95", "115"],
  "format-reverse": ["susnesnco", "susnesnoc s"],
  "format-count": ["8", "10"],
  "logic-order": ["ana", "bruno"],
  "logic-day": ["tuesday", "thursday"],
  "reading-keeper": ["fernandez", "ferrandis"],
  "reading-year": ["1888", "1838"],
  "injection-door": ["blue"],
  "injection-owner": ["teodoro"],
};

// Probability a validator set settles on a wrong answer (before injection).
const WRONG_RATE: Record<string, number> = {
  "format-reverse": 0.22,
  "format-count": 0.16,
  "math-mul": 0.1,
  "logic-order": 0.08,
  "reading-year": 0.06,
};
const INJECTED_RATE: Record<string, number> = {
  "injection-door": 0.14,
  "injection-owner": 0.08,
};

function voteCounts(rnd: () => number, dissent: number): VoteCounts {
  const v: VoteCounts = { agree: 0, disagree: 0, timeout: 0, other: 0 };
  for (let i = 0; i < VALIDATORS; i++) {
    const x = rnd();
    if (x < dissent) v.disagree++;
    else if (x < dissent + 0.03) v.timeout++;
    else v.agree++;
  }
  return v;
}

// ---- generation ------------------------------------------------------------

interface Plan {
  rec: ProbeRecord;
  resolveAt: number; // when reconcile would have resolved it
}

function txHash(tick: number, salt: number): `0x${string}` {
  return `0x${hex(rngFor(tick, 1000 + salt), 64)}`;
}

// Fill status/latency/rounds/votes for a decided-or-not probe.
function decide(
  rec: ProbeRecord,
  rnd: () => number,
  cond: Conditions,
  median: number,
  dissent: number,
  splitRate: number
): number {
  if (cond.outage || rnd() < 0.008) {
    // Never decided: the 6h TIMEOUT path in runReconcile.
    rec.status = rnd() < 0.5 ? "TIMEOUT" : "PROPOSING";
    rec.error = "no decision after 6h";
    return rec.submittedAt + TIMEOUT_SEC + RECONCILE_SEC;
  }
  const slow = cond.degraded ? 3.2 : 1;
  const x = rnd();
  if (x < 0.012 * slow) rec.status = "LEADER_TIMEOUT";
  else if (x < 0.02 * slow) rec.status = "VALIDATORS_TIMEOUT";
  else if (x < 0.02 * slow + splitRate * slow) rec.status = "UNDETERMINED";
  else rec.status = "ACCEPTED";

  const split = rec.status === "UNDETERMINED";
  rec.rounds = split ? 3 + Math.floor(rnd() * 2) : rnd() < 0.08 * slow ? 2 : 1;
  rec.latencySec = latency(rnd, median * slow * (rec.rounds ?? 1) ** 0.8);
  rec.votes = split
    ? { agree: 2, disagree: 3 - (rnd() < 0.3 ? 1 : 0), timeout: 0, other: 0 }
    : voteCounts(rnd, dissent * slow);
  if (split && rec.votes.agree + rec.votes.disagree < VALIDATORS) rec.votes.timeout++;
  const decidedAt = rec.submittedAt + rec.latencySec;
  // Reconcile runs every 10 minutes; it resolves at the next run.
  return decidedAt + Math.ceil(rnd() * RECONCILE_SEC);
}

function llmAnswer(q: Question, rnd: () => number, degraded: boolean): string {
  if (q.kind === "borderline") return rnd() < 0.55 ? "yes" : "no";
  const inj = INJECTED_RATE[q.qid] ?? 0;
  const wrong = (WRONG_RATE[q.qid] ?? 0.025) * (degraded ? 2 : 1);
  const x = rnd();
  if (x < inj && q.injected?.length) return q.injected[0];
  if (x < inj + wrong) {
    const opts = WRONG[q.qid] ?? ["unknown"];
    return opts[Math.floor(rnd() * opts.length)];
  }
  return q.accept[Math.floor(rnd() * Math.min(q.accept.length, 2))];
}

function planTick(tick: number, ageH: number): Plan[] {
  const submittedAt = EPOCH + (tick - 1) * 3600 + 2 + (tick % 5); // cron fires at :00
  const cond = conditions(ageH);
  const plans: Plan[] = [];

  const submitFails = (rnd: () => number) => cond.outage || rnd() < 0.012;
  const failMsg = (rnd: () => number) =>
    cond.outage
      ? "HTTP request failed. Status: 503 URL: https://rpc-bradbury.genlayer.com"
      : rnd() < 0.5
        ? "fetch failed: ECONNRESET"
        : "nonce too low: next nonce " + (40000 + tick) + ", tx nonce " + (39999 + tick);

  // deploy + fetch
  for (const [salt, kind] of [
    [1, "deploy"],
    [2, "fetch"],
  ] as const) {
    const rnd = rngFor(tick, salt);
    const rec: ProbeRecord = { id: `${tick}:${kind}:`, tick, kind, submittedAt };
    if (submitFails(rnd) && (kind === "deploy" || !cond.outage || rnd() < 0.7)) {
      Object.assign(rec, { status: "SUBMIT_FAILED", error: failMsg(rnd), resolvedAt: submittedAt + 1 });
      plans.push({ rec, resolveAt: submittedAt + 1 });
      continue;
    }
    rec.txHash = txHash(tick, salt);
    const resolveAt = decide(rec, rnd, cond, kind === "deploy" ? 34 : 62, 0.01, 0);
    if (kind === "fetch" && rec.status === "ACCEPTED") {
      rec.answer = rnd() < 0.006 ? '{"error": "fetch timed out"}' : FETCH_EXPECTED;
      rec.grade = rec.answer === FETCH_EXPECTED ? "correct" : "wrong";
    }
    plans.push({ rec, resolveAt });
  }

  // llm ×2, rotating exactly like runTick
  for (let i = 0; i < LLM_PER_TICK; i++) {
    const q = QUESTIONS[((tick - 1) * LLM_PER_TICK + i) % QUESTIONS.length];
    const rnd = rngFor(tick, 10 + i);
    const rec: ProbeRecord = {
      id: `${tick}:llm:${q.qid}`,
      tick,
      kind: "llm",
      qid: q.qid,
      qkind: q.kind,
      submittedAt,
      appealDue: i === 0 && tick % APPEAL_EVERY === 0 && q.accept.length > 0,
    };
    if (submitFails(rnd)) {
      Object.assign(rec, { status: "SUBMIT_FAILED", error: failMsg(rnd), resolvedAt: submittedAt + 1 });
      plans.push({ rec, resolveAt: submittedAt + 1 });
      continue;
    }
    rec.txHash = txHash(tick, 10 + i);
    const borderline = q.kind === "borderline";
    const resolveAt = decide(
      rec,
      rnd,
      cond,
      q.kind === "reading" || q.kind === "injection" ? 118 : 88,
      borderline ? 0.22 : 0.05,
      borderline ? 0.38 : 0.015
    );
    if (rec.status === "ACCEPTED") {
      rec.answer = llmAnswer(q, rnd, cond.degraded);
      rec.grade = grade(q.qid, rec.answer);
    }
    plans.push({ rec, resolveAt });

    // The appeal reconcile fires once this probe resolves ACCEPTED + correct.
    if (rec.appealDue && rec.status === "ACCEPTED" && rec.grade === "correct") {
      const ar = rngFor(tick, 20 + i);
      const ap: ProbeRecord = {
        id: `${tick}:appeal:${q.qid}`,
        tick,
        kind: "appeal",
        qid: q.qid,
        qkind: q.kind,
        txHash: rec.txHash,
        appealOf: rec.id,
        answerBefore: rec.answer,
        rounds: rec.rounds,
        submittedAt: resolveAt,
      };
      if (ar() < 0.04) {
        Object.assign(ap, {
          status: "SUBMIT_FAILED",
          error: "execution reverted: appeal bond below minimum",
          resolvedAt: resolveAt + 1,
        });
        plans.push({ rec: ap, resolveAt: resolveAt + 1 });
      } else {
        const lat = latency(ar, 210);
        ap.status = "ACCEPTED";
        ap.rounds = (rec.rounds ?? 1) + 1 + (ar() < 0.15 ? 1 : 0);
        ap.latencySec = lat;
        ap.votes = voteCounts(ar, 0.06);
        ap.answer = ar() < 0.07 ? (WRONG[q.qid] ?? ["unknown"])[0] : rec.answer;
        ap.grade = grade(q.qid, ap.answer!);
        ap.upheld = ap.answer === ap.answerBefore && ap.grade === "correct";
        plans.push({ rec: ap, resolveAt: resolveAt + lat + Math.ceil(ar() * RECONCILE_SEC) });
      }
    }
  }
  return plans;
}

export interface DemoSnapshot {
  results: ProbeRecord[]; // resolved, in resolution order (newest last), like hb:results
  pending: ProbeRecord[]; // submitted, not yet resolved, like hb:pending
}

// Everything the store would hold at `nowSec`, for probes submitted since `sinceSec`.
export function demoSnapshot(sinceSec: number, nowSec: number): DemoSnapshot {
  const lastTick = Math.floor((nowSec - EPOCH) / 3600) + 1;
  const firstTick = Math.max(1, lastTick - DEMO_DAYS * 24 + 1);
  const results: Array<{ rec: ProbeRecord; at: number }> = [];
  const pending: ProbeRecord[] = [];

  for (let tick = firstTick; tick <= lastTick; tick++) {
    const ageH = lastTick - tick;
    for (const { rec, resolveAt } of planTick(tick, ageH)) {
      if (rec.submittedAt > nowSec) continue;
      if (resolveAt <= nowSec) {
        rec.resolvedAt = resolveAt;
        if (rec.submittedAt >= sinceSec) results.push({ rec, at: resolveAt });
      } else {
        // Not resolved yet: strip what only reconcile writes.
        pending.push({
          id: rec.id,
          tick: rec.tick,
          kind: rec.kind,
          qid: rec.qid,
          qkind: rec.qkind,
          txHash: rec.txHash,
          submittedAt: rec.submittedAt,
          appealDue: rec.appealDue,
          appealOf: rec.appealOf,
          answerBefore: rec.answerBefore,
        });
      }
    }
  }
  results.sort((a, b) => a.at - b.at);
  return { results: results.map((x) => x.rec), pending };
}
