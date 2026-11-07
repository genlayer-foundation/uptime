// "Run now": a visitor's run, signed by their wallet, verified on-chain before
// it is recorded, never charged to the pool, never advanced by the relayer.
import { decodeInputData } from "genlayer-js";
import { describe, expect, it, vi } from "vitest";
import type { ChainClient, ChainTx } from "@/lib/jobs/chain";
import { ensureHeartbeatJob, reconcile, toPublicRun, type ExecutorDeps } from "@/lib/jobs/executor";
import { checkManualTx, expectFor, pollManual, readToken, reportManual, startManual, type Expect, type ManualDeps } from "@/lib/jobs/manual";
import { manualBlocker, tagArgs, untagArgs, type ManualStatus } from "@/lib/jobs/manualPlan";
import { createJob } from "@/lib/jobs/service";
import type { Step } from "@/lib/jobs/types";
import { MemoryRepo } from "./memoryRepo";

const OWNER = "0x00000000000000000000000000000000000a11ce";
const VISITOR = "0x000000000000000000000000000000000000beef";
const OTHER = "0x000000000000000000000000000000000000bad1";
const C1 = "0x1111111111111111111111111111111111111111";
const T0 = 1_800_000_000;
const SECRET = "x".repeat(40);

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function setup(allow: string[] = [OWNER]) {
  let now = T0;
  const repo = new MemoryRepo(() => now);
  const txs = new Map<string, ChainTx>();
  const reader = {
    getTransaction: vi.fn(async ({ hash }: { hash: string }) => {
      const t = txs.get(hash);
      if (!t) throw new Error("not found");
      return t;
    }),
    readContract: vi.fn(async (a: { functionName: string; args?: unknown[] }) => new Map<string, unknown>([["ok", true], ["caller", a.args?.[0]]])),
  };
  const deps: ManualDeps = {
    repo, allowlist: new Set(allow), reader: () => reader, nowSec: () => now,
    deployPresets: { studio: { canary: "# canary" }, bradbury: { canary: "# canary" } },
    secret: SECRET,
    fees: (n) => (n === "bradbury" ? { executionBudgetPerRound: "1" } : null),
  };
  const svc = { repo, gate: { allowlist: new Set(allow), funding: async () => ({ ok: true }) }, nowSec: () => now };
  return { repo, deps, svc, reader, txs, setNow: (t: number) => (now = t) };
}

const steps: Step[] = [
  { id: "check", kind: "write", contract: C1, method: "check_url", args: ["{{job_id}}", "{{run_id}}", "{{slot}}"] },
  { id: "result", kind: "read", contract: C1, method: "get_run", args: ["{{relayer}}", "{{job_id}}", "{{run_id}}"] },
];

