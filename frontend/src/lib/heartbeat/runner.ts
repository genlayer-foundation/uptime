// Two phases, both cheap enough for a 60s function:
//   tick       submit this hour's probes and return — never wait on consensus
//   reconcile  read back every pending tx; grade the decided ones; fire due
//              appeals on probes that just reached ACCEPTED
// Latency comes from the chain's own timestamps, so how often reconcile runs
// only bounds freshness, not measurement precision.

import {
  getContractAddress,
  getReadClient,
  getWriteClient,
} from "@/lib/genlayer/client";
import type { TransactionHash } from "genlayer-js/types";
import { CANARY_SOURCE } from "./canary";
import { FETCH_EXPECTED, QUESTIONS, grade } from "./questions";
import {
  addPending,
  getPending,
  nextTick,
  resolve,
  type ProbeRecord,
  type VoteCounts,
} from "./store";

const LLM_PER_TICK = Number(process.env.HEARTBEAT_LLM_PER_TICK || 2);
const APPEAL_EVERY = Number(process.env.HEARTBEAT_APPEAL_EVERY || 6);
const TIMEOUT_SEC = 6 * 3600;

// The ACCEPTED state is where we measure; FINALIZED comes after the appeal
// window and would make every latency an hour long.
const DECIDED = new Set([
  "ACCEPTED",
  "FINALIZED",
  "READY_TO_FINALIZE",
  "UNDETERMINED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
  "CANCELED",
]);

type Client = ReturnType<typeof getWriteClient>;
type Tx = Awaited<ReturnType<Client["getTransaction"]>>;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

function field(obj: unknown, key: string): unknown {
  if (obj instanceof Map) return obj.get(key);
  return (obj as Record<string, unknown> | null)?.[key];
}

function requireContract(): `0x${string}` {
  const address = getContractAddress();
  if (!address) throw new Error("HEARTBEAT_CONTRACT not configured");
  return address;
}

export async function runTick(): Promise<ProbeRecord[]> {
  const address = requireContract();
  const client = getWriteClient();
  const tick = await nextTick();
  const submittedAt = now();

  // Rotate through the question set: every question comes round every
  // QUESTIONS.length / LLM_PER_TICK ticks.
  const llm = Array.from({ length: LLM_PER_TICK }, (_, i) => {
    return QUESTIONS[((tick - 1) * LLM_PER_TICK + i) % QUESTIONS.length];
  });

  const plans: Array<{ rec: ProbeRecord; send: () => Promise<`0x${string}`> }> = [
    {
      rec: { id: `${tick}:deploy:`, tick, kind: "deploy", submittedAt },
      send: () =>
        client.deployContract({ code: CANARY_SOURCE, args: [BigInt(tick)] }),
    },
    {
      rec: { id: `${tick}:fetch:`, tick, kind: "fetch", submittedAt },
      send: () =>
        client.writeContract({
          address,
          functionName: "probe_fetch",
          args: [BigInt(tick)],
          value: 0n,
        }),
    },
    ...llm.map((q, i) => ({
      rec: {
        id: `${tick}:llm:${q.qid}`,
        tick,
        kind: "llm" as const,
        qid: q.qid,
        qkind: q.kind,
        submittedAt,
        // Only appeal a question with a right answer: the point is to see the
        // appeal keep it.
        appealDue: i === 0 && tick % APPEAL_EVERY === 0 && q.accept.length > 0,
      },
      send: () =>
        client.writeContract({
          address,
          functionName: "probe_llm",
          args: [BigInt(tick), q.qid],
          value: 0n,
        }),
    })),
  ];

  const out: ProbeRecord[] = [];
  for (const { rec, send } of plans) {
    try {
      rec.txHash = await send();
      await addPending(rec);
    } catch (e) {
      // A submit that never reached the chain is itself a measurement.
      Object.assign(rec, { status: "SUBMIT_FAILED", error: errMsg(e), resolvedAt: now() });
      await resolve(rec);
    }
    out.push(rec);
  }
  return out;
}

