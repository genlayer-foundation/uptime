// Two phases, both cheap enough for a 60s function:
//   tick       submit this hour's probes and return — never wait on consensus
//   reconcile  read back every pending tx; copy the decided ones' ON-CHAIN
//              grades; fire due appeals; keep canary deploys pending until
//              FINALIZED so both of their times are recorded
// Latency comes from the chain's own timestamps, so how often reconcile runs
// only bounds freshness. The one exception is time to FINALIZED: the chain
// exposes no finalization timestamp, so it is measured when reconcile first
// sees FINALIZED (resolution = the reconcile cadence, 10 min).
//
// Every tick: canary deploy, bump(tick), probe_status(tick) (F0), and 2 of
// the 9 rotating probes (probes.ts rotation). Every 5th tick the first
// rotating probe is appealed once decided, whatever its status.

import {
  getContractAddress,
  getReadClient,
  getWriteClient,
} from "@/lib/genlayer/client";
import type { TransactionHash } from "genlayer-js/types";
import { CANARY_SOURCE } from "./canary";
import { appealDue, rotation } from "./probes";
import * as store from "./store";
import type { AppealOutcome, Grade, ProbeRecord, VoteCounts } from "./types";

export const TIMEOUT_SEC = 6 * 3600;

// Decided: a round is over. ACCEPTED is where time to decision is measured;
// FINALIZED comes after the appeal window.
const DECIDED = new Set([
  "ACCEPTED",
  "FINALIZED",
  "READY_TO_FINALIZE",
  "UNDETERMINED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
  "CANCELED",
]);
const OK = new Set(["ACCEPTED", "FINALIZED", "READY_TO_FINALIZE"]);
const APPEALABLE = new Set(["ACCEPTED", "UNDETERMINED"]);

// The slice of genlayer-js the runner uses (fakeable in tests).
export interface RunnerTx {
  statusName?: string;
  status?: string | number;
  createdTimestamp?: string | number | bigint;
  lastVoteTimestamp?: string | number | bigint;
  numOfRounds?: string | number | bigint;
  recipient?: string;
  to_address?: string;
  txDataDecoded?: { contractAddress?: string };
  lastRound?: { validatorVotesName?: string[] };
}

export interface RunnerClient {
  deployContract(a: { code: string; args: unknown[] }): Promise<`0x${string}`>;
  writeContract(a: { address: `0x${string}`; functionName: string; args: unknown[]; value: bigint }): Promise<`0x${string}`>;
  readContract(a: { address: `0x${string}`; functionName: string; args: unknown[] }): Promise<unknown>;
  getTransaction(a: { hash: TransactionHash }): Promise<RunnerTx>;
  getMinAppealBond(a: { txId: `0x${string}` }): Promise<bigint>;
  appealTransaction(a: { txId: `0x${string}`; value: bigint }): Promise<unknown>;
}

export interface RunnerStore {
  nextTick(): Promise<number>;
  addPending(rec: ProbeRecord): Promise<void>;
  getPending(): Promise<ProbeRecord[]>;
  resolve(rec: ProbeRecord): Promise<void>;
}

export interface RunnerDeps {
  contract: `0x${string}`;
  client: () => RunnerClient; // signs: the tick's txs and appeals
  reader: () => RunnerClient; // view calls only
  store: RunnerStore;
  now: () => number;
}