async function publicJob(s: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) {
  const made = await createJob(s.svc, OWNER, { name: "probe", network: "bradbury", schedule: { everyMinutes: 60 }, steps, public: true, ...extra });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

// What the chain would show for a tx that matches `e`, sent by `from`.
function chainTx(e: Expect, from: string, extra: Partial<ChainTx> = {}): ChainTx {
  return {
    sender: from, recipient: e.to ?? "0x9999999999999999999999999999999999999999", txData: e.data,
    statusName: "ACCEPTED", createdTimestamp: String(T0 + 5), lastVoteTimestamp: String(T0 + 35), numOfRounds: "1",
    txExecutionResultName: "FINISHED_WITH_RETURN", ...extra,
  };
}

function expectOf(st: ManualStatus): Expect {
  if (st.state !== "sign" || !st.token) throw new Error("no token");
  return readToken(st.token, SECRET)!.expect;
}

describe("manual run encoding", () => {
  it("expects exactly the payload genlayer-js writes (write and deploy)", () => {
    const w = expectFor(0, steps[0], { address: C1, args: ["job", "manual:1", BigInt(7)] });
    const dw = decodeInputData(w.data as `0x${string}`, C1 as `0x${string}`) as { callData: Map<string, unknown> | Record<string, unknown>; leaderOnly: boolean };
    expect(dw.leaderOnly).toBe(false);
    const cd = dw.callData instanceof Map ? Object.fromEntries(dw.callData) : dw.callData;
    expect(cd[""]).toBe("check_url");
    expect(cd.args).toEqual(["job", "manual:1", BigInt(7)]);

    const d = expectFor(0, { id: "canary", kind: "deploy", preset: "canary", args: [] }, { code: "# canary", args: [BigInt(5)] });
    const dd = decodeInputData(d.data as `0x${string}`, C1 as `0x${string}`) as { code: string; constructorArgs: unknown; leaderOnly: boolean };
    expect(dd.code).toBe("# canary");
    expect(dd.leaderOnly).toBe(false);
  });

  it("tags bigints across JSON", () => {
    const v = ["a", BigInt(3), { n: BigInt(-2) }];
    expect(untagArgs(JSON.parse(JSON.stringify(tagArgs(v))))).toEqual(v);
  });

  it("checkManualTx refuses another sender, contract, call, or an old tx", () => {
    const e = expectFor(0, steps[0], { address: C1, args: ["j", "r", BigInt(1)] });
    const ok = chainTx(e, VISITOR);
    expect(checkManualTx(ok, e, VISITOR, T0, "bradbury")).toBeNull();
    expect(checkManualTx(ok, e, OTHER, T0, "bradbury")).toMatch(/not sent by your wallet/);
    expect(checkManualTx({ ...ok, recipient: OTHER }, e, VISITOR, T0, "bradbury")).toMatch(/different contract/);
    const other = expectFor(0, steps[0], { address: C1, args: ["j", "r", BigInt(2)] });
    expect(checkManualTx({ ...ok, txData: other.data }, e, VISITOR, T0, "bradbury")).toMatch(/not this job's action/);
    expect(checkManualTx({ ...ok, createdTimestamp: String(T0 - 3600) }, e, VISITOR, T0, "bradbury")).toMatch(/older/);
    // Studio shape: base64 calldata
    const studio = { from_address: VISITOR, to_address: C1, data: { calldata: Buffer.from(e.calldata.slice(2), "hex").toString("base64") } };
    expect(checkManualTx(studio as ChainTx, e, VISITOR, T0, "studio")).toBeNull();
    expect(checkManualTx({ ...studio, data: {} } as ChainTx, e, VISITOR, T0, "studio")).toMatch(/cannot read/);
  });
});

describe("manual run flow", () => {
  it("records a verified visitor run, reads under the visitor's address, tags it, never bills the pool", async () => {
    const s = setup();
    const job = await publicJob(s);
    const start = await startManual(s.deps, job.id, VISITOR, null);
    if (!start.ok) throw new Error(start.error);
    expect(start.value).toMatchObject({ state: "sign", runId: null, network: "bradbury", call: { kind: "write", address: C1, method: "check_url" } });
    expect(untagArgs((start.value as { call: { args: unknown[] } }).call.args)).toEqual([job.id, `manual:${T0}`, BigInt(T0)]);
    expect(s.repo.runs).toHaveLength(0); // nothing recorded until a tx verifies

    const e = expectOf(start.value);
    s.txs.set(hash(1), chainTx(e, VISITOR));
    s.setNow(T0 + 40);
    const out = await reportManual(s.deps, job.id, { token: (start.value as { token: string }).token, txHash: hash(1) }, null);
    if (!out.ok) throw new Error(out.error);
    expect(out.value).toMatchObject({ state: "done", pass: true });
    // The read step looked up the result filed under the VISITOR, for this run.
    expect(s.reader.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "get_run", args: [VISITOR, job.id, `manual:${T0}`] }));

    const run = toPublicRun(s.repo.runs[0]);
    expect(run.manual).toEqual({ by: VISITOR });
    expect(run.steps.map((x) => [x.stepId, x.status])).toEqual([["check", "ACCEPTED"], ["result", "ACCEPTED"]]);
    expect(run.steps.every((x) => !x.gasGen)).toBe(true);
    expect(await s.repo.unsettled("bradbury", T0 + 10_000, 100, { feeLines: true })).toEqual([]);
    expect(await s.repo.consecutiveFailures(job.id)).toBe(0);
  });

  it("refuses a wrong sender or a replayed hash, and rate-limits per job", async () => {
    const s = setup();
    const job = await publicJob(s);
    const start = await startManual(s.deps, job.id, VISITOR, null);
    if (!start.ok) throw new Error(start.error);
    const token = (start.value as { token: string }).token;
    const e = expectOf(start.value);
    s.txs.set(hash(1), chainTx(e, OTHER));
    expect(await reportManual(s.deps, job.id, { token, txHash: hash(1) }, null)).toMatchObject({ ok: false, status: 422 });
    expect(s.repo.runs).toHaveLength(0);

    s.txs.set(hash(2), chainTx(e, VISITOR));
    expect((await reportManual(s.deps, job.id, { token, txHash: hash(2) }, null)).ok).toBe(true);
    // the same hash again, on a later run
    s.setNow(T0 + 120);
    const again = await startManual(s.deps, job.id, VISITOR, null);
    if (!again.ok) throw new Error(again.error);
    expect(await reportManual(s.deps, job.id, { token: (again.value as { token: string }).token, txHash: hash(2) }, null)).toMatchObject({ ok: false, status: 409 });

    // < 60 s after a manual run started: refused
    s.setNow(T0 + 30);
    expect(await startManual(s.deps, job.id, OTHER, null)).toMatchObject({ ok: false, status: 429 });
  });

  it("one in flight: a second runner waits while a run is pending; reconcile never signs its next step", async () => {
    const s = setup();
    const job = await publicJob(s, {
      steps: [
        { id: "a", kind: "write", contract: C1, method: "a", args: [] },
        { id: "b", kind: "write", contract: C1, method: "b", args: [] },
      ],
    });
    const start = await startManual(s.deps, job.id, VISITOR, null);
    if (!start.ok) throw new Error(start.error);
    s.txs.set(hash(1), { ...chainTx(expectOf(start.value), VISITOR), statusName: "PENDING" });
    const r1 = await reportManual(s.deps, job.id, { token: (start.value as { token: string }).token, txHash: hash(1) }, null);
    expect(r1).toMatchObject({ ok: true, value: { state: "pending" } });
    s.setNow(T0 + 300);
    expect(await startManual(s.deps, job.id, OTHER, null)).toMatchObject({ ok: false, status: 429 });

    // The chain decides; reconcile measures it but leaves step "b" to the visitor.
    s.txs.set(hash(1), chainTx(expectOf(start.value), VISITOR));
    const relayer = { deployContract: vi.fn(), writeContract: vi.fn(), readContract: vi.fn(), getTransaction: s.reader.getTransaction } as unknown as ChainClient;
    const ex: ExecutorDeps = { repo: s.repo, gate: s.svc.gate, clientFor: () => relayer, relayerFor: () => OTHER, nowSec: () => T0 + 300, deployPresets: s.deps.deployPresets };
    await reconcile(ex);
    expect(relayer.writeContract).not.toHaveBeenCalled();
    expect(s.repo.runs[0].state).toBe("RUNNING");

    const poll = await pollManual(s.deps, job.id, s.repo.runs[0].id, null);
    expect(poll).toMatchObject({ ok: true, value: { state: "sign", call: { method: "b" } } });

    // The visitor walks away: reconcile finishes it as abandoned after 30 min.
    await reconcile({ ...ex, nowSec: () => T0 + 31 * 60 });
    expect(s.repo.runs[0]).toMatchObject({ state: "DONE", pass: false });
    expect(s.repo.runs[0].error).toMatch(/abandoned/);
  });

  it("private jobs 404 for strangers; Studio is allowlist-only", async () => {
    const s = setup([OWNER]);
    const priv = await publicJob(s, { public: false });
    expect(await startManual(s.deps, priv.id, VISITOR, null)).toMatchObject({ ok: false, status: 404 });
    expect((await startManual(s.deps, priv.id, OWNER, OWNER)).ok).toBe(true);
    const studio = await publicJob(s, { network: "studio" });
    expect(await startManual(s.deps, studio.id, VISITOR, null)).toMatchObject({ ok: false, status: 403 });
    expect((await startManual(s.deps, studio.id, OWNER, null)).ok).toBe(true);
  });

  it("Heartbeat: a visitor's run is the canary deploy; jobs that send GEN are owner-only", async () => {
    const s = setup();
    const hb = await ensureHeartbeatJob(s.repo, OWNER, C1, T0);
    const start = await startManual(s.deps, hb!.id, VISITOR, null);
    expect(start).toMatchObject({ ok: true, value: { call: { kind: "deploy", stepId: "canary", code: "# canary" } } });
    expect(manualBlocker({ schedule: { everyMinutes: 5 }, steps: [{ id: "p", kind: "write", contract: C1, method: "pay", args: [], value: "5" }] }, false)).toMatch(/sends GEN/);
  });
});
