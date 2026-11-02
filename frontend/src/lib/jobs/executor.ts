// The generic scheduler/executor, in the Heartbeat's two-phase shape:
//   dispatch   find due schedule groups, gate them, start a run: execute
//              reads at once, SUBMIT the first write/deploy, return. Never
//              waits on consensus (60 s function limit).
//   reconcile  read back every pending tx; measure decided ones from chain
//              timestamps; when a step succeeds, start the run's next step.
// A run's steps execute in order, so a later step can use what an earlier
// one produced ("$deploy.address"). Both phases are bounded by a time
// budget; leftovers are picked up next call (due stays due, PENDING stays).

import { formatEther } from "viem";
import type { ChainClient, ChainTx } from "./chain";
import { runGate, type GateDeps } from "./gate";
import { toJob, type JobRow, type RunRow, type StepRunRow } from "./internal";
import { newId, poolIdFor } from "./ids";
import { dueSlot, initialSchedule, toSpec } from "./schedule";
import type { Repo } from "./repo";
import { expand, groupsOf, jsonSafe, MissingDeploy, OK_STATUSES, runPass, stepStatus, toCalldata, type Group } from "./spec";
import type { Job, Network, Run, Step, StepRun } from "./types";

export const RUN_TIMEOUT_SEC = 6 * 3600;
const HEARTBEAT = "heartbeat";

export interface ExecutorDeps {
  repo: Repo;
  gate: GateDeps;
  clientFor: (n: Network) => ChainClient;
  relayerFor: (n: Network) => string;
  nowSec: () => number;
  // Deploy presets, by name (deploy steps with `preset` instead of `code`).
  deployPresets: Record<string, string>;
  // Bradbury Heartbeat example job: submit one tick through the existing
  // runner, which grades it in its own KV store (public dashboard unchanged).
  heartbeatTick?: () => Promise<{ tick: number; probes: { kind: string; qid?: string; txHash?: string; status?: string; error?: string }[] }>;
  // Bradbury pass-through cost per tx, in wei (0 = free).
  runCostWei?: () => bigint;
  // Called once a run finishes with pass === false (email alerts). Must not throw.
  onRunFailed?: (job: Job, run: Run, consecutiveFailures: number) => Promise<void>;
  budgetMs?: number;
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export interface DispatchReport {
  due: number;
  started: number;
  skipped: number;
  missedSlots: number;
  details: { jobId: string; group: string; slot: number; outcome: string; reason?: string }[];
}

export async function dispatchDue(deps: ExecutorDeps, limit = 100): Promise<DispatchReport> {
  const t0 = Date.now();
  const budget = deps.budgetMs ?? 40_000;
  const { repo } = deps;
  const items = await repo.dueSchedules(deps.nowSec(), limit);
  const rep: DispatchReport = { due: items.length, started: 0, skipped: 0, missedSlots: 0, details: [] };

  for (const { job, schedule } of items) {
    if (Date.now() - t0 > budget) break;
    const ds = dueSlot(schedule, deps.nowSec());
    if (!ds) continue;
    if (!(await repo.claimSlot(job.id, schedule.action, schedule.nextDueAt, ds.slot, ds.next))) continue;
    rep.missedSlots += ds.missed;
    const note = (outcome: string, reason?: string) =>
      rep.details.push({ jobId: job.id, group: schedule.action, slot: ds.slot, outcome, reason });

    const group = groupsOf(job).find((g) => g.key === schedule.action);
    if (!group) {
      note("skipped", "schedule group no longer exists");
      continue;
    }

    // The gate runs on EVERY run, not only at create: a wallet removed from the
    // Studio allowlist, a drained or paused pool, a foreign pool owner — all
    // stop the job at its very next slot.
    const gate = await runGate(job, deps.gate);
    if (!gate.ok) {
      await repo.createRun({ id: newId(), jobId: job.id, group: group.key, scheduledFor: ds.slot, state: "SKIPPED", error: gate.reason });
      if (gate.fatal) await repo.updateJob(job.id, { state: gate.state ?? "errored", stateReason: gate.reason });
      rep.skipped++;
      note("skipped", gate.reason);
      continue;
    }

    if (job.system && job.preset === HEARTBEAT) {
      await dispatchHeartbeat(deps, job, group, ds.slot);
      rep.started++;
      note("started");
      continue;
    }

    const run = await repo.createRun({ id: newId(), jobId: job.id, group: group.key, scheduledFor: ds.slot, state: "RUNNING" });
    if (!run) continue; // already dispatched (overlapping dispatcher)
    rep.started++;
    note("started");
    await advance(deps, job, group, run);
  }
  return rep;
}

// ---------------------------------------------------------------------------

function ctxFor(deps: ExecutorDeps, job: JobRow, group: Group, run: RunRow) {
  return {
    jobId: job.id,
    runId: `${group.key}:${run.scheduledFor}`,
    slot: run.scheduledFor,
    relayer: deps.relayerFor(job.network),
  };
}

async function resolveDeployed(deps: ExecutorDeps, job: JobRow, group: Group, run: RunRow, refs: string[]) {
  const map = new Map<string, string>();
  for (const id of refs) {
    const i = group.steps.findIndex((s) => s.id === id);
    const mine = i >= 0 ? run.steps.find((s) => s.idx === i) : undefined;
    const addr = (mine?.result as { address?: string } | undefined)?.address ?? (await deps.repo.lastDeployAddress(job.id, id));
    if (addr) map.set(id, addr);
  }
  return map;
}

function refsOf(step: Step): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const m = /^\$([A-Za-z0-9][A-Za-z0-9_-]{0,31})\.address$/.exec(v);
      if (m) out.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk("contract" in step ? step.contract : undefined);
  walk(step.args);
  return [...out];
}

