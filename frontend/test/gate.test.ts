// The Studio allowlist gate at both layers that enforce it (create/edit/resume
// in the service, every run in the executor), the Bradbury funding gate, the
// executor's step chaining and tracking, and pool settlement.
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";
import { isAdmin, parseWalletList, studioAllowlist } from "@/lib/jobs/allowlist";
import type { ChainClient, ChainTx } from "@/lib/jobs/chain";
import { dispatchDue, ensureHeartbeatJob, reconcile, toPublicRun, type ExecutorDeps } from "@/lib/jobs/executor";
import type { GateDeps } from "@/lib/jobs/gate";
import type { JobRow } from "@/lib/jobs/internal";
import { POOL_ABI } from "@/lib/pool/abi";
import { fundingDecision, outcomesFromLogs, settle, type PoolCharger, type PoolView } from "@/lib/jobs/pool/pool";
import { templates } from "@/lib/jobs/presets";
import { createJob, deleteJob, editJob, pauseJob, resumeJob } from "@/lib/jobs/service";
import { checkAssertion, validateJobInput } from "@/lib/jobs/spec";
import { MemoryRepo } from "./memoryRepo";

const ALICE = "0x00000000000000000000000000000000000a11ce"; // allowlisted
const MALLORY = "0x000000000000000000000000000000000000bad1"; // not
const C1 = "0x1111111111111111111111111111111111111111";
const DEPLOYED = "0x2222222222222222222222222222222222222222";
const RELAYER = "0x3333333333333333333333333333333333333333";
const T0 = 1_800_000_000;

const accepted = (extra: Partial<ChainTx> = {}): ChainTx => ({
  statusName: "ACCEPTED",
  createdTimestamp: "100",
  lastVoteTimestamp: "130",
  numOfRounds: "1",
  txExecutionResultName: "FINISHED_WITH_RETURN",
  lastRound: { validatorVotesName: ["AGREE", "AGREE", "DISAGREE"] },
  ...extra,
});

function fakeClient() {
  const calls: string[] = [];
  let n = 0;
  const client = {
    deployContract: vi.fn(async () => {
      calls.push("deploy");
      return `0xd${++n}` as `0x${string}`;
    }),
    writeContract: vi.fn(async (a: { functionName: string }) => {
      calls.push(`write:${a.functionName}`);
      return `0xa${++n}`;
    }),
    readContract: vi.fn(async (a: { functionName: string }) => {
      calls.push(`read:${a.functionName}`);
      return new Map<string, unknown>([["result", new Map([["ok", true]])], ["n", BigInt(7)]]);
    }),
    getTransaction: vi.fn(async (): Promise<ChainTx> => accepted()),
  } satisfies ChainClient;
  return { client, calls };
}

function setup(allowed: string[] = [ALICE]) {
  let now = T0;
  const repo = new MemoryRepo(() => now);
  const gate: GateDeps = { allowlist: new Set(allowed), funding: async () => ({ ok: true }) };
  const { client, calls } = fakeClient();
  const deps: ExecutorDeps = {
    repo, gate, clientFor: () => client, relayerFor: () => RELAYER, nowSec: () => now,
    deployPresets: { canary: "# canary" },
  } satisfies ExecutorDeps;
  return { repo, gate, deps, client, calls, setNow: (t: number) => (now = t) };
}

const job = (network: string, extra: Record<string, unknown> = {}) => ({
  name: "ping",
  network,
  schedule: { everyMinutes: 5 },
  steps: [{ id: "ping", kind: "write", contract: C1, method: "ping", args: ["{{job_id}}", "{{run_id}}", "{{slot}}", 3] }],
  ...extra,
});

