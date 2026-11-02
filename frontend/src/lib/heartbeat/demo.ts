// DEMO data source: a synthetic heartbeat history for local development.
//
// Produces the exact ProbeRecord shapes the runner writes (tickPlan + what
// reconcile fills in), so summary.ts, the API route (both formats) and the
// dashboard run unchanged on it. Never used outside `next dev` (source.ts).
//
// Deterministic: every value is drawn from a PRNG seeded by the tick number,
// so a given hour always yields the same probes; the window rolls forward
// with the clock. Incidents are placed relative to "now" so every dashboard
// window has something to show. Grades mimic what the contract stores; the
// image probes start out worse than the text ones, as expected on Bradbury
// while not every validator has a vision model.

import { appealOutcome, tickPlan, TIMEOUT_SEC } from "./runner";
import type { Grade, ProbeRecord, VoteCounts } from "./types";

export const DEMO_DAYS = 30;
const VALIDATORS = 5;
const RECONCILE_SEC = 600; // reconcile cron cadence
// Tick numbers count hours from a fixed epoch, so tick % 5 is stable.
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
  drift: boolean; // a fixture moved: the contract stores [EXTERNAL] fixture drift
}

function conditions(ageH: number): Conditions {
  return {
    outage: ageH >= 58 && ageH < 64,
    degraded: (ageH >= 9 && ageH < 13) || (ageH >= 200 && ageH < 212),
    drift: ageH >= 30 && ageH < 33,
  };
}

// ---- per-probe behaviour (answers as the contract stores them) -----------

interface Behaviour {
  correct: string;
  wrong: string[];
  wrongRate: number;
  injected?: string;
  injectedRate?: number;
  median: number; // seconds to decision
  dissent: number;
  split: number; // UNDETERMINED rate
  fixture?: string;
}

const BEHAVIOUR: Record<string, Behaviour> = {
  "f0-status": { correct: '{"answer": 42, "network": "bradbury"}', wrong: ['{"answer": 42, "network": "asimov"}'], wrongRate: 0.004, median: 58, dissent: 0.01, split: 0, fixture: "status.json" },
  "r1-extract": { correct: "42", wrong: ["42000", "10"], wrongRate: 0.05, median: 110, dissent: 0.05, split: 0.02, fixture: "primer.html" },
  "r2-answer42": { correct: "42", wrong: ["54"], wrongRate: 0.01, median: 80, dissent: 0.03, split: 0.01 },
  "r3-laws": { correct: '{"count": 3, "first_law": "A robot may not injure a human being or, through inaction, allow a human being to come to harm."}', wrong: ['{"count": 4, "first_law": "A robot may not harm humanity."}'], wrongRate: 0.06, median: 140, dissent: 0.08, split: 0.04 },
  "r4-rule": { correct: '{"follows": false, "rule": 2}', wrong: ['{"follows": false, "rule": 3}', '{"follows": true, "rule": 0}'], wrongRate: 0.1, median: 150, dissent: 0.1, split: 0.05, fixture: "mandate.html" },
  "r5-summary": { correct: "Validators recompute a leader's result and vote under the Equivalence Principle; anyone can appeal with a bond during the Finality Window, and each appeal round doubles the validators.", wrong: ["A leader proposes a result and the other nodes vote on it until a majority agrees."], wrongRate: 0.08, median: 160, dissent: 0.12, split: 0.04, fixture: "primer.html" },
  "r6-injection": { correct: "2", wrong: ["3"], wrongRate: 0.02, injected: "10", injectedRate: 0.1, median: 120, dissent: 0.06, split: 0.02, fixture: "appeals-note.html" },
  "r7-card": { correct: "7319", wrong: ["7316", "1319"], wrongRate: 0.08, median: 170, dissent: 0.18, split: 0.12, fixture: "card.png" },
  "r8-shot": { correct: "CONDORCET", wrong: ["CONDOR", "CONCORDET"], wrongRate: 0.1, median: 200, dissent: 0.22, split: 0.16, fixture: "shot.html" },
  "r9-namesake": { correct: "Fahrenheit 451", wrong: ["The Martian Chronicles"], wrongRate: 0.01, median: 130, dissent: 0.05, split: 0.02 },
};

// What the contract's drift error names per fixture (contracts/heartbeat.py).
const DRIFT: Record<string, string> = {
  "primer.html": "HB2-primer",
  "mandate.html": "HB2-mandate",
  "appeals-note.html": "HB2-appeals",
  "shot.html": "HB2-shot",
  "card.png": "sha256 8cb0b2d27884",
};

function gradeOf(b: Behaviour, answer: string): Grade {
  if (answer === b.correct) return "correct";
  return b.injected && answer === b.injected ? "injected" : "wrong";
}

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

