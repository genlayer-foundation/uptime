// "Run now": anyone can trigger ONE extra run of a public job, signed and paid
// by THEIR OWN wallet (never the relayer, never the job's pool).
//
//   start   POST {runner}          -> the first transaction to sign, plus a
//                                     signed token binding it to (job, runner, slot)
//   report  POST {token|runId, txHash}
//                                  -> the server reads the tx from the chain and
//                                     records it only if it is exactly that call
//                                     from that wallet; then the next one to sign
//   poll    GET  ?run=<id>         -> measures pending txs, returns the next call
//
// The browser's word is never trusted: sender, target, and the byte-exact
// calldata (method + args, or deploy code + args) are compared with the
// chain's own record of the tx, the tx must be newer than the run, and a hash
// is recorded once. Results are measured from the chain like scheduled runs
// (executor.measure). The run row is created only once the first transaction
// verifies, so starting a run costs a griefer real GEN, not a click.
//
// {{relayer}} expands to the RUNNER for a manual run: contracts that file
// results under the caller (web_probe, ask: "caller|job|run") are read back
// under the visitor's address for that run.

import { createHmac, timingSafeEqual } from "node:crypto";
import { abi } from "genlayer-js";
import { keccak256, stringToHex, toHex, toRlp } from "viem";
import { isAdmin, isStudioAllowed } from "./allowlist";
import type { ChainClient, ChainTx } from "./chain";
import { abandonManual, finishManual, MANUAL_ABANDON_SEC, measure } from "./executor";
import { newId } from "./ids";
import type { JobRow, RunRow, StepRunRow } from "./internal";
import {
  MANUAL_GROUP,
  MANUAL_MIN_GAP_SEC,
  manualBlocker,
  manualSteps,
  tagArgs,
  type ManualCall,
  type ManualStatus,
  type WireFees,
} from "./manualPlan";
import type { Repo } from "./repo";
import { expand, jsonSafe, MissingDeploy, OK_STATUSES, toCalldata } from "./spec";
import type { Network, Step } from "./types";

export const TOKEN_TTL_SEC = 15 * 60;
export const TX_SKEW_SEC = 120;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export interface ManualDeps {
  repo: Repo;
  allowlist: ReadonlySet<string>;
  /** Read-only client per network: getTransaction + readContract. No key needed. */
  reader: (n: Network) => Pick<ChainClient, "getTransaction" | "readContract">;
  nowSec: () => number;
  deployPresets: Record<Network, Record<string, string>>;
  secret: string | null;
  fees: (n: Network) => WireFees;
}

type Out<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** What the chain must show for one step: stored in the token, then in run.meta. */
export interface Expect {
  idx: number;
  stepId: string;
  kind: "write" | "deploy";
  to: string | null; // the contract a write targets
  data: string; // the GenLayer tx payload, hex RLP (Bradbury txData)
  calldata: string; // hex GenVM calldata (Studio data.calldata)
  codeHash: string | null; // keccak of the deploy code (Studio data.contract_code)
}

const isHeartbeat = (j: JobRow) => j.system && j.preset === "heartbeat";
const stepsOf = (j: JobRow) => manualSteps(j, isHeartbeat(j));
const runIdFor = (slot: number) => `${MANUAL_GROUP}:${slot}`;

function canSee(j: JobRow | null, viewer: string | null): j is JobRow {
  return !!j && j.state !== "deleted" && (j.public || j.owner === viewer || isAdmin(viewer));
}

// ---------------------------------------------------------------- encoding

function encodeCalldata(method: string | undefined, args: unknown[]): Uint8Array {
  return abi.calldata.encode(abi.calldata.makeCalldataObject(method, args as never, undefined));
}

/** The exact payload genlayer-js writes for this call (writeContract / deployContract, leaderOnly false). */
export function expectFor(idx: number, step: Step, call: { address?: string; code?: string; args: unknown[] }): Expect {
  if (step.kind === "deploy") {
    const cd = encodeCalldata(undefined, call.args);
    return {
      idx, stepId: step.id, kind: "deploy", to: null,
      data: toRlp([toHex(call.code!), toHex(cd), toHex(false)]),
      calldata: toHex(cd),
      codeHash: keccak256(stringToHex(call.code!)),
    };
  }
  const cd = encodeCalldata(step.kind === "write" ? step.method : undefined, call.args);
  return {
    idx, stepId: step.id, kind: "write", to: call.address!.toLowerCase(),
    data: toRlp([toHex(cd), toHex(false)]),
    calldata: toHex(cd),
    codeHash: null,
  };
}

function b64hex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (/^0x[0-9a-fA-F]*$/.test(v)) return v.toLowerCase();
  try {
    return `0x${Buffer.from(v, "base64").toString("hex")}`;
  } catch {
    return null;
  }
}