describe("env wallet lists (STUDIO_ALLOWLIST, UPTIME_ADMIN_WALLETS)", () => {
  it("parse comma-separated addresses, normalize, drop junk, fail closed", () => {
    expect(parseWalletList(undefined).size).toBe(0);
    expect(parseWalletList("").size).toBe(0);
    expect(parseWalletList(" , nope,0x12 ").size).toBe(0);
    expect([...parseWalletList(` ${ALICE.replace("a11ce", "A11CE")} ,0x12,${MALLORY},`)]).toEqual([ALICE, MALLORY]);
  });
  it("read the env at call time; unset = nobody", () => {
    const keep = { s: process.env.STUDIO_ALLOWLIST, a: process.env.UPTIME_ADMIN_WALLETS };
    try {
      delete process.env.STUDIO_ALLOWLIST;
      delete process.env.UPTIME_ADMIN_WALLETS;
      expect(studioAllowlist().size).toBe(0);
      expect(isAdmin(ALICE)).toBe(false);
      process.env.STUDIO_ALLOWLIST = ALICE;
      process.env.UPTIME_ADMIN_WALLETS = MALLORY;
      expect(studioAllowlist().has(ALICE)).toBe(true);
      expect(isAdmin(MALLORY.toUpperCase().replace("0X", "0x"))).toBe(true);
      expect(isAdmin(null)).toBe(false);
    } finally {
      if (keep.s === undefined) delete process.env.STUDIO_ALLOWLIST;
      else process.env.STUDIO_ALLOWLIST = keep.s;
      if (keep.a === undefined) delete process.env.UPTIME_ADMIN_WALLETS;
      else process.env.UPTIME_ADMIN_WALLETS = keep.a;
    }
  });
});

describe("API gate", () => {
  it("refuses a Studio create from a non-allowlisted wallet (403) and stores nothing", async () => {
    const { repo, deps } = setup();
    expect(await createJob(deps, MALLORY, job("studio"))).toEqual({ ok: false, status: 403, error: "This wallet is not on the Studio allowlist" });
    expect(repo.jobs.size).toBe(0);
  });
  it("refuses Studio for everyone when STUDIO_ALLOWLIST is unset", async () => {
    const { deps } = setup();
    delete process.env.STUDIO_ALLOWLIST;
    const out = await createJob({ ...deps, gate: { ...deps.gate, allowlist: studioAllowlist() } }, ALICE, job("studio"));
    expect(out).toMatchObject({ ok: false, status: 403 });
  });
  it("accepts Studio from an allowlisted wallet, active; Bradbury from anyone, as a draft", async () => {
    const { deps } = setup();
    const a = await createJob(deps, ALICE.replace("a11ce", "A11CE"), job("studio"));
    expect(a.ok && a.value).toMatchObject({ owner: ALICE, state: "active" });
    const b = await createJob(deps, MALLORY, job("bradbury"));
    expect(b.ok && b.value.state).toBe("draft");
    expect(b.ok && b.value.poolId).toBe(b.ok ? `0x${"0".repeat(32)}${b.value.id.replaceAll("-", "")}` : "");
  });
  it("refuses sub-5-minute schedules, the system preset and bad steps", async () => {
    const { deps } = setup();
    expect(await createJob(deps, ALICE, job("studio", { schedule: { everyMinutes: 1 } }))).toMatchObject({ status: 400 });
    expect(await createJob(deps, ALICE, job("studio", { schedule: { cron: "* * * * *" } }))).toMatchObject({ status: 400 });
    expect(await createJob(deps, ALICE, job("studio", { preset: "heartbeat" }))).toMatchObject({ status: 403 });
    expect(await createJob(deps, ALICE, job("studio", { steps: [{ id: "x", kind: "write", contract: "0x12", method: "m", args: [] }] }))).toMatchObject({ status: 400 });
    expect(await createJob(deps, ALICE, job("studio", { steps: [{ id: "x", kind: "write", contract: "$nope.address", method: "m", args: [] }] }))).toMatchObject({ status: 400 });
  });
  it("refuses resume and edit once the owner is de-listed", async () => {
    const { deps } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    await pauseJob(deps, ALICE, made.value.id);
    const delisted = { ...deps, gate: { ...deps.gate, allowlist: new Set<string>() } };
    expect(await resumeJob(delisted, ALICE, made.value.id)).toMatchObject({ ok: false, status: 403 });
    expect(await editJob(delisted, ALICE, made.value.id, { name: "x" })).toMatchObject({ ok: false, status: 403 });
  });
  it("lets an operator pause any job, system jobs included; others get 404", async () => {
    const { deps, repo } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    expect(await pauseJob(deps, MALLORY, made.value.id)).toMatchObject({ status: 404 });
    const out = await pauseJob(deps, MALLORY, made.value.id, { admin: true });
    expect(out.ok && out.value).toMatchObject({ state: "paused", stateReason: `paused by operator ${MALLORY}` });
    await repo.updateJob(made.value.id, { state: "active" });
    expect(await pauseJob(deps, ALICE, "not-a-uuid", { admin: true })).toMatchObject({ status: 404 });
  });

  it("hides other wallets' jobs (404) and soft-deletes", async () => {
    const { deps, repo } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    expect(await deleteJob(deps, MALLORY, made.value.id)).toMatchObject({ status: 404 });
    expect((await deleteJob(deps, ALICE, made.value.id)).ok).toBe(true);
    expect(await repo.getJob(made.value.id)).toBeNull();
  });
});

