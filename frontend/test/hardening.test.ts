// The relayer is one key per network, and on Bradbury it is also the Heartbeat
// operator and the pools' scheduler. These tests pin what a user job can NOT
// make it do, at both layers (create/edit, and again before every submit), and
// that a run without a validator majority is never recorded as passed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainClient, ChainTx } from "@/lib/jobs/chain";
import { BRADBURY_PHASE2 } from "@/lib/chains";
import { dispatchDue, ensureHeartbeatJob, reconcile, toPublicRun, type ExecutorDeps } from "@/lib/jobs/executor";
import type { GateDeps } from "@/lib/jobs/gate";
import { newId, poolIdFor } from "@/lib/jobs/ids";
import { initialSchedule, toSpec } from "@/lib/jobs/schedule";
import { createJob, deleteJob, editJob } from "@/lib/jobs/service";
import { consensusOutcome, settledStatus, stepStatus, validateSteps } from "@/lib/jobs/spec";
import { callRefusal, stepsRefusal, systemTargets } from "@/lib/jobs/targets";
import type { Step } from "@/lib/jobs/types";
import { MemoryRepo } from "./memoryRepo";

const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";
const C1 = "0x1111111111111111111111111111111111111111";
const RELAYER = "0x3333333333333333333333333333333333333333";
const HEARTBEAT = "0x66a4bF89E8812Ced84C405c6f0Cb0E35153EBb3F";
const POOL = "0xcEb88f1f41AE2a12f50330C8c474C640D71dF355";
const POOL_V2 = "0x4444444444444444444444444444444444444444";
const WEBPROBE = "0x5555555555555555555555555555555555555555";
const ASK = "0x6666666666666666666666666666666666666666";
const EXTRA = "0x7777777777777777777777777777777777777777";
const T0 = 1_800_000_000;

const ENV: Record<string, string> = {
  HEARTBEAT_CONTRACT: HEARTBEAT,
  UPTIME_POOL_BRADBURY: POOL,
  UPTIME_POOL_V2_BRADBURY: POOL_V2,
  UPTIME_WEBPROBE_BRADBURY: WEBPROBE,
  UPTIME_ASK_BRADBURY: ASK,
  UPTIME_BLOCKED_TARGETS: ` ${EXTRA.toUpperCase().replace("0X", "0x")}, junk`,
};
const KEEP = [...Object.keys(ENV), "BRADBURY_MAX_JOBS_PER_WALLET", "STUDIO_MAX_JOBS_PER_WALLET"];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEEP.map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  delete process.env.BRADBURY_MAX_JOBS_PER_WALLET;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const tx = (extra: Partial<ChainTx> = {}): ChainTx => ({
  statusName: "ACCEPTED",
  createdTimestamp: "100",
  lastVoteTimestamp: "130",
  numOfRounds: "1",
  txExecutionResultName: "FINISHED_WITH_RETURN",
  ...extra,
});

function setup() {
  let now = T0;
  let n = 0;
  const repo = new MemoryRepo(() => now);
  const gate: GateDeps = { allowlist: new Set([ALICE]), funding: async () => ({ ok: true }) };
  const client = {
    deployContract: vi.fn(async () => `0xd${++n}` as `0x${string}`),
    writeContract: vi.fn(async (a: { address: string; functionName: string; args?: unknown[]; value: bigint }) => `0xa${++n}${a.functionName.slice(0, 0)}`),
    readContract: vi.fn(async () => 1),
    getTransaction: vi.fn(async (): Promise<ChainTx> => tx()),
  } satisfies ChainClient;
  const deps: ExecutorDeps = {
    repo, gate, clientFor: () => client, relayerFor: () => RELAYER, nowSec: () => now,
    deployPresets: { studio: { canary: "# canary" }, bradbury: { canary: "# canary" } },
  };
  // A job exactly as an older version of the API would have stored it.
  const stored = (steps: Step[], owner = ALICE) => {
    const id = newId();
    const schedule = { everyMinutes: 5 };
    return repo.createJob({
      id, owner, name: "old", network: "bradbury", preset: null, schedule, steps, assertions: [], state: "active",
      system: false, public: false, poolId: poolIdFor(id), schedules: [initialSchedule(toSpec("job", schedule), now)],
    });
  };
  return { repo, deps, client, stored, setNow: (t: number) => (now = t) };
}

const write = (contract: string, extra: Record<string, unknown> = {}) => ({ id: "w", kind: "write", contract, method: "m", args: [], ...extra });
const body = (steps: unknown[], network = "bradbury") => ({ name: "j", network, schedule: { everyMinutes: 5 }, steps });