/**
 * Is `tx` exactly the expected call, sent by `runner`, after `notBefore`?
 * Returns null when it is, else why not. Pure: tested without a chain.
 */
export function checkManualTx(tx: ChainTx, e: Expect, runner: string, notBefore: number, network: Network): string | null {
  const sender = String(tx.sender ?? tx.from_address ?? "").toLowerCase();
  if (sender !== runner.toLowerCase()) return "the transaction was not sent by your wallet";
  const recipient = String(tx.recipient ?? tx.to_address ?? "").toLowerCase();
  if (e.kind === "write" && recipient !== e.to) return "the transaction targets a different contract";

  if (network === "bradbury") {
    const raw = typeof tx.txData === "string" ? tx.txData.toLowerCase() : "";
    if (!raw) return "the transaction carries no call data";
    if (raw !== e.data.toLowerCase()) return "the transaction is not this job's action (method, arguments or code differ)";
  } else {
    // Studio (genlayer-js 1.x localnet shape): data.calldata (base64), data.contract_code.
    const data = (tx.data ?? {}) as Record<string, unknown>;
    const cd = b64hex(data.calldata);
    if (!cd) return "cannot read the transaction's call data on Studio";
    if (cd !== e.calldata.toLowerCase()) return "the transaction is not this job's action (method or arguments differ)";
    if (e.kind === "deploy") {
      const code = data.contract_code;
      const hashes = typeof code === "string" ? [keccak256(stringToHex(code))] : [];
      const asHex = b64hex(code);
      if (asHex && asHex !== "0x") hashes.push(keccak256(asHex as `0x${string}`));
      if (!hashes.includes(e.codeHash as `0x${string}`)) return "the deployed code is not this job's";
    }
  }

  const created = Number(tx.createdTimestamp ?? 0);
  if (created > 0 && created < notBefore - TX_SKEW_SEC) return "the transaction is older than this run";
  return null;
}

// ---------------------------------------------------------------- tokens

interface TokenBody {
  jobId: string;
  runner: string;
  slot: number;
  expect: Expect;
}