function txHashOf(v: unknown): `0x${string}` {
  if (typeof v === "string" && v.startsWith("0x")) return v as `0x${string}`;
  throw new Error("node returned no transaction hash");
}

async function finish(deps: ExecutorDeps, job: JobRow, run: RunRow, error: string | null = null) {
  const pass = runPass(run.steps, job.assertions, true);
  await deps.repo.updateRun(run.id, { state: "DONE", pass, error });
  if (pass === false) await alertFailure(deps, job, run.id);
}

async function alertFailure(deps: ExecutorDeps, job: JobRow, runId: string) {
  if (!deps.onRunFailed) return;
  try {
    const run = await deps.repo.getRun(runId);
    if (!run) return;
    await deps.onRunFailed(toJob(job), toPublicRun(run), await deps.repo.consecutiveFailures(job.id));
  } catch {
    // alerts never break the scheduler
  }
}

// Execute the run's steps from its cursor until one has to wait on consensus.
export async function advance(deps: ExecutorDeps, job: JobRow, group: Group, run: RunRow): Promise<void> {
  const client = deps.clientFor(job.network);
  const now = deps.nowSec;
  for (let i = run.cursor; i < group.steps.length; i++) {
    const step = group.steps[i];
    const sr: StepRunRow = { idx: i, stepId: step.id, kind: step.kind, status: "PENDING", submittedAt: now(), resolvedAt: null };
    let call: { address?: `0x${string}`; args: unknown[] };
    try {
      const deployed = await resolveDeployed(deps, job, group, run, refsOf(step));
      const c = { ...ctxFor(deps, job, group, run), deployed: (id: string) => deployed.get(id) };
      call = {
        address: "contract" in step ? (expand(step.contract, c) as `0x${string}`) : undefined,
        args: toCalldata(expand(step.args, c)) as unknown[],
      };
    } catch (e) {
      Object.assign(sr, { status: "ERROR", error: errMsg(e), resolvedAt: now() });
      if (!(e instanceof MissingDeploy)) sr.error = `bad arguments: ${sr.error}`;
      return saveAndFinish(deps, job, run, sr);
    }

    if (step.kind === "read") {
      const t = Date.now();
      try {
        const v = await client.readContract({ address: call.address!, functionName: step.method, args: call.args });
        Object.assign(sr, { status: "ACCEPTED", result: jsonSafe(v), timeToAcceptedMs: Date.now() - t, resolvedAt: now() });
      } catch (e) {
        Object.assign(sr, { status: "ERROR", error: errMsg(e), resolvedAt: now() });
        return saveAndFinish(deps, job, run, sr);
      }
      await deps.repo.saveStepRun(run.id, sr);
      run.steps.push(sr);
      continue;
    }

    try {
      if (step.kind === "deploy") {
        const code = step.code ?? deps.deployPresets[step.preset ?? ""];
        if (!code) throw new Error(`unknown deploy preset "${step.preset}"`);
        sr.txHash = await client.deployContract({ code, args: call.args });
      } else {
        sr.txHash = txHashOf(
          await client.writeContract({
            address: call.address!,
            functionName: step.method,
            args: call.args,
            value: BigInt(step.value ?? "0"),
          })
        );
      }
    } catch (e) {
      // A submit that never reached the chain is itself a measurement.
      Object.assign(sr, { status: "SUBMIT_FAILED", error: errMsg(e), resolvedAt: now() });
      return saveAndFinish(deps, job, run, sr);
    }
    await deps.repo.saveStepRun(run.id, sr);
    await deps.repo.updateRun(run.id, { cursor: i });
    return; // wait for consensus; reconcile continues from here
  }
  await finish(deps, job, run);
}