function defaultDeps(): RunnerDeps {
  const contract = getContractAddress();
  if (!contract) throw new Error("HEARTBEAT_CONTRACT not configured");
  return {
    contract,
    client: () => getWriteClient() as unknown as RunnerClient,
    reader: () => getReadClient() as unknown as RunnerClient,
    store,
    now: () => Math.floor(Date.now() / 1000),
  };
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

function field(obj: unknown, key: string): unknown {
  if (obj instanceof Map) return obj.get(key);
  return (obj as Record<string, unknown> | null)?.[key];
}

// The five records one tick submits, in submission order.
export function tickPlan(tick: number, submittedAt: number): ProbeRecord[] {
  const base = { tick, submittedAt };
  return [
    { ...base, id: `${tick}:deploy:`, kind: "deploy", type: "deploy" },
    { ...base, id: `${tick}:write:`, kind: "write", type: "write" },
    { ...base, id: `${tick}:fetch:f0-status`, kind: "fetch", type: "web", qid: "f0-status" },
    ...rotation(tick).map(
      (p, i): ProbeRecord => ({
        ...base,
        id: `${tick}:llm:${p.id}`,
        kind: "llm",
        type: p.type,
        qid: p.id,
        ...(appealDue(tick, i) ? { appealDue: true } : {}),
      })
    ),
  ];
}

function send(client: RunnerClient, contract: `0x${string}`, rec: ProbeRecord): Promise<`0x${string}`> {
  const tick = BigInt(rec.tick);
  switch (rec.kind) {
    case "deploy":
      return client.deployContract({ code: CANARY_SOURCE, args: [tick] });
    case "write":
      return client.writeContract({ address: contract, functionName: "bump", args: [tick], value: 0n });
    case "fetch":
      return client.writeContract({ address: contract, functionName: "probe_status", args: [tick], value: 0n });
    default:
      return client.writeContract({ address: contract, functionName: "probe", args: [tick, rec.qid!], value: 0n });
  }
}

export async function runTick(deps: RunnerDeps = defaultDeps()): Promise<ProbeRecord[]> {
  const client = deps.client();
  const tick = await deps.store.nextTick();
  const out = tickPlan(tick, deps.now());
  for (const rec of out) {
    try {
      rec.txHash = await send(client, deps.contract, rec);
      await deps.store.addPending(rec);
    } catch (e) {
      // A submit that never reached the chain is itself a measurement.
      Object.assign(rec, { status: "SUBMIT_FAILED", error: errMsg(e), resolvedAt: deps.now() });
      await deps.store.resolve(rec);
    }
  }
  return out;
}

const AGREE_VOTES = new Set(["AGREE", "FINISHED_WITH_RETURN", "FINISHED_WITH_ERROR"]);
const DISAGREE_VOTES = new Set(["DISAGREE", "NONDET_DISAGREE", "DETERMINISTIC_VIOLATION"]);

function votes(tx: RunnerTx): VoteCounts | undefined {
  const names = tx.lastRound?.validatorVotesName;
  if (!names?.length) return undefined;
  const v: VoteCounts = { agree: 0, disagree: 0, timeout: 0, other: 0 };
  for (const n of names) {
    // Phase 2 names a vote by the result the validator agreed to
    // (FINISHED_WITH_RETURN/ERROR); a mismatch is NONDET_DISAGREE or
    // DETERMINISTIC_VIOLATION. AGREE/DISAGREE are the pre-Phase 2 names.
    if (AGREE_VOTES.has(n)) v.agree++;
    else if (DISAGREE_VOTES.has(n)) v.disagree++;
    else if (n === "TIMEOUT") v.timeout++;
    else v.other++;
  }
  return v;
}

function statusOf(tx: RunnerTx | undefined): string {
  return String(tx?.statusName ?? tx?.status ?? "");
}

function measure(rec: ProbeRecord, tx: RunnerTx): void {
  rec.status = statusOf(tx);
  const created = Number(tx.createdTimestamp ?? 0);
  const lastVote = Number(tx.lastVoteTimestamp ?? 0);
  if (created > 0 && lastVote >= created) rec.latencySec = lastVote - created;
  rec.rounds = Number(tx.numOfRounds ?? 0) || undefined;
  rec.votes = votes(tx);
}

function deployedAddress(tx: RunnerTx): `0x${string}` | null {
  const a = tx.txDataDecoded?.contractAddress ?? tx.recipient ?? tx.to_address;
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as `0x${string}`) : null;
}

const GRADES = new Set<string>(["correct", "wrong", "injected"]);

// The contract's own record of a probe: answer, on-chain grade, agreed error.
async function readProbe(deps: RunnerDeps, rec: ProbeRecord): Promise<void> {
  const p = await deps.reader().readContract({
    address: deps.contract,
    functionName: "get_probe",
    args: [`${rec.tick}:${rec.qid}`],
  });
  const answer = field(p, "answer");
  if (answer === undefined) return; // nothing stored: the tx's state was not applied
  rec.answer = String(answer);
  const grade = String(field(p, "grade") ?? "");
  const error = String(field(p, "error") ?? "");
  if (GRADES.has(grade)) rec.grade = grade as Grade;
  else delete rec.grade;
  if (error) rec.error = error;
}

// WRITE: bump(tick) landed if the contract's last tick is ours, or a later
// bump has landed since and the per-tick index shows ours.
async function gradeWrite(deps: RunnerDeps, rec: ProbeRecord): Promise<void> {
  const r = deps.reader();
  const last = Number(await r.readContract({ address: deps.contract, functionName: "get_last_tick", args: [] }));
  rec.answer = String(last);
  if (last === rec.tick) rec.grade = "correct";
  else if (last > rec.tick) {
    const n = Number(await r.readContract({ address: deps.contract, functionName: "get_bump", args: [BigInt(rec.tick)] }));
    rec.grade = n > 0 ? "correct" : "wrong";
  } else rec.grade = "wrong";
}

// DEPLOY: the canary must hold the tick it was deployed with.
async function gradeDeploy(deps: RunnerDeps, rec: ProbeRecord, tx: RunnerTx): Promise<void> {
  const address = deployedAddress(tx);
  if (!address) {
    rec.error = "canary address not found in the deploy tx";
    return;
  }
  const t = Number(await deps.reader().readContract({ address, functionName: "get_tick", args: [] }));
  rec.answer = String(t);
  rec.grade = t === rec.tick ? "correct" : "wrong";
}