describe("executor gate: every run", () => {
  it("SKIPS a de-listed wallet's Studio job, sends no tx, and marks it errored", async () => {
    const { deps, calls, repo } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    const delisted: ExecutorDeps = { ...deps, gate: { ...deps.gate, allowlist: new Set<string>() } };
    const rep = await dispatchDue(delisted);
    expect(rep.skipped).toBe(1);
    expect(calls).toEqual([]);
    expect(repo.runs[0]).toMatchObject({ state: "SKIPPED", error: "This wallet is not on the Studio allowlist" });
    expect(toPublicRun(repo.runs[0]).steps[0]).toMatchObject({ status: "ERROR", error: "skipped: This wallet is not on the Studio allowlist" });
    expect((await repo.getJob(made.value.id))!.state).toBe("errored");
    expect((await dispatchDue(delisted)).due).toBe(0);
  });
  it("skips Bradbury runs the pool cannot cover; pauses on an on-chain pause; errors on a foreign pool", async () => {
    const { deps, calls, repo, setNow } = setup();
    const made = await createJob(deps, MALLORY, job("bradbury"));
    if (!made.ok) throw new Error("setup");
    await repo.updateJob(made.value.id, { state: "active" });
    const short: ExecutorDeps = { ...deps, gate: { ...deps.gate, funding: async () => ({ ok: false, reason: "short" }) } };
    expect((await dispatchDue(short)).skipped).toBe(1);
    expect((await repo.getJob(made.value.id))!.state).toBe("active");
    setNow(T0 + 300);
    await dispatchDue({ ...deps, gate: { ...deps.gate, funding: async () => ({ ok: false, paused: true, reason: "paused" }) } });
    expect((await repo.getJob(made.value.id))!.state).toBe("paused");
    await repo.updateJob(made.value.id, { state: "active" });
    setNow(T0 + 600);
    await dispatchDue({ ...deps, gate: { ...deps.gate, funding: async () => ({ ok: false, foreign: true, reason: "foreign" }) } });
    expect((await repo.getJob(made.value.id))!.state).toBe("errored");
    expect(calls).toEqual([]);
  });
});