async function saveAndFinish(deps: ExecutorDeps, job: JobRow, run: RunRow, sr: StepRunRow) {
  await deps.repo.saveStepRun(run.id, sr);
  run.steps.push(sr);
  await finish(deps, job, run, sr.error ?? null);
}

// ---------------------------------------------------------------------------

function votes(tx: ChainTx): StepRunRow["votes"] {
  const names = tx.lastRound?.validatorVotesName;
  if (!names?.length) return undefined;
  const v = { agree: 0, disagree: 0, timeout: 0, other: 0 };
  for (const n of names) {
    if (n === "AGREE") v.agree++;
    else if (n === "DISAGREE" || n === "DETERMINISTIC_VIOLATION") v.disagree++;
    else if (n === "TIMEOUT") v.timeout++;
    else v.other++;
  }
  return v;
}

function deployedAddress(tx: ChainTx): string | null {
  const a = tx.txDataDecoded?.contractAddress ?? tx.recipient ?? tx.to_address;
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null;
}

// Fill a step run from a decided tx. Returns false while undecided.
function measure(sr: StepRunRow, tx: ChainTx, costWei: bigint): boolean {
  const chain = String(tx.statusName ?? tx.status ?? "");
  const status = stepStatus(chain);
  if (!status) return false;
  sr.status = status;
  sr.chainStatus = chain;
  sr.resolvedAt = Math.floor(Date.now() / 1000);
  const created = Number(tx.createdTimestamp ?? 0);
  const lastVote = Number(tx.lastVoteTimestamp ?? 0);
  if (OK_STATUSES.has(status) && created > 0 && lastVote >= created) sr.timeToAcceptedMs = (lastVote - created) * 1000;
  sr.rounds = Number(tx.numOfRounds ?? 0) || undefined;
  sr.votes = votes(tx);
  if (costWei > BigInt(0)) sr.gasWei = costWei.toString();
  const execution = tx.txExecutionResultName ?? null;
  if (OK_STATUSES.has(status) && execution === "FINISHED_WITH_ERROR") sr.error = "contract execution raised an error";
  if (sr.kind === "deploy") {
    const address = deployedAddress(tx);
    sr.result = { address, execution };
  } else if (sr.kind === "write") {
    // The return value of a write is not reliably exposed by the node's tx
    // view; record the execution outcome, and use a read step for values.
    sr.result = { execution };
  }
  return true;
}

export interface ReconcileReport {
  checked: number;
  decided: number;
  finished: number;
  pending: number;
}

export async function reconcile(deps: ExecutorDeps, limit = 200): Promise<ReconcileReport> {
  const t0 = Date.now();
  const budget = deps.budgetMs ?? 40_000;
  const { repo } = deps;
  const runs = await repo.runningRuns(limit);
  const jobs = new Map<string, JobRow | null>();
  const rep: ReconcileReport = { checked: 0, decided: 0, finished: 0, pending: 0 };

  for (const run of runs) {
    if (Date.now() - t0 > budget) break;
    if (!jobs.has(run.jobId)) jobs.set(run.jobId, await repo.getJob(run.jobId));
    const job = jobs.get(run.jobId);
    if (!job) {
      await repo.updateRun(run.id, { state: "DONE", pass: false, error: "job deleted" });
      continue;
    }
    const client = deps.clientFor(job.network);
    const cost = job.network === "bradbury" && !job.system ? (deps.runCostWei?.() ?? BigInt(0)) : BigInt(0);
    let failed: StepRunRow | null = null;
    let progressed = false;

    for (const sr of run.steps.filter((s) => s.status === "PENDING")) {
      rep.checked++;
      let tx: ChainTx | undefined;
      let readErr: string | undefined;
      try {
        tx = await client.getTransaction({ hash: sr.txHash as `0x${string}` });
      } catch (e) {
        readErr = errMsg(e);
      }
      if (!tx || !measure(sr, tx, cost)) {
        if (deps.nowSec() - (sr.submittedAt ?? run.startedAt) > RUN_TIMEOUT_SEC) {
          Object.assign(sr, { status: "TIMEOUT", error: readErr ?? "no decision after 6h", resolvedAt: deps.nowSec() });
        } else {
          rep.pending++;
          continue;
        }
      }
      rep.decided++;
      progressed = true;
      await repo.saveStepRun(run.id, sr);
      if (!OK_STATUSES.has(sr.status) || sr.error) failed = sr;
    }
    if (!progressed) continue;

    const isHeartbeat = job.system && job.preset === HEARTBEAT;
    if (isHeartbeat) {
      if (run.steps.every((s) => s.status !== "PENDING")) {
        const pass = run.steps.every((s) => OK_STATUSES.has(s.status) && !s.error);
        await repo.updateRun(run.id, { state: "DONE", pass });
        if (!pass) await alertFailure(deps, job, run.id);
        rep.finished++;
      }
      continue;
    }
    if (failed) {
      await finish(deps, job, run, failed.error ?? `step "${failed.stepId}" ended ${failed.status}`);
      rep.finished++;
      continue;
    }
    const group = groupsOf(job).find((g) => g.key === run.group);
    if (!group) {
      await finish(deps, job, run, "schedule group no longer exists");
      rep.finished++;
      continue;
    }
    // The current step succeeded: carry on with the next one.
    run.cursor += 1;
    await repo.updateRun(run.id, { cursor: run.cursor });
    await advance(deps, job, group, run);
    const after = await repo.getRun(run.id);
    if (after?.state === "DONE") rep.finished++;
  }
  return rep;
}