async function grade(deps: RunnerDeps, rec: ProbeRecord, tx: RunnerTx): Promise<void> {
  const ok = OK.has(rec.status ?? "");
  try {
    if (rec.kind === "deploy") {
      if (ok) await gradeDeploy(deps, rec, tx);
    } else if (rec.kind === "write") {
      if (ok) await gradeWrite(deps, rec);
    } else if (ok || rec.status === "UNDETERMINED") {
      await readProbe(deps, rec);
    }
  } catch (e) {
    rec.error = errMsg(e);
  }
}

async function appeal(deps: RunnerDeps, client: RunnerClient, rec: ProbeRecord): Promise<void> {
  const ap: ProbeRecord = {
    id: `${rec.tick}:appeal:${rec.qid}`,
    tick: rec.tick,
    kind: "appeal",
    type: rec.type,
    qid: rec.qid,
    txHash: rec.txHash,
    appealOf: rec.id,
    statusBefore: rec.status,
    ...(rec.answer !== undefined ? { answerBefore: rec.answer } : {}),
    ...(rec.grade ? { gradeBefore: rec.grade } : {}),
    rounds: rec.rounds,
    submittedAt: deps.now(),
  };
  try {
    const bond = await client.getMinAppealBond({ txId: rec.txHash! });
    await client.appealTransaction({ txId: rec.txHash!, value: bond });
    await deps.store.addPending(ap);
  } catch (e) {
    Object.assign(ap, { status: "SUBMIT_FAILED", error: errMsg(e), resolvedAt: deps.now() });
    await deps.store.resolve(ap);
  }
}

// Upheld: the new round kept the status class, the answer and the grade.
export function appealOutcome(ap: ProbeRecord): AppealOutcome {
  if (OK.has(ap.statusBefore ?? "") !== OK.has(ap.status ?? "")) return "overturned";
  if (ap.answer !== ap.answerBefore || ap.grade !== ap.gradeBefore) return "overturned";
  return "upheld";
}

export async function runReconcile(deps: RunnerDeps = defaultDeps()): Promise<{ resolved: number; pending: number }> {
  const client = deps.client();
  const pending = await deps.store.getPending();
  let resolved = 0;
  const done = async (rec: ProbeRecord) => {
    rec.resolvedAt = deps.now();
    await deps.store.resolve(rec);
    resolved++;
  };

  for (const rec of pending) {
    let tx: RunnerTx | undefined;
    try {
      tx = await client.getTransaction({ hash: rec.txHash! as TransactionHash });
    } catch (e) {
      rec.error = errMsg(e);
    }
    const status = statusOf(tx);
    const expired = deps.now() - rec.submittedAt > TIMEOUT_SEC;

    if (rec.kind === "appeal") {
      // Settled once the tx is decided again with more rounds than before.
      const before = rec.rounds ?? 0;
      if (tx && DECIDED.has(status) && Number(tx.numOfRounds ?? 0) > before) {
        measure(rec, tx);
        await grade(deps, rec, tx);
        rec.outcome = appealOutcome(rec);
        await done(rec);
      } else if (status === "FINALIZED" || expired) {
        rec.status = status || "TIMEOUT";
        rec.outcome = "withdrawn";
        if (status !== "FINALIZED") rec.error = rec.error ?? "no appeal round decided after 6h";
        await done(rec);
      }
      continue;
    }

    if (!tx || !DECIDED.has(status)) {
      if (expired) {
        if (rec.kind === "deploy" && rec.acceptedAt !== undefined) rec.error = "not finalized after 6h";
        else Object.assign(rec, { status: status || "TIMEOUT", error: rec.error ?? "no decision after 6h" });
        await done(rec);
      }
      continue;
    }

    if (rec.kind === "deploy") {
      // Time to decision at the first decided read; then wait for FINALIZED.
      if (rec.acceptedAt === undefined) {
        measure(rec, tx);
        rec.acceptedAt = deps.now();
        await grade(deps, rec, tx);
      }
      if (status === "FINALIZED") {
        rec.status = status;
        const created = Number(tx.createdTimestamp ?? 0) || rec.submittedAt;
        rec.finalizedSec = Math.max(0, deps.now() - created);
        await done(rec);
      } else if (OK.has(status) && !expired) {
        await deps.store.addPending(rec); // keeps the ACCEPTED measurement
      } else {
        // UNDETERMINED, timeouts, CANCELED: nothing to wait for.
        if (OK.has(status)) rec.error = "not finalized after 6h";
        await done(rec);
      }
      continue;
    }

    measure(rec, tx);
    await grade(deps, rec, tx);
    await done(rec);

    if (rec.appealDue && APPEALABLE.has(rec.status ?? "")) await appeal(deps, client, rec);
  }

  return { resolved, pending: pending.length - resolved };
}