describe("executor: steps, chaining, tracking", () => {
  it("submits, reconciles, measures, and expands placeholders", async () => {
    const { deps, client, repo } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    await dispatchDue(deps);
    expect(client.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: C1, functionName: "ping", args: [made.value.id, `job:${T0}`, BigInt(T0), BigInt(3)] })
    );
    expect(repo.runs[0].state).toBe("RUNNING");
    expect(toPublicRun(repo.runs[0]).pass).toBeNull();
    await reconcile(deps);
    const run = toPublicRun(repo.runs[0]);
    expect(run.pass).toBe(true);
    expect(run.steps[0]).toMatchObject({ stepId: "ping", status: "ACCEPTED", txHash: "0xa1", timeToAcceptedMs: 30_000 });
    expect(repo.runs[0].steps[0].votes).toEqual({ agree: 2, disagree: 1, timeout: 0, other: 0 });
  });

  it("runs write → read in order, then applies assertions", async () => {
    const { deps, calls, repo } = setup();
    const made = await createJob(deps, ALICE, {
      ...job("studio"),
      steps: [
        { id: "check", kind: "write", contract: C1, method: "check_url", args: ["{{job_id}}", "{{run_id}}"] },
        { id: "result", kind: "read", contract: C1, method: "get_run", args: ["{{relayer}}", "{{job_id}}", "{{run_id}}"] },
      ],
      assertions: [
        { step: "result", path: "result.ok", op: "eq", expected: true },
        { step: "result", path: "n", op: "gte", expected: 7 },
      ],
    });
    if (!made.ok) throw new Error(made.error);
    await dispatchDue(deps);
    expect(calls).toEqual(["write:check_url"]); // the read waits for the write
    await reconcile(deps);
    expect(calls).toEqual(["write:check_url", "read:get_run"]);
    const run = toPublicRun(repo.runs[0]);
    expect(run.steps.map((s) => [s.stepId, s.status])).toEqual([["check", "ACCEPTED"], ["result", "ACCEPTED"]]);
    expect(run.steps[1].result).toEqual({ result: { ok: true }, n: 7 });
    expect(run.pass).toBe(true);
  });

  it("fails the run on an assertion, on UNDETERMINED, and on an execution error", async () => {
    const { deps, client, repo, setNow } = setup();
    const made = await createJob(deps, ALICE, {
      ...job("studio"),
      steps: [{ id: "r", kind: "read", contract: C1, method: "get", args: [] }],
      assertions: [{ step: "r", path: "n", op: "gt", expected: 100 }],
    });
    if (!made.ok) throw new Error("setup");
    await dispatchDue(deps);
    expect(toPublicRun(repo.runs[0]).pass).toBe(false);

    const w = await createJob(deps, ALICE, job("studio", { name: "w" }));
    if (!w.ok) throw new Error("setup");
    client.getTransaction.mockResolvedValueOnce(accepted({ statusName: "UNDETERMINED" }));
    setNow(T0 + 300);
    await dispatchDue(deps);
    await reconcile(deps);
    const und = repo.runs.find((r) => r.jobId === w.value.id)!;
    expect(toPublicRun(und)).toMatchObject({ pass: false, steps: [{ status: "UNDETERMINED" }] });

    client.getTransaction.mockResolvedValueOnce(accepted({ txExecutionResultName: "FINISHED_WITH_ERROR" }));
    setNow(T0 + 600);
    await dispatchDue(deps);
    await reconcile(deps);
    const err = repo.runs.filter((r) => r.jobId === w.value.id).at(-1)!;
    expect(toPublicRun(err)).toMatchObject({ pass: false, steps: [{ status: "ACCEPTED", error: "contract execution raised an error" }] });
  });

  it("records SUBMIT_FAILED and times out after 6h", async () => {
    const { deps, client, repo, setNow } = setup();
    const made = await createJob(deps, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    client.writeContract.mockRejectedValueOnce(new Error("nonce too low"));
    await dispatchDue(deps);
    expect(toPublicRun(repo.runs[0])).toMatchObject({ pass: false, steps: [{ status: "SUBMIT_FAILED", error: "nonce too low" }] });

    client.getTransaction.mockResolvedValue({ statusName: "PENDING" });
    setNow(T0 + 300);
    await dispatchDue(deps);
    setNow(T0 + 300 + 6 * 3600 + 1);
    await reconcile(deps);
    expect(toPublicRun(repo.runs[1]).steps[0].status).toBe("TIMEOUT");
  });

  it("calls the alert hook on failed runs only, with the failure streak", async () => {
    const { deps, client, setNow } = setup();
    const onRunFailed = vi.fn(async () => undefined);
    const d = { ...deps, onRunFailed };
    const made = await createJob(d, ALICE, job("studio"));
    if (!made.ok) throw new Error("setup");
    client.writeContract.mockRejectedValueOnce(new Error("boom")).mockRejectedValueOnce(new Error("boom"));
    await dispatchDue(d);
    setNow(T0 + 300);
    await dispatchDue(d);
    expect(onRunFailed).toHaveBeenCalledTimes(2);
    expect(onRunFailed).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: made.value.id, network: "studio" }),
      expect.objectContaining({ pass: false, steps: [expect.objectContaining({ status: "SUBMIT_FAILED" })] }),
      2
    );
    setNow(T0 + 600);
    await dispatchDue(d);
    await reconcile(d);
    expect(onRunFailed).toHaveBeenCalledTimes(2); // a passing run does not alert
  });

  it("deploy hourly + call the latest deploy every 5 min ($deploy.address)", async () => {
    const { deps, client, repo, setNow } = setup();
    client.getTransaction.mockResolvedValue(accepted({ txDataDecoded: { contractAddress: DEPLOYED } }));
    const made = await createJob(deps, ALICE, {
      name: "dc", network: "studio", schedule: { everyMinutes: 60 },
      steps: [
        { id: "deploy", kind: "deploy", preset: "canary", args: ["{{slot}}"] },
        { id: "call", kind: "write", contract: "$deploy.address", method: "bump", args: [], schedule: { everyMinutes: 5 } },
      ],
    });
    if (!made.ok) throw new Error(made.error);
    // Both groups are due at T0; the call has no deployed instance yet.
    await dispatchDue(deps);
    const callRun = repo.runs.find((r) => r.group === "call")!;
    expect(toPublicRun(callRun).steps[0]).toMatchObject({ status: "ERROR" });
    expect(toPublicRun(callRun).steps[0].error).toMatch(/No deployed instance of "deploy"/);
    expect(client.deployContract).toHaveBeenCalledWith({ code: "# canary", args: [BigInt(T0)] });
    await reconcile(deps);
    expect(toPublicRun(repo.runs.find((r) => r.group === "job")!).steps[0].result).toMatchObject({ address: DEPLOYED });
    setNow(T0 + 300);
    await dispatchDue(deps);
    expect(client.writeContract).toHaveBeenCalledWith(expect.objectContaining({ address: DEPLOYED, functionName: "bump" }));
  });

  it("chains a deploy and a call in the SAME run", async () => {
    const { deps, client, calls, repo } = setup();
    client.getTransaction.mockResolvedValue(accepted({ txDataDecoded: { contractAddress: DEPLOYED } }));
    const made = await createJob(deps, ALICE, {
      name: "chain", network: "studio", schedule: { everyMinutes: 60 },
      steps: [
        { id: "d", kind: "deploy", code: "# mine", args: [] },
        { id: "w", kind: "write", contract: "$d.address", method: "init", args: [] },
        { id: "r", kind: "read", contract: "$d.address", method: "get", args: [] },
      ],
    });
    if (!made.ok) throw new Error(made.error);
    await dispatchDue(deps);
    await reconcile(deps); // deploy decided → write submitted
    await reconcile(deps); // write decided → read runs → done
    expect(calls).toEqual(["deploy", "write:init", "read:get"]);
    expect(toPublicRun(repo.runs[0]).pass).toBe(true);
  });

  it("records a flat per-tx cost on Bradbury (gasGen) and none on Studio", async () => {
    const { deps, repo } = setup();
    const b = await createJob(deps, MALLORY, job("bradbury"));
    if (!b.ok) throw new Error("setup");
    await repo.updateJob(b.value.id, { state: "active" });
    const priced = { ...deps, runCostWei: () => BigInt("1000000000000000") };
    await dispatchDue(priced);
    await reconcile(priced);
    expect(toPublicRun(repo.runs[0]).steps[0].gasGen).toBe("0.001");
  });
});