// ---------------------------------------------------------------------------
// Bradbury Heartbeat, our public example job.

const HB_STEP: Record<string, string> = { deploy: "canary", fetch: "fetch", llm: "llm", appeal: "appeal" };

async function dispatchHeartbeat(deps: ExecutorDeps, job: JobRow, group: Group, slot: number) {
  const run = await deps.repo.createRun({ id: newId(), jobId: job.id, group: group.key, scheduledFor: slot, state: "RUNNING", cursor: group.steps.length });
  if (!run) return;
  if (!deps.heartbeatTick) {
    await deps.repo.updateRun(run.id, { state: "DONE", pass: false, error: "heartbeat runner not wired" });
    return;
  }
  try {
    const { tick, probes } = await deps.heartbeatTick();
    let idx = 0;
    for (const p of probes) {
      const failed = p.status === "SUBMIT_FAILED" || !p.txHash;
      await deps.repo.saveStepRun(run.id, {
        idx: idx++,
        stepId: HB_STEP[p.kind] ?? p.kind,
        kind: "probe",
        status: failed ? "SUBMIT_FAILED" : "PENDING",
        txHash: p.txHash,
        submittedAt: deps.nowSec(),
        resolvedAt: failed ? deps.nowSec() : null,
        result: { tick, ...(p.qid ? { qid: p.qid } : {}) },
        ...(p.error ? { error: p.error } : {}),
      });
    }
    if (probes.every((p) => p.status === "SUBMIT_FAILED" || !p.txHash)) {
      await deps.repo.updateRun(run.id, { state: "DONE", pass: false, error: "every probe failed to submit" });
    }
  } catch (e) {
    await deps.repo.updateRun(run.id, { state: "DONE", pass: false, error: errMsg(e) });
  }
}

export async function ensureHeartbeatJob(
  repo: Repo,
  owner: string | null,
  contract: string | null,
  nowSec: number
): Promise<JobRow | null> {
  if (!owner || !contract) return null;
  const found = await repo.findSystemJob("bradbury", HEARTBEAT);
  if (found) return found;
  const schedule = { everyMinutes: 60 };
  const id = newId();
  return repo.createJob({
    id,
    owner: owner.toLowerCase(),
    name: "Bradbury Heartbeat",
    network: "bradbury",
    preset: HEARTBEAT,
    schedule,
    steps: [
      { id: "canary", kind: "deploy", preset: "canary", args: ["{{slot}}"] },
      { id: "fetch", kind: "write", contract, method: "probe_fetch", args: ["{{slot}}"] },
      { id: "llm", kind: "write", contract, method: "probe_llm", args: ["{{slot}}", "<rotating qid>"] },
    ],
    assertions: [],
    state: "active",
    system: true,
    public: true,
    poolId: poolIdFor(id),
    // The top of the hour, like the Heartbeat always ticked.
    schedules: [initialSchedule(toSpec("job", schedule), nowSec, 3600)],
  });
}

// ---------------------------------------------------------------------------

export function toPublicRun(r: RunRow): Run {
  const steps: StepRun[] = r.steps
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({
      stepId: s.stepId,
      status: s.status,
      ...(s.txHash ? { txHash: s.txHash } : {}),
      ...(s.result !== undefined ? { result: s.result } : {}),
      ...(s.timeToAcceptedMs !== undefined ? { timeToAcceptedMs: s.timeToAcceptedMs } : {}),
      ...(s.gasWei ? { gasGen: formatEther(BigInt(s.gasWei)) } : {}),
      ...(s.error ? { error: s.error } : {}),
    }));
  if (r.state === "SKIPPED" && steps.length === 0 && r.error) {
    // A slot the gate refused: one ERROR line so the history shows why.
    steps.push({ stepId: r.group, status: "ERROR", error: `skipped: ${r.error}` });
  }
  return { id: r.id, jobId: r.jobId, startedAt: new Date(r.startedAt * 1000).toISOString(), steps, pass: r.pass };
}