describe("a step never sends the relayer's GEN", () => {
  it("refuses a non-zero value at validation; 0 and empty mean no value", () => {
    expect(() => validateSteps([write(C1, { value: "1" })])).toThrow(/cannot send GEN/);
    expect(() => validateSteps([write(C1, { value: "9".repeat(40) })])).toThrow(/cannot send GEN/);
    expect(() => validateSteps([write(C1, { value: "1e18" })])).toThrow(/whole wei/);
    for (const value of ["0", "000", "", undefined]) {
      expect(validateSteps([write(C1, { value })])[0]).not.toHaveProperty("value");
    }
  });

  it("refuses it at create and at edit", async () => {
    const { deps } = setup();
    expect(await createJob(deps, ALICE, body([write(C1, { value: "5" })]))).toMatchObject({ ok: false, status: 400 });
    const made = await createJob(deps, ALICE, body([write(C1)]));
    if (!made.ok) throw new Error(made.error);
    expect(await editJob(deps, ALICE, made.value.id, { steps: [write(C1, { value: "5" })] })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a STORED job's value before signing: no tx, the run fails, later steps do not run", async () => {
    const { deps, client, repo, stored } = setup();
    await stored([
      { id: "pay", kind: "write", contract: C1, method: "pay", args: [], value: "1000000000000000000" },
      { id: "after", kind: "write", contract: C1, method: "after", args: [] },
    ]);
    await dispatchDue(deps);
    expect(client.writeContract).not.toHaveBeenCalled();
    expect(toPublicRun(repo.runs[0])).toMatchObject({ pass: false, steps: [{ stepId: "pay", status: "ERROR", error: expect.stringMatching(/cannot send GEN/) }] });
  });

  it("always submits with value 0", async () => {
    const { deps, client, stored } = setup();
    await stored([{ id: "w", kind: "write", contract: C1, method: "m", args: [], value: "0" }]);
    await dispatchDue(deps);
    expect(client.writeContract).toHaveBeenCalledWith(expect.objectContaining({ value: BigInt(0) }));
  });
});

describe("a user job cannot act as the relayer against system contracts", () => {
  it("lists the Heartbeat, the pools, the consensus contracts and UPTIME_BLOCKED_TARGETS", () => {
    const t = systemTargets();
    for (const a of [HEARTBEAT, POOL, POOL_V2, EXTRA, ...Object.values(BRADBURY_PHASE2.contracts)]) expect(t.has(a.toLowerCase())).toBe(true);
    expect(t.has(C1)).toBe(false);
    expect(t.has(WEBPROBE)).toBe(false); // presets stay callable, with the job's own id
    expect(systemTargets({}).size).toBe(Object.keys(BRADBURY_PHASE2.contracts).length); // nothing configured: fails closed on what is known
  });

  it("refuses a write to one at create and edit, whatever the address casing; reads stay allowed", async () => {
    const { deps } = setup();
    for (const a of [HEARTBEAT, HEARTBEAT.toLowerCase(), POOL, POOL_V2, EXTRA, BRADBURY_PHASE2.contracts.consensusMain]) {
      expect(await createJob(deps, BOB, body([write(a, { method: "bump", args: [1] })]))).toMatchObject({
        ok: false, status: 400, error: expect.stringMatching(/system contract/),
      });
    }
    const made = await createJob(deps, BOB, body([{ id: "r", kind: "read", contract: HEARTBEAT, method: "get_last_tick", args: [] }, write(C1)]));
    if (!made.ok) throw new Error(made.error);
    expect(await editJob(deps, BOB, made.value.id, { steps: [write(HEARTBEAT, { method: "probe", args: [1, "r1-extract"] })] })).toMatchObject({
      ok: false, status: 400,
    });
  });

  it("refuses a STORED job's write to the Heartbeat before signing", async () => {
    const { deps, client, repo, stored } = setup();
    await stored([{ id: "forge", kind: "write", contract: HEARTBEAT.toLowerCase(), method: "bump", args: [999] }], BOB);
    await dispatchDue(deps);
    expect(client.writeContract).not.toHaveBeenCalled();
    expect(toPublicRun(repo.runs[0])).toMatchObject({ pass: false, steps: [{ status: "ERROR", error: expect.stringMatching(/system contract/) }] });
  });

  it("checks the address a $deploy reference resolves to, and the relayer itself", () => {
    const step = { id: "w", kind: "write", contract: "$d.address", method: "m", args: [] } as Step;
    expect(callRefusal({ id: "j" }, step, HEARTBEAT, [], RELAYER)).toMatch(/system contract/);
    expect(callRefusal({ id: "j" }, step, RELAYER.toUpperCase().replace("0X", "0x"), [], RELAYER)).toMatch(/system contract/);
    expect(callRefusal({ id: "j" }, step, C1, [], RELAYER)).toBeNull();
    expect(callRefusal({ id: "j" }, { id: "r", kind: "read", contract: HEARTBEAT, method: "get_probe", args: [] }, HEARTBEAT, [], RELAYER)).toBeNull();
  });

  it("still runs the Foundation's own Heartbeat job", async () => {
    const { deps, repo, setNow } = setup();
    const hb = await ensureHeartbeatJob(repo, RELAYER, HEARTBEAT, T0);
    const tick = vi.fn(async () => ({ tick: 1, probes: [{ kind: "write", txHash: "0xb1" }] }));
    setNow(hb!.schedules[0].anchorAt);
    await dispatchDue({ ...deps, heartbeatTick: tick });
    expect(tick).toHaveBeenCalledOnce();
  });
});

describe("preset contracts file a run under the job's own id", () => {
  const check = (id: unknown, contract = WEBPROBE) => write(contract, { method: "check_url", args: [id, "{{run_id}}", "https://example.com", 0, ""] });

  it("requires {{job_id}} as the first argument at create and edit", async () => {
    const { deps } = setup();
    const other = newId();
    for (const bad of [other, "{{job_id}}x", "{{run_id}}", 7, undefined]) {
      expect(await createJob(deps, BOB, body([check(bad)]))).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/\{\{job_id\}\}/) });
    }
    expect(await createJob(deps, BOB, body([write(ASK, { method: "ask", args: [other, "{{run_id}}", "q", ""] })]))).toMatchObject({ ok: false, status: 400 });
    expect(await createJob(deps, BOB, body([write(ASK, { method: "ask", args: [] })]))).toMatchObject({ ok: false, status: 400 });
    const ok = await createJob(deps, BOB, body([check("{{job_id}}"), check("{{uptime_id}}", WEBPROBE.toUpperCase().replace("0X", "0x"))].map((s, i) => ({ ...s, id: `s${i}` }))));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await editJob(deps, BOB, ok.value.id, { steps: [check(other)] })).toMatchObject({ ok: false, status: 400 });
    expect(stepsRefusal([check("{{job_id}}", C1) as Step, check(other, C1) as Step])).toBeNull(); // other contracts: any args
  });

  it("refuses a STORED job that names another job's id, and signs its own id otherwise", async () => {
    const { deps, client, repo, stored } = setup();
    const victim = await stored([check("{{job_id}}") as Step], ALICE);
    await stored([check(victim.id) as Step], BOB);
    await dispatchDue(deps);
    expect(client.writeContract).toHaveBeenCalledTimes(1);
    expect(client.writeContract.mock.calls[0][0]).toMatchObject({ address: WEBPROBE, args: [victim.id, `job:${T0}`, "https://example.com", BigInt(0), ""] });
    const attack = repo.runs.find((r) => r.jobId !== victim.id)!;
    expect(toPublicRun(attack)).toMatchObject({ pass: false, steps: [{ status: "ERROR", error: expect.stringMatching(/this job's id/) }] });
  });
});

describe("per-wallet job quota on Bradbury", () => {
  it("defaults to 10 live jobs, frees a slot on delete, and is per wallet", async () => {
    const { deps } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const made = await createJob(deps, BOB, body([write(C1)]));
      if (!made.ok) throw new Error(made.error);
      ids.push(made.value.id);
    }
    expect(await createJob(deps, BOB, body([write(C1)]))).toMatchObject({ ok: false, status: 429, error: expect.stringMatching(/at most 10 jobs/) });
    expect((await createJob(deps, ALICE, body([write(C1)]))).ok).toBe(true);
    await deleteJob(deps, BOB, ids[0]);
    expect((await createJob(deps, BOB, body([write(C1)]))).ok).toBe(true);
  });

  it("follows BRADBURY_MAX_JOBS_PER_WALLET, ignores a bad value, and never counts system jobs", async () => {
    const { deps, repo } = setup();
    process.env.BRADBURY_MAX_JOBS_PER_WALLET = "1";
    await ensureHeartbeatJob(repo, BOB, HEARTBEAT, T0); // a system job owned by the same wallet
    expect((await createJob(deps, BOB, body([write(C1)]))).ok).toBe(true);
    expect(await createJob(deps, BOB, body([write(C1)]))).toMatchObject({ ok: false, status: 429 });
    process.env.BRADBURY_MAX_JOBS_PER_WALLET = "0";
    expect((await createJob(deps, BOB, body([write(C1)]))).ok).toBe(true); // back to the default of 10
  });
});

describe("FINALIZED is not agreement", () => {
  it("reads the consensus outcome from lifecycle or resultName", () => {
    expect(consensusOutcome({ resultName: "NO_MAJORITY", lifecycle: { state: "finalized", outcome: "undetermined" } })).toBe("undetermined");
    expect(consensusOutcome({ resultName: "NO_MAJORITY" })).toBe("undetermined");
    expect(consensusOutcome({ resultName: "MAJORITY_DISAGREE" })).toBe("undetermined");
    expect(consensusOutcome({ lifecycle: { outcome: "undetermined" } })).toBe("undetermined");
    expect(consensusOutcome({ resultName: "MAJORITY_TIMEOUT" })).toBe("timeout");
    expect(consensusOutcome({ resultName: "MAJORITY_AGREE", lifecycle: { outcome: "accepted" } })).toBe("accepted");
    expect(consensusOutcome({})).toBeNull();
    expect(consensusOutcome({ lifecycle: { state: "finalized" } })).toBeNull();
  });

  it("maps a FINALIZED tx by its outcome and leaves every other status alone", () => {
    expect(stepStatus("FINALIZED", "undetermined")).toBe("UNDETERMINED");
    expect(stepStatus("FINALIZED", "timeout")).toBe("TIMEOUT");
    expect(stepStatus("FINALIZED", "accepted")).toBe("FINALIZED");
    expect(stepStatus("FINALIZED", null)).toBe("FINALIZED");
    expect(stepStatus("FINALIZED")).toBe("FINALIZED");
    expect(stepStatus("ACCEPTED", "undetermined")).toBe("ACCEPTED"); // the stored decision stands until it finalizes
    expect(stepStatus("PROPOSING", "undetermined")).toBeNull();
    expect(settledStatus("UNDETERMINED", null)).toBe("UNDETERMINED");
  });

  it("fails a run whose tx finalized with no majority, and does not run its next step", async () => {
    const { deps, client, repo, stored } = setup();
    await stored([
      { id: "a", kind: "write", contract: C1, method: "a", args: [] },
      { id: "b", kind: "write", contract: C1, method: "b", args: [] },
    ]);
    // The real shape: prod tx 0xb702334f… (Heartbeat tick 67, r8-shot).
    client.getTransaction.mockResolvedValue(
      tx({ statusName: "FINALIZED", resultName: "NO_MAJORITY", lifecycle: { state: "finalized", outcome: "undetermined" }, numOfRounds: "2" })
    );
    await dispatchDue(deps);
    await reconcile(deps);
    expect(client.writeContract).toHaveBeenCalledTimes(1);
    const run = toPublicRun(repo.runs[0]);
    expect(run).toMatchObject({ pass: false, steps: [{ stepId: "a", status: "UNDETERMINED", error: "validators did not reach a majority" }] });
    expect(run.steps[0].timeToAcceptedMs).toBeUndefined();
    expect(repo.runs[0].steps[0].chainStatus).toBe("FINALIZED");
  });

  it("passes a run whose tx finalized with a majority", async () => {
    const { deps, client, repo, stored } = setup();
    await stored([{ id: "a", kind: "write", contract: C1, method: "a", args: [] }]);
    client.getTransaction.mockResolvedValue(tx({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", lifecycle: { state: "finalized", outcome: "accepted" } }));
    await dispatchDue(deps);
    await reconcile(deps);
    expect(toPublicRun(repo.runs[0])).toMatchObject({ pass: true, steps: [{ status: "FINALIZED" }] });
  });

  it("fails the Heartbeat run when one of its probes finalized with no majority", async () => {
    const { deps, client, repo, setNow } = setup();
    const hb = await ensureHeartbeatJob(repo, RELAYER, HEARTBEAT, T0);
    const tick = async () => ({ tick: 67, probes: [{ kind: "write", txHash: "0xb1" }, { kind: "llm", qid: "r8-shot", txHash: "0xl1" }] });
    client.getTransaction.mockImplementation(async (a?: { hash: string }) =>
      a?.hash === "0xl1" ? tx({ statusName: "FINALIZED", resultName: "NO_MAJORITY" }) : tx({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE" })
    );
    setNow(hb!.schedules[0].anchorAt);
    await dispatchDue({ ...deps, heartbeatTick: tick });
    await reconcile(deps);
    expect(toPublicRun(repo.runs[0])).toMatchObject({ pass: false, steps: [{ status: "FINALIZED" }, { stepId: "probe", status: "UNDETERMINED" }] });
  });
});