describe("Bradbury Heartbeat example job", () => {
  it("is created once (public, system, hourly at :00) and dispatches through the existing runner", async () => {
    const { deps, repo, setNow } = setup([]);
    const a = await ensureHeartbeatJob(repo, "0xAbC0000000000000000000000000000000000001", C1, T0 + 17);
    const b = await ensureHeartbeatJob(repo, "0xabc0000000000000000000000000000000000001", C1, T0 + 99);
    expect(a!.id).toBe(b!.id);
    expect(a!.public && a!.system).toBe(true);
    expect(a!.schedules[0].anchorAt % 3600).toBe(0);
    expect(await ensureHeartbeatJob(repo, null, C1, T0)).toBeNull();

    const tick = vi.fn(async () => ({
      tick: 7,
      probes: [
        { kind: "deploy", txHash: "0xd1" },
        { kind: "fetch", txHash: "0xf1" },
        { kind: "llm", qid: "fact-gold", txHash: "0xl1" },
      ],
    }));
    setNow(a!.schedules[0].anchorAt);
    await dispatchDue({ ...deps, heartbeatTick: tick });
    expect(tick).toHaveBeenCalledOnce();
    await reconcile(deps);
    const run = toPublicRun(repo.runs[0]);
    expect(run.steps.map((s) => s.stepId)).toEqual(["canary", "fetch", "llm"]);
    expect(run.pass).toBe(true);
    setNow(a!.schedules[0].anchorAt + 1800);
    await dispatchDue({ ...deps, heartbeatTick: tick });
    expect(tick).toHaveBeenCalledOnce();
  });
});