// Fill status/latency/rounds/votes. Returns when the round was decided.
function decide(rec: ProbeRecord, rnd: () => number, cond: Conditions, median: number, dissent: number, splitRate: number): number | null {
  if (cond.outage || rnd() < 0.008) {
    rec.status = rnd() < 0.5 ? "TIMEOUT" : "PROPOSING";
    rec.error = "no decision after 6h";
    return null;
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
  rec.votes = split ? { agree: 2, disagree: 3, timeout: 0, other: 0 } : voteCounts(rnd, dissent * slow);
  return rec.submittedAt + rec.latencySec;
}

const nextReconcile = (t: number, rnd: () => number) => t + Math.ceil(rnd() * RECONCILE_SEC);

function failMsg(rnd: () => number, cond: Conditions, tick: number): string {
  if (cond.outage) return "HTTP request failed. Status: 503 URL: https://rpc-bradbury.genlayer.com";
  return rnd() < 0.5 ? "fetch failed: ECONNRESET" : `nonce too low: next nonce ${40000 + tick}, tx nonce ${39999 + tick}`;
}

function planTick(tick: number, ageH: number): Plan[] {
  const submittedAt = EPOCH + (tick - 1) * 3600 + 2 + (tick % 5); // cron fires at :00
  const cond = conditions(ageH);
  const plans: Plan[] = [];

  tickPlan(tick, submittedAt).forEach((rec, salt) => {
    const rnd = rngFor(tick, salt + 1);
    if (cond.outage || rnd() < 0.01) {
      Object.assign(rec, { status: "SUBMIT_FAILED", error: failMsg(rnd, cond, tick), resolvedAt: submittedAt + 1 });
      plans.push({ rec, resolveAt: submittedAt + 1 });
      return;
    }
    rec.txHash = txHash(tick, salt + 1);
    const b = rec.qid ? BEHAVIOUR[rec.qid] : undefined;
    const median = rec.kind === "deploy" ? 34 : rec.kind === "write" ? 30 : (b?.median ?? 90);
    const decidedAt = decide(rec, rnd, cond, median, b?.dissent ?? 0.01, b?.split ?? 0);
    if (decidedAt === null) {
      plans.push({ rec, resolveAt: submittedAt + TIMEOUT_SEC + RECONCILE_SEC });
      return;
    }
    let resolveAt = nextReconcile(decidedAt, rnd);
    if (rec.status === "ACCEPTED") {
      if (rec.kind === "deploy") {
        rec.answer = String(tick);
        rec.grade = "correct";
        rec.acceptedAt = resolveAt;
        // Bradbury's finality window, then the next reconcile run sees FINALIZED.
        const finalAt = nextReconcile(decidedAt + 1800 + Math.round(rnd() * 600), rnd);
        rec.status = "FINALIZED";
        rec.finalizedSec = finalAt - submittedAt;
        resolveAt = finalAt;
      } else if (rec.kind === "write") {
        rec.answer = String(tick);
        rec.grade = rnd() < 0.003 ? "wrong" : "correct";
      } else if (b) {
        if (cond.drift && b.fixture && DRIFT[b.fixture] && rnd() < 0.6) {
          rec.answer = "";
          rec.error = `[EXTERNAL] fixture drift: ${b.fixture} lacks ${DRIFT[b.fixture]}`;
        } else {
          const x = rnd();
          const wrong = b.wrongRate * (cond.degraded ? 2 : 1);
          rec.answer = b.injected && x < (b.injectedRate ?? 0) ? b.injected : x < (b.injectedRate ?? 0) + wrong ? b.wrong[Math.floor(rnd() * b.wrong.length)] : b.correct;
          rec.grade = gradeOf(b, rec.answer);
        }
      }
    }
    plans.push({ rec, resolveAt });

    // The appeal fires at the reconcile that resolves the probe.
    if (rec.appealDue && (rec.status === "ACCEPTED" || rec.status === "UNDETERMINED") && b) {
      const ar = rngFor(tick, 50);
      const ap: ProbeRecord = {
        id: `${tick}:appeal:${rec.qid}`,
        tick,
        kind: "appeal",
        type: rec.type,
        qid: rec.qid,
        txHash: rec.txHash,
        appealOf: rec.id,
        statusBefore: rec.status,
        ...(rec.answer !== undefined ? { answerBefore: rec.answer } : {}),
        ...(rec.grade ? { gradeBefore: rec.grade } : {}),
        rounds: rec.rounds,
        submittedAt: resolveAt,
      };
      const y = ar();
      if (y < 0.04) {
        Object.assign(ap, { status: "SUBMIT_FAILED", error: "execution reverted: appeal bond below minimum", resolvedAt: resolveAt + 1 });
        plans.push({ rec: ap, resolveAt: resolveAt + 1 });
      } else if (y < 0.1) {
        Object.assign(ap, { status: "FINALIZED", outcome: "withdrawn" });
        plans.push({ rec: ap, resolveAt: resolveAt + 2400 });
      } else {
        const lat = latency(ar, 240);
        ap.status = rec.status === "UNDETERMINED" && ar() < 0.5 ? "UNDETERMINED" : "ACCEPTED";
        ap.rounds = (rec.rounds ?? 1) + 1;
        ap.latencySec = lat;
        ap.votes = voteCounts(ar, 0.06);
        if (ap.status === "ACCEPTED") {
          ap.answer = ar() < 0.9 && rec.answer ? rec.answer : b.correct;
          ap.grade = gradeOf(b, ap.answer);
        }
        ap.outcome = appealOutcome(ap);
        plans.push({ rec: ap, resolveAt: nextReconcile(resolveAt + lat, ar) });
      }
    }
  });
  return plans;
}

export interface DemoSnapshot {
  results: ProbeRecord[]; // resolved, in resolution order (newest last)
  pending: ProbeRecord[]; // submitted, not yet resolved
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
        // Not resolved yet: keep only what tick (and an ACCEPTED-but-not-final deploy) wrote.
        const p: ProbeRecord = {
          id: rec.id,
          tick: rec.tick,
          kind: rec.kind,
          type: rec.type,
          ...(rec.qid ? { qid: rec.qid } : {}),
          ...(rec.txHash ? { txHash: rec.txHash } : {}),
          submittedAt: rec.submittedAt,
          ...(rec.appealDue ? { appealDue: true } : {}),
          ...(rec.appealOf ? { appealOf: rec.appealOf, statusBefore: rec.statusBefore, rounds: rec.rounds } : {}),
        };
        pending.push(p);
      }
    }
  }
  results.sort((a, b) => a.at - b.at);
  return { results: results.map((x) => x.rec), pending };
}