export function signToken(body: TokenBody, secret: string): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`manual:${payload}`).digest("base64url")}`;
}

export function readToken(token: string, secret: string): TokenBody | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = createHmac("sha256", secret).update(`manual:${payload}`).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenBody;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- planning

interface Ctx {
  job: JobRow;
  runner: string;
  slot: number;
  run: RunRow | null;
}

async function expandStep(deps: ManualDeps, c: Ctx, step: Step) {
  const refs = new Set<string>();
  JSON.stringify([("contract" in step ? step.contract : null), step.args], (_k, v) => {
    const m = typeof v === "string" ? /^\$([A-Za-z0-9][A-Za-z0-9_-]{0,31})\.address$/.exec(v) : null;
    if (m) refs.add(m[1]);
    return v;
  });
  const deployed = new Map<string, string>();
  for (const id of refs) {
    const mine = c.run?.steps.find((s) => s.stepId === id && s.kind === "deploy");
    const addr = (mine?.result as { address?: string } | undefined)?.address ?? (await deps.repo.lastDeployAddress(c.job.id, id));
    if (addr) deployed.set(id, addr);
  }
  const x = { jobId: c.job.id, runId: runIdFor(c.slot), slot: c.slot, relayer: c.runner, deployed: (id: string) => deployed.get(id) };
  return {
    address: "contract" in step ? (expand(step.contract, x) as string) : undefined,
    args: toCalldata(expand(step.args, x)) as unknown[],
  };
}

async function prepare(deps: ManualDeps, c: Ctx, idx: number): Promise<{ call: ManualCall; expect: Expect }> {
  const step = stepsOf(c.job)[idx];
  const call = await expandStep(deps, c, step);
  if (step.kind === "deploy") {
    const code = step.code ?? deps.deployPresets[c.job.network]?.[step.preset ?? ""];
    if (!code) throw new Error(`unknown deploy preset "${step.preset}"`);
    return {
      call: { kind: "deploy", idx, stepId: step.id, code, args: tagArgs(call.args) as unknown[] },
      expect: expectFor(idx, step, { code, args: call.args }),
    };
  }
  if (!call.address || !ADDRESS.test(call.address)) throw new Error(`step "${step.id}": contract is not an address`);
  return {
    call: { kind: "write", idx, stepId: step.id, address: call.address as `0x${string}`, method: (step as { method: string }).method, args: tagArgs(call.args) as unknown[] },
    expect: expectFor(idx, step, call),
  };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ---------------------------------------------------------------- start

export async function startManual(deps: ManualDeps, jobId: string, runnerRaw: unknown, viewer: string | null): Promise<Out<ManualStatus>> {
  if (!deps.secret) return fail(503, "SESSION_SECRET not configured");
  const job = jobId ? await deps.repo.getJob(jobId) : null;
  if (!canSee(job, viewer)) return fail(404, "job not found");
  const runner = typeof runnerRaw === "string" && ADDRESS.test(runnerRaw) ? runnerRaw.toLowerCase() : null;
  if (!runner) return fail(400, "runner must be your wallet address");
  if (job.network === "studio" && !isStudioAllowed(runner, deps.allowlist)) {
    return fail(403, "Studio runs are for allowlisted wallets only");
  }
  const blocker = manualBlocker(job, isHeartbeat(job));
  if (blocker) return fail(409, blocker);
  const now = deps.nowSec();
  if (await deps.repo.manualRunBlocked(job.id, now, MANUAL_MIN_GAP_SEC, MANUAL_ABANDON_SEC)) {
    return fail(429, "Another manual run is in progress or just ran. Try again in a minute.");
  }
  const steps = stepsOf(job);
  const first = steps.findIndex((s) => s.kind !== "read");
  const c: Ctx = { job, runner, slot: now, run: null };
  try {
    const { call, expect } = await prepare(deps, c, first);
    const token = signToken({ jobId: job.id, runner, slot: now, expect }, deps.secret);
    return { ok: true, value: { state: "sign", runId: null, token, call, fees: deps.fees(job.network), network: job.network } };
  } catch (e) {
    return fail(e instanceof MissingDeploy ? 409 : 400, errMsg(e));
  }
}

// ---------------------------------------------------------------- report

async function verify(deps: ManualDeps, job: JobRow, e: Expect, runner: string, notBefore: number, txHash: string): Promise<Out<ChainTx>> {
  if (await deps.repo.txHashUsed(txHash)) return fail(409, "this transaction is already recorded");
  let tx: ChainTx | undefined;
  try {
    tx = await deps.reader(job.network).getTransaction({ hash: txHash as `0x${string}` });
  } catch (err) {
    return fail(409, `transaction not found on ${job.network} yet: ${errMsg(err)}`);
  }
  if (!tx) return fail(409, `transaction not found on ${job.network} yet`);
  const why = checkManualTx(tx, e, runner, notBefore, job.network);
  return why ? fail(422, why) : { ok: true, value: tx };
}

function pendingRow(e: Expect, txHash: string, now: number): StepRunRow {
  return { idx: e.idx, stepId: e.stepId, kind: e.kind, status: "PENDING", txHash, submittedAt: now, resolvedAt: null };
}

export async function reportManual(
  deps: ManualDeps,
  jobId: string,
  body: { token?: unknown; runId?: unknown; txHash?: unknown },
  viewer: string | null
): Promise<Out<ManualStatus>> {
  if (!deps.secret) return fail(503, "SESSION_SECRET not configured");
  const txHash = typeof body.txHash === "string" && TX_HASH.test(body.txHash) ? body.txHash.toLowerCase() : null;
  if (!txHash) return fail(400, "txHash must be a 0x transaction hash");
  const job = jobId ? await deps.repo.getJob(jobId) : null;
  if (!canSee(job, viewer)) return fail(404, "job not found");
  const now = deps.nowSec();

  if (typeof body.token === "string") {
    // First transaction: the run does not exist yet.
    const t = readToken(body.token, deps.secret);
    if (!t || t.jobId !== job.id) return fail(400, "invalid run token");
    if (now - t.slot > TOKEN_TTL_SEC) return fail(410, "this run request expired: press Run now again");
    const v = await verify(deps, job, t.expect, t.runner, t.slot, txHash);
    if (!v.ok) return v;
    const total = stepsOf(job).length;
    const run = await deps.repo.createManualRun(
      {
        id: newId(), jobId: job.id, group: MANUAL_GROUP, scheduledFor: t.slot, state: "RUNNING", cursor: t.expect.idx + 1,
        meta: { manual: true, runner: t.runner, total },
      },
      now, MANUAL_MIN_GAP_SEC, MANUAL_ABANDON_SEC
    );
    if (!run) return fail(429, "Another manual run is in progress or just ran. Your transaction was not recorded.");
    // Read steps before the first transaction run now, in order.
    const c: Ctx = { job, runner: t.runner, slot: t.slot, run };
    for (let i = 0; i < t.expect.idx; i++) await runRead(deps, c, i);
    await deps.repo.saveStepRun(run.id, pendingRow(t.expect, txHash, now));
    return { ok: true, value: await progress(deps, job, (await deps.repo.getRun(run.id))!) };
  }

  const run = typeof body.runId === "string" ? await deps.repo.getRun(body.runId) : null;
  if (!run || run.jobId !== job.id || run.group !== MANUAL_GROUP) return fail(404, "run not found");
  if (run.state !== "RUNNING") return fail(409, "this run is already finished");
  const e = run.meta.expect as Expect | undefined;
  if (!e || e.idx !== run.cursor) return fail(409, "this run is not waiting for a transaction");
  const v = await verify(deps, job, e, String(run.meta.runner), run.scheduledFor, txHash);
  if (!v.ok) return v;
  await deps.repo.saveStepRun(run.id, pendingRow(e, txHash, now));
  await deps.repo.updateRun(run.id, { cursor: e.idx + 1, meta: { ...run.meta, expect: undefined } });
  return { ok: true, value: await progress(deps, job, (await deps.repo.getRun(run.id))!) };
}

export async function pollManual(deps: ManualDeps, jobId: string, runId: string, viewer: string | null): Promise<Out<ManualStatus>> {
  const job = jobId ? await deps.repo.getJob(jobId) : null;
  if (!canSee(job, viewer)) return fail(404, "job not found");
  const run = await deps.repo.getRun(runId);
  if (!run || run.jobId !== job.id || run.group !== MANUAL_GROUP) return fail(404, "run not found");
  return { ok: true, value: await progress(deps, job, run) };
}

// ---------------------------------------------------------------- progress

async function runRead(deps: ManualDeps, c: Ctx, idx: number): Promise<StepRunRow> {
  const step = stepsOf(c.job)[idx];
  const sr: StepRunRow = { idx, stepId: step.id, kind: "read", status: "PENDING", submittedAt: deps.nowSec(), resolvedAt: null };
  const t = Date.now();
  try {
    const call = await expandStep(deps, c, step);
    const v = await deps.reader(c.job.network).readContract({
      address: call.address as `0x${string}`, functionName: (step as { method: string }).method, args: call.args,
    });
    Object.assign(sr, { status: "ACCEPTED", result: jsonSafe(v), timeToAcceptedMs: Date.now() - t, resolvedAt: deps.nowSec() });
  } catch (e) {
    Object.assign(sr, { status: "ERROR", error: errMsg(e), resolvedAt: deps.nowSec() });
  }
  await deps.repo.saveStepRun(c.run!.id, sr);
  c.run!.steps = [...c.run!.steps.filter((s) => s.idx !== idx), sr];
  return sr;
}

const done = (r: RunRow): ManualStatus => ({ state: "done", runId: r.id, pass: r.pass, error: r.error });

async function progress(deps: ManualDeps, job: JobRow, run: RunRow): Promise<ManualStatus> {
  if (run.state !== "RUNNING") return done(run);
  const c: Ctx = { job, runner: String(run.meta.runner), slot: run.scheduledFor, run };

  // 1. Measure what the chain decided (cost 0: the visitor paid).
  for (const sr of run.steps.filter((s) => s.status === "PENDING" && s.txHash)) {
    try {
      const tx = await deps.reader(job.network).getTransaction({ hash: sr.txHash as `0x${string}` });
      if (tx && measure(sr, tx, BigInt(0))) await deps.repo.saveStepRun(run.id, sr);
    } catch {
      // still pending as far as we can tell
    }
  }
  const failed = run.steps.find((s) => s.status !== "PENDING" && (!OK_STATUSES.has(s.status) || s.error));
  if (failed) {
    await finishManual(deps, job, run, failed.error ?? `step "${failed.stepId}" ended ${failed.status}`);
    return done((await deps.repo.getRun(run.id))!);
  }
  if (run.steps.some((s) => s.status === "PENDING")) return { state: "pending", runId: run.id };

  // 2. Run reads; stop at the next transaction for the visitor to sign.
  const steps = stepsOf(job);
  for (let i = run.cursor; i < steps.length; i++) {
    if (steps[i].kind === "read") {
      const sr = await runRead(deps, c, i);
      await deps.repo.updateRun(run.id, { cursor: i + 1 });
      run.cursor = i + 1;
      if (sr.status === "ERROR") {
        await finishManual(deps, job, run, sr.error ?? null);
        return done((await deps.repo.getRun(run.id))!);
      }
      continue;
    }
    try {
      const { call, expect } = await prepare(deps, c, i);
      await deps.repo.updateRun(run.id, { meta: { ...run.meta, expect } });
      return { state: "sign", runId: run.id, call, fees: deps.fees(job.network), network: job.network };
    } catch (e) {
      await finishManual(deps, job, run, errMsg(e));
      return done((await deps.repo.getRun(run.id))!);
    }
  }
  run.cursor = steps.length;
  await abandonManual(deps, job, { ...run, meta: { ...run.meta, total: steps.length } });
  return done((await deps.repo.getRun(run.id))!);
}