describe("assertions", () => {
  it("cover every op on nested values", () => {
    const v = { result: { ok: true, price: 42.5, tags: ["a", "b"] }, name: "uptime" };
    expect(checkAssertion(v, { step: "s", path: "result.ok", op: "eq", expected: true })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "result.ok", op: "eq", expected: "true" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "name", op: "ne", expected: "x" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "result.price", op: "gt", expected: 40 })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "result.price", op: "lte", expected: "42.5" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "result.price", op: "lt", expected: 1 })).toBe(false);
    expect(checkAssertion(v, { step: "s", path: "result.tags", op: "contains", expected: "b" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "name", op: "contains", expected: "time" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "result.tags.0", op: "eq", expected: "a" })).toBe(true);
    expect(checkAssertion(v, { step: "s", path: "missing", op: "exists" })).toBe(false);
    expect(checkAssertion(v, { step: "s", path: "missing", op: "eq", expected: "x" })).toBe(false);
    expect(checkAssertion(42, { step: "s", op: "eq", expected: 42 })).toBe(true);
  });
  it("must name a real step", () => {
    expect(() => validateJobInput({ ...job("studio"), assertions: [{ step: "nope", op: "exists" }] })).toThrow(/no step "nope"/);
  });
});

describe("presets are prefilled generic jobs", () => {
  it("every user preset validates as a job (with addresses configured)", () => {
    const c = { webprobe: C1, ask: C1, heartbeat: C1 };
    for (const t of templates("bradbury", c).filter((x) => !x.systemOnly)) {
      expect(() => validateJobInput(t as unknown as Record<string, unknown>), t.preset).not.toThrow();
    }
    expect(templates("studio", { webprobe: null, ask: null, heartbeat: null }).find((t) => t.preset === "check-url")!.available).toBe(false);
  });
});

describe("pool funding", () => {
  const j = { id: 1, owner: MALLORY, perRunCapWei: null, system: false, steps: [{ kind: "write" }] } as unknown as JobRow;
  const view = (o: Partial<PoolView> = {}): PoolView => ({
    owner: MALLORY, paused: false, balance: BigInt(100), allowanceActive: true, allowancePaused: false, available: BigInt(50), ...o,
  });
  it("without a pool contract only allowlisted wallets may run on Bradbury", () => {
    expect(fundingDecision(j, "unconfigured", new Set(), BigInt(1)).ok).toBe(false);
    expect(fundingDecision(j, "unconfigured", new Set([MALLORY]), BigInt(1)).ok).toBe(true);
  });
  it("verifies the on-chain owner (ids are first-come), pause, allowance and headroom", () => {
    expect(fundingDecision(j, view(), new Set(), BigInt(10)).ok).toBe(true);
    expect(fundingDecision(j, view({ owner: ALICE }), new Set(), BigInt(1))).toMatchObject({ ok: false, foreign: true });
    expect(fundingDecision(j, view({ owner: "0x0000000000000000000000000000000000000000" }), new Set(), BigInt(1)).ok).toBe(false);
    expect(fundingDecision(j, view({ paused: true }), new Set(), BigInt(1))).toMatchObject({ ok: false, paused: true });
    expect(fundingDecision(j, view({ allowanceActive: false }), new Set(), BigInt(1)).ok).toBe(false);
    expect(fundingDecision(j, view({ allowancePaused: true }), new Set(), BigInt(1))).toMatchObject({ paused: true });
    expect(fundingDecision(j, view({ available: BigInt(5) }), new Set(), BigInt(10)).ok).toBe(false);
  });
});