function votes(tx: Tx): VoteCounts | undefined {
  const names = tx.lastRound?.validatorVotesName;
  if (!names?.length) return undefined;
  const v: VoteCounts = { agree: 0, disagree: 0, timeout: 0, other: 0 };
  for (const n of names) {
    if (n === "AGREE") v.agree++;
    else if (n === "DISAGREE" || n === "DETERMINISTIC_VIOLATION") v.disagree++;
    else if (n === "TIMEOUT") v.timeout++;
    else v.other++;
  }
  return v;
}

function measure(rec: ProbeRecord, tx: Tx): void {
  rec.status = String(tx.statusName ?? tx.status ?? "");
  const created = Number(tx.createdTimestamp ?? 0);
  const lastVote = Number(tx.lastVoteTimestamp ?? 0);
  if (created > 0 && lastVote >= created) rec.latencySec = lastVote - created;
  rec.rounds = Number(tx.numOfRounds ?? 0) || undefined;
  rec.votes = votes(tx);
}

async function readAnswer(rec: ProbeRecord): Promise<string | undefined> {
  const qid = rec.kind === "fetch" ? "fetch" : rec.qid!;
  const probe = await getReadClient().readContract({
    address: requireContract(),
    functionName: "get_probe",
    args: [`${rec.tick}:${qid}`],
  });
  const answer = field(probe, "answer");
  return answer === undefined ? undefined : String(answer);
}

async function gradeProbe(rec: ProbeRecord): Promise<void> {
  if (rec.kind === "deploy") return;
  if (rec.status !== "ACCEPTED" && rec.status !== "FINALIZED") return;
  rec.answer = await readAnswer(rec);
  if (rec.answer === undefined) return;
  rec.grade =
    rec.kind === "fetch"
      ? rec.answer === FETCH_EXPECTED
        ? "correct"
        : "wrong"
      : grade(rec.qid!, rec.answer);
}

async function appeal(client: Client, rec: ProbeRecord): Promise<void> {
  const ap: ProbeRecord = {
    id: `${rec.tick}:appeal:${rec.qid}`,
    tick: rec.tick,
    kind: "appeal",
    qid: rec.qid,
    qkind: rec.qkind,
    txHash: rec.txHash,
    appealOf: rec.id,
    answerBefore: rec.answer,
    rounds: rec.rounds,
    submittedAt: now(),
  };
  try {
    const bond = await client.getMinAppealBond({ txId: rec.txHash! });
    await client.appealTransaction({ txId: rec.txHash!, value: bond });
    await addPending(ap);
  } catch (e) {
    Object.assign(ap, { status: "SUBMIT_FAILED", error: errMsg(e), resolvedAt: now() });
    await resolve(ap);
  }
}

export async function runReconcile(): Promise<{ resolved: number; pending: number }> {
  const client = getWriteClient();
  const pending = await getPending();
  let resolved = 0;

  for (const rec of pending) {
    let tx: Tx;
    try {
      tx = await client.getTransaction({ hash: rec.txHash! as TransactionHash });
    } catch (e) {
      rec.error = errMsg(e);
      tx = undefined as unknown as Tx;
    }
    const status = String(tx?.statusName ?? tx?.status ?? "");
    const roundsNow = Number(tx?.numOfRounds ?? 0);

    // An appeal is settled once the original tx is decided again with more
    // rounds than it had when we appealed.
    const settled =
      DECIDED.has(status) &&
      (rec.kind !== "appeal" || roundsNow > (rec.rounds ?? 0));

    if (!settled) {
      if (now() - rec.submittedAt > TIMEOUT_SEC) {
        Object.assign(rec, { status: status || "TIMEOUT", error: rec.error ?? "no decision after 6h", resolvedAt: now() });
        await resolve(rec);
        resolved++;
      }
      continue;
    }

    measure(rec, tx);
    rec.resolvedAt = now();
    try {
      if (rec.kind === "appeal") {
        rec.answer = await readAnswer(rec);
        rec.grade = rec.answer === undefined ? undefined : grade(rec.qid!, rec.answer);
        rec.upheld = rec.answer === rec.answerBefore && rec.grade === "correct";
      } else {
        await gradeProbe(rec);
      }
    } catch (e) {
      rec.error = errMsg(e);
    }
    await resolve(rec);
    resolved++;

    if (rec.appealDue && rec.status === "ACCEPTED" && rec.grade === "correct") {
      await appeal(client, rec);
    }
  }

  return { resolved, pending: pending.length - resolved };
}