describe("settlement", () => {
  it("is OFF by default and sends nothing", async () => {
    const charger = vi.fn();
    expect(await settle(new MemoryRepo(), T0, { charger })).toEqual({ enabled: false });
    expect(charger).not.toHaveBeenCalled();
  });

  it("reads per-line outcomes from Charged / ChargeSkipped events", () => {
    const id = `0x${"ab".repeat(32)}` as `0x${string}`;
    const charged = {
      topics: encodeEventTopics({ abi: POOL_ABI, eventName: "Charged", args: { uptimeId: id, role: 1, settlementId: BigInt(5) } }),
      data: encodeAbiParameters([{ type: "uint256" }], [BigInt(9)]),
    };
    const skipped = {
      topics: encodeEventTopics({ abi: POOL_ABI, eventName: "ChargeSkipped", args: { uptimeId: id, role: 1, settlementId: BigInt(5) } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [BigInt(3), 10]),
    };
    const settled = {
      topics: encodeEventTopics({ abi: POOL_ABI, eventName: "Settled", args: { role: 1, settlementId: BigInt(5), spender: RELAYER } }),
      data: encodeAbiParameters([{ type: "uint256" }], [BigInt(9)]),
    };
    expect(outcomesFromLogs([charged, skipped, settled] as never, 3)).toEqual({
      outcomes: [{ charged: true }, { charged: false, reason: "InsufficientBalance" }, { charged: false, reason: "no event" }],
      chargedWei: BigInt(9),
    });
  });

  it("charges one line per step run, above the on-chain lastSettlement, retries skipped lines, never twice", async () => {
    const { deps, repo } = setup();
    const made = await createJob(deps, MALLORY, job("bradbury"));
    if (!made.ok) throw new Error("setup");
    await repo.updateJob(made.value.id, { state: "active" });
    const priced = { ...deps, runCostWei: () => BigInt(5) };
    await dispatchDue(priced);
    await reconcile(priced);

    let outcome = { charged: false, reason: "PoolPaused" };
    const charge = vi.fn(async () => ({ hash: "0xfeed" as `0x${string}`, outcomes: [outcome], chargedWei: outcome.charged ? "5" : "0" }));
    const simulate = vi.fn(async () => undefined);
    const charger: PoolCharger = { lastSettlement: async () => BigInt(41), simulate, charge };
    const first = await settle(repo, T0 + 600, { enabled: true, charger: async () => charger });
    expect(first).toMatchObject({ lines: 1, charged: 0, skipped: 1, onchainId: "42" });
    expect(charge).toHaveBeenCalledWith([made.value.poolId], [BigInt(5)], BigInt(42));
    expect(simulate).toHaveBeenCalledBefore(charge);

    outcome = { charged: true, reason: "" };
    const second = await settle(repo, T0 + 600, { enabled: true, charger: async () => charger });
    expect(second).toMatchObject({ lines: 1, charged: 1, onchainId: "43" });
    expect(await settle(repo, T0 + 600, { enabled: true, charger: async () => charger })).toMatchObject({ lines: 0 });
  });

  it("keeps lines locked when a sent charge's outcome is unknown", async () => {
    const { deps, repo } = setup();
    const made = await createJob(deps, MALLORY, job("bradbury"));
    if (!made.ok) throw new Error("setup");
    await repo.updateJob(made.value.id, { state: "active" });
    const priced = { ...deps, runCostWei: () => BigInt(5) };
    await dispatchDue(priced);
    await reconcile(priced);
    const { ChargeOutcomeUnknown } = await import("@/lib/jobs/pool/pool");
    const charger: PoolCharger = {
      lastSettlement: async () => BigInt(0),
      simulate: async () => undefined,
      charge: async () => {
        throw new ChargeOutcomeUnknown("0xbeef", new Error("timeout"));
      },
    };
    expect(await settle(repo, T0 + 600, { enabled: true, charger: async () => charger })).toMatchObject({ error: expect.stringMatching(/receipt unknown/) });
    expect(await repo.unsettled("bradbury", T0 + 600, 10)).toEqual([]);
  });
});
