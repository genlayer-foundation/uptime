// The Bradbury Heartbeat runner (tick + reconcile) and summary, against a fake
// chain client and an in-memory store. No network, no database.
import { describe, expect, it } from "vitest";
import { POOL, PROBE_SET, appealDue, rotation } from "@/lib/heartbeat/probes";
import { runReconcile, runTick, tickPlan, type RunnerClient, type RunnerDeps, type RunnerTx } from "@/lib/heartbeat/runner";
import { latestRun, runsSummary, summarize } from "@/lib/heartbeat/summary";
import type { ProbeRecord } from "@/lib/heartbeat/types";

const CONTRACT = "0x00000000000000000000000000000000000000c0" as const;
const CANARY = "0x00000000000000000000000000000000000000ca";

function memStore() {
  let tick = 0;
  const pending = new Map<string, ProbeRecord>();
  const results: ProbeRecord[] = [];
  return {
    pending,
    results,
    nextTick: async () => ++tick,
    addPending: async (r: ProbeRecord) => void pending.set(r.id, JSON.parse(JSON.stringify(r))),
    getPending: async () => [...pending.values()].map((r) => JSON.parse(JSON.stringify(r)) as ProbeRecord),
    resolve: async (r: ProbeRecord) => {
      pending.delete(r.id);
      results.push(JSON.parse(JSON.stringify(r)));
    },
  };
}

interface Fake extends RunnerClient {
  sent: Array<{ fn: string; args: unknown[] }>;
  txs: Map<string, RunnerTx>;
  views: Map<string, unknown>; // `${fn}:${JSON args}` -> value
  appeals: string[];
  failOn?: string;
}

function fakeClient(): Fake {
  let n = 0;
  const hash = () => `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`;
  const f: Fake = {
    sent: [],
    txs: new Map(),
    views: new Map(),
    appeals: [],
    async deployContract({ args }) {
      if (f.failOn === "deploy") throw new Error("nonce too low");
      f.sent.push({ fn: "deploy", args });
      return hash();
    },
    async writeContract({ functionName, args }) {
      if (f.failOn === functionName) throw new Error("rpc down");
      f.sent.push({ fn: functionName, args });
      return hash();
    },
    async readContract({ functionName, args }) {
      const k = `${functionName}:${JSON.stringify(args, (_, v) => (typeof v === "bigint" ? Number(v) : v))}`;
      if (!f.views.has(k)) throw new Error(`no view ${k}`);
      return f.views.get(k);
    },
    async getTransaction({ hash: h }) {
      const tx = f.txs.get(h);
      if (!tx) throw new Error("not found");
      return tx;
    },
    async getMinAppealBond() {
      return 7n;
    },
    async appealTransaction({ txId, value }) {
      expect(value).toBe(7n);
      f.appeals.push(txId);
      return "0xappeal";
    },
  };
  return f;
}

function setup(now = 1_900_000_000) {
  const store = memStore();
  const client = fakeClient();
  const clock = { now };
  const deps: RunnerDeps = { contract: CONTRACT, client: () => client, reader: () => client, store, now: () => clock.now };
  return { store, client, clock, deps };
}

const decided = (status: string, extra: Partial<RunnerTx> = {}): RunnerTx => ({
  statusName: status,
  createdTimestamp: "1900000000",
  lastVoteTimestamp: "1900000090",
  numOfRounds: "1",
  lastRound: { validatorVotesName: ["AGREE", "AGREE", "AGREE", "AGREE", "DISAGREE"] },
  ...extra,
});

describe("probe rotation and appeals", () => {
  it("rotates 2 of 9 per tick, in pool order", () => {
    expect(rotation(1).map((p) => p.id)).toEqual(["r1-extract", "r2-answer42"]);
    expect(rotation(5).map((p) => p.id)).toEqual(["r9-namesake", "r1-extract"]);
    const seen = new Set<string>();
    for (let t = 1; t <= 9; t++) rotation(t).forEach((p) => seen.add(p.id));
    expect(seen.size).toBe(9);
  });

  it("appeals the first rotating probe every 5th tick, cycling through all 9", () => {
    const appealed: string[] = [];
    for (let tick = 1; tick <= 45; tick++) {
      rotation(tick).forEach((p, i) => {
        if (appealDue(tick, i)) appealed.push(p.id);
      });
    }
    expect(appealed).toHaveLength(9);
    expect(new Set(appealed).size).toBe(9);
    // m-th appeal (tick 5m) hits index (m - 2) mod 9
    appealed.forEach((id, k) => expect(id).toBe(POOL[(((k + 1 - 2) % 9) + 9) % 9].id));
    // an every-6th rule would only ever reach 3 of them
    const six = new Set<string>();
    for (let tick = 6; tick <= 6 * 50; tick += 6) six.add(rotation(tick)[0].id);
    expect(six.size).toBe(3);
  });

  it("plans deploy, write, F0 and the two rotating probes each tick", () => {
    const plan = tickPlan(10, 100);
    expect(plan.map((r) => r.id)).toEqual(["10:deploy:", "10:write:", "10:fetch:f0-status", "10:llm:r1-extract", "10:llm:r2-answer42"]);
    expect(plan.map((r) => r.type)).toEqual(["deploy", "write", "web", "web", "llm"]);
    expect(plan.filter((r) => r.appealDue).map((r) => r.id)).toEqual(["10:llm:r1-extract"]);
    expect(tickPlan(11, 100).some((r) => r.appealDue)).toBe(false);
  });

  it("the catalogue holds F0 + nine probes and the five types", () => {
    expect(PROBE_SET.map((p) => p.id)).toEqual(["f0-status", ...POOL.map((p) => p.id)]);
    expect(new Set(PROBE_SET.map((p) => p.type))).toEqual(new Set(["web", "llm", "image"]));
  });
});

describe("runTick", () => {
  it("submits the five txs with the right methods and leaves them pending", async () => {
    const { store, client, deps } = setup();
    const recs = await runTick(deps);
    expect(client.sent).toEqual([
      { fn: "deploy", args: [1n] },
      { fn: "bump", args: [1n] },
      { fn: "probe_status", args: [1n] },
      { fn: "probe", args: [1n, "r1-extract"] },
      { fn: "probe", args: [1n, "r2-answer42"] },
    ]);
    expect(recs.every((r) => r.txHash)).toBe(true);
    expect(store.pending.size).toBe(5);
  });

  it("records a failed submit as SUBMIT_FAILED and keeps going", async () => {
    const { store, client, deps } = setup();
    client.failOn = "bump";
    await runTick(deps);
    expect(store.results.map((r) => [r.id, r.status, r.error])).toEqual([["1:write:", "SUBMIT_FAILED", "rpc down"]]);
    expect(store.pending.size).toBe(4);
  });
});

describe("runReconcile", () => {
  async function ticked(tickNo = 1) {
    const s = setup();
    for (let i = 0; i < tickNo; i++) await runTick(s.deps);
    s.store.pending.clear();
    s.client.sent = [];
    // re-submit only the last tick, so tests see exactly one tick pending
    s.store.results.length = 0;
    return s;
  }

  it("copies the contract's on-chain grade and answer, and measures latency/votes", async () => {
    const { store, client, deps } = setup();
    const [, , f0, r1, r2] = await runTick(deps);
    client.txs.set(f0.txHash!, decided("ACCEPTED"));
    client.txs.set(r1.txHash!, decided("ACCEPTED"));
    client.txs.set(r2.txHash!, decided("ACCEPTED"));
    client.views.set('get_probe:["1:f0-status"]', { tick: 1, pid: "f0-status", answer: '{"answer": 42, "network": "bradbury"}', grade: "correct", error: "" });
    client.views.set('get_probe:["1:r1-extract"]', { tick: 1, pid: "r1-extract", answer: "", grade: "", error: "[EXTERNAL] fixture drift: primer.html lacks HB2-primer" });
    client.views.set('get_probe:["1:r2-answer42"]', new Map<string, unknown>([["answer", "54"], ["grade", "wrong"], ["error", ""]]));
    const rep = await runReconcile(deps);
    expect(rep).toEqual({ resolved: 3, pending: 2 });
    const by = Object.fromEntries(store.results.map((r) => [r.id, r]));
    expect(by["1:fetch:f0-status"]).toMatchObject({ status: "ACCEPTED", grade: "correct", latencySec: 90, rounds: 1, votes: { agree: 4, disagree: 1 } });
    expect(by["1:llm:r1-extract"].grade).toBeUndefined();
    expect(by["1:llm:r1-extract"].error).toMatch(/fixture drift/);
    expect(by["1:llm:r2-answer42"]).toMatchObject({ answer: "54", grade: "wrong" });
  });

  it("counts Phase 2 vote names (FINISHED_WITH_*, NONDET_DISAGREE, TIMEOUT)", async () => {
    const { store, client, deps } = setup();
    const [, , f0] = await runTick(deps);
    client.txs.set(
      f0.txHash!,
      decided("ACCEPTED", {
        lastRound: {
          validatorVotesName: ["FINISHED_WITH_RETURN", "FINISHED_WITH_RETURN", "FINISHED_WITH_ERROR", "NONDET_DISAGREE", "TIMEOUT", "NOT_VOTED"],
        },
      })
    );
    client.views.set('get_probe:["1:f0-status"]', { answer: "x", grade: "correct", error: "" });
    await runReconcile(deps);
    const f = store.results.find((r) => r.id === "1:fetch:f0-status");
    expect(f?.votes).toEqual({ agree: 3, disagree: 1, timeout: 1, other: 1 });
  });

  it("grades the write probe by get_last_tick, or get_bump when a later bump landed", async () => {
    const { store, client, deps } = setup();
    const [, w] = await runTick(deps);
    client.txs.set(w.txHash!, decided("ACCEPTED"));
    client.views.set("get_last_tick:[]", 3);
    client.views.set("get_bump:[1]", 1);
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "write")).toMatchObject({ grade: "correct", answer: "3" });
  });

  it("marks a write wrong when the contract never saw it", async () => {
    const { store, client, deps } = setup();
    const [, w] = await runTick(deps);
    client.txs.set(w.txHash!, decided("ACCEPTED"));
    client.views.set("get_last_tick:[]", 0);
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "write")?.grade).toBe("wrong");
  });

  it("keeps a deploy pending after ACCEPTED, then records time to FINALIZED", async () => {
    const { store, client, clock, deps } = setup();
    const [d] = await runTick(deps);
    client.txs.set(d.txHash!, decided("ACCEPTED", { recipient: CANARY }));
    client.views.set("get_tick:[]", 1);
    clock.now = 1_900_000_600;
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "deploy")).toBeUndefined();
    const p = store.pending.get("1:deploy:")!;
    expect(p).toMatchObject({ status: "ACCEPTED", latencySec: 90, acceptedAt: 1_900_000_600, grade: "correct", answer: "1" });

    client.txs.set(d.txHash!, decided("FINALIZED", { recipient: CANARY }));
    clock.now = 1_900_002_400;
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "deploy")).toMatchObject({
      status: "FINALIZED",
      latencySec: 90,
      finalizedSec: 2400,
      grade: "correct",
    });
  });

  it("resolves an UNDETERMINED deploy at once, and times out undecided txs after 6h", async () => {
    const { store, client, clock, deps } = setup();
    const [d, w] = await runTick(deps);
    client.txs.set(d.txHash!, decided("UNDETERMINED"));
    client.txs.set(w.txHash!, { statusName: "PROPOSING" });
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "deploy")?.status).toBe("UNDETERMINED");
    clock.now += 6 * 3600 + 1;
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "write")).toMatchObject({ status: "PROPOSING", error: "no decision after 6h" });
  });

  async function appealTick(statusFirst: string) {
    const s = setup();
    for (let i = 0; i < 4; i++) await runTick(s.deps); // ticks 1..4
    s.store.pending.clear();
    s.store.results.length = 0;
    const recs = await runTick(s.deps); // tick 5: first rotating probe is appealed
    const first = recs[3];
    expect(first.appealDue).toBe(true);
    s.client.txs.set(first.txHash!, decided(statusFirst));
    s.client.views.set(`get_probe:["5:${first.qid}"]`, { answer: "42", grade: "correct", error: "" });
    await runReconcile(s.deps);
    return { ...s, first };
  }

  it("appeals the due probe once ACCEPTED, and calls it upheld when the new round agrees", async () => {
    const { store, client, deps, first } = await appealTick("ACCEPTED");
    expect(client.appeals).toEqual([first.txHash]);
    const ap = store.pending.get(`5:appeal:${first.qid}`)!;
    expect(ap).toMatchObject({ kind: "appeal", type: first.type, statusBefore: "ACCEPTED", answerBefore: "42", gradeBefore: "correct", rounds: 1 });
    // still 1 round: not settled
    await runReconcile(deps);
    expect(store.pending.has(ap.id)).toBe(true);
    client.txs.set(first.txHash!, decided("ACCEPTED", { numOfRounds: "2" }));
    await runReconcile(deps);
    expect(store.results.find((r) => r.id === ap.id)).toMatchObject({ outcome: "upheld", rounds: 2, grade: "correct" });
  });

  it("calls an appeal overturned when the answer changes", async () => {
    const { store, client, deps, first } = await appealTick("ACCEPTED");
    client.txs.set(first.txHash!, decided("ACCEPTED", { numOfRounds: "2" }));
    client.views.set(`get_probe:["5:${first.qid}"]`, { answer: "41", grade: "wrong", error: "" });
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "appeal")?.outcome).toBe("overturned");
  });

  it("appeals an UNDETERMINED probe too, and calls it withdrawn if it finalizes with no new round", async () => {
    const { store, client, deps, first } = await appealTick("UNDETERMINED");
    expect(client.appeals).toEqual([first.txHash]);
    client.txs.set(first.txHash!, decided("FINALIZED", { numOfRounds: "1" }));
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "appeal")).toMatchObject({ outcome: "withdrawn", status: "FINALIZED" });
  });

  it("records a probe that FINALIZED with no majority as UNDETERMINED, ungraded, and does not appeal it", async () => {
    const s = setup();
    for (let i = 0; i < 4; i++) await runTick(s.deps);
    s.store.pending.clear();
    s.store.results.length = 0;
    const recs = await runTick(s.deps);
    const [d, w, , first, second] = recs;
    // The real shape: prod tx 0xb702334f… (tick 67, r8-shot): FINALIZED, NO_MAJORITY.
    const noMajority = { resultName: "NO_MAJORITY", lifecycle: { state: "finalized", outcome: "undetermined" } };
    s.client.txs.set(first.txHash!, decided("FINALIZED", noMajority));
    s.client.txs.set(second.txHash!, decided("FINALIZED", { resultName: "MAJORITY_AGREE", lifecycle: { state: "finalized", outcome: "accepted" } }));
    s.client.txs.set(d.txHash!, decided("FINALIZED", noMajority));
    s.client.txs.set(w.txHash!, decided("FINALIZED", { resultName: "MAJORITY_TIMEOUT" }));
    s.client.views.set(`get_probe:["5:${first.qid}"]`, {}); // nothing stored: the state was not applied
    s.client.views.set(`get_probe:["5:${second.qid}"]`, { answer: "42", grade: "correct", error: "" });
    await runReconcile(s.deps);
    const by = (id: string) => s.store.results.find((r) => r.id === id)!;
    expect(by(first.id)).toMatchObject({ status: "UNDETERMINED" });
    expect(by(first.id).grade).toBeUndefined();
    expect(by(second.id)).toMatchObject({ status: "FINALIZED", grade: "correct" });
    expect(by(d.id)).toMatchObject({ status: "UNDETERMINED" });
    expect(by(d.id).grade).toBeUndefined();
    expect(by(w.id)).toMatchObject({ status: "VALIDATORS_TIMEOUT" });
    expect(by(w.id).grade).toBeUndefined();
    // Finalized: there is no decision left to appeal, so no appeal is attempted.
    expect(s.client.appeals).toEqual([]);
    expect(s.store.results.some((r) => r.kind === "appeal")).toBe(false);
    // /api/heartbeat counts them where it always counted a missing majority.
    const { byKind } = summarize(s.store.results);
    expect(byKind.llm).toMatchObject({ total: 2, accepted: 1, undetermined: 1, correct: 1 });
    expect(byKind.deploy).toMatchObject({ accepted: 0, undetermined: 1 });
    expect(byKind.write).toMatchObject({ accepted: 0, timedOut: 1 });
  });

  it("settles a withdrawn appeal when the tx finalized with no majority and no new round", async () => {
    const { store, client, deps, first } = await appealTick("UNDETERMINED");
    client.txs.set(first.txHash!, decided("FINALIZED", { numOfRounds: "1", resultName: "NO_MAJORITY" }));
    await runReconcile(deps);
    expect(store.results.find((r) => r.kind === "appeal")).toMatchObject({ outcome: "withdrawn", status: "UNDETERMINED" });
  });

  it("does not appeal a probe that is not due", async () => {
    const { client, deps } = await ticked();
    const recs = await runTick(deps);
    for (const r of recs) client.txs.set(r.txHash!, decided("ACCEPTED", { recipient: CANARY }));
    client.views.set("get_tick:[]", 2);
    client.views.set("get_last_tick:[]", 2);
    for (const r of recs) if (r.qid) client.views.set(`get_probe:["2:${r.qid}"]`, { answer: "x", grade: "wrong", error: "" });
    await runReconcile(deps);
    expect(client.appeals).toEqual([]);
  });
});

describe("summarize", () => {
  const r = (over: Partial<ProbeRecord> & Pick<ProbeRecord, "id" | "kind" | "type">): ProbeRecord => ({ tick: 1, submittedAt: 3600, status: "ACCEPTED", ...over });

  it("counts by test type, by probe and appeals separately", () => {
    const recs: ProbeRecord[] = [
      r({ id: "1:deploy:", kind: "deploy", type: "deploy", status: "FINALIZED", grade: "correct", latencySec: 30, finalizedSec: 1800 }),
      r({ id: "1:write:", kind: "write", type: "write", grade: "correct" }),
      r({ id: "1:fetch:f0-status", kind: "fetch", type: "web", qid: "f0-status", grade: "correct" }),
      r({ id: "1:llm:r6-injection", kind: "llm", type: "web", qid: "r6-injection", grade: "injected" }),
      r({ id: "1:llm:r7-card", kind: "llm", type: "image", qid: "r7-card", error: "[EXTERNAL] fixture drift: card.png lacks sha256 8cb0b2d27884" }),
      r({ id: "1:llm:r2-answer42", kind: "llm", type: "llm", qid: "r2-answer42", status: "UNDETERMINED" }),
      r({ id: "1:appeal:r2-answer42", kind: "appeal", type: "llm", qid: "r2-answer42", outcome: "upheld" }),
      r({ id: "2:appeal:r7-card", kind: "appeal", type: "image", qid: "r7-card", outcome: "withdrawn", status: "FINALIZED" }),
    ];
    const s = summarize(recs);
    expect(s.byType.deploy).toMatchObject({ total: 1, correct: 1, finalizedP50: 1800, latencyP50: 30 });
    expect(s.byType.web).toMatchObject({ total: 2, graded: 2, correct: 1, injected: 1 });
    expect(s.byType.image).toMatchObject({ total: 1, graded: 0, errored: 1 });
    expect(s.byType.llm).toMatchObject({ total: 1, undetermined: 1 });
    expect(s.appeals).toMatchObject({ total: 2, upheld: 1, withdrawn: 1, overturned: 0 });
    expect(s.appealsByProbe["r7-card"].withdrawn).toBe(1);
    expect(Object.keys(s.byProbe).sort()).toEqual(["f0-status", "r2-answer42", "r6-injection", "r7-card"]);
    expect(s.series).toHaveLength(1);
    expect(s.series[0].appeal.total).toBe(2);
    expect(s.series[0].web.total).toBe(2);
  });
});

describe("runsSummary", () => {
  const H = 3600;
  const run = (tick: number, over: Partial<ProbeRecord>[] = []): ProbeRecord[] =>
    (["deploy", "write", "fetch", "llm", "llm"] as const).map((kind, i) => ({
      id: `${tick}:${kind}:${i}`,
      tick,
      kind,
      type: "web",
      submittedAt: tick * H + 5,
      status: "FINALIZED",
      grade: "correct",
      ...over[i],
    }));

  it("keeps our misses apart from network failures, and counts hours that never ran", () => {
    const results = [
      ...run(10, [{ status: "SUBMIT_FAILED", grade: undefined }, { status: "SUBMIT_FAILED", grade: undefined }, { status: "SUBMIT_FAILED", grade: undefined }, { status: "SUBMIT_FAILED", grade: undefined }, { status: "SUBMIT_FAILED", grade: undefined }]),
      ...run(11),
      ...run(12, [{}, {}, {}, { grade: "wrong" }]),
      // tick 13 never ran
      ...run(14, [{}, { status: "SUBMIT_FAILED", grade: undefined }]),
    ];
    const pending: ProbeRecord[] = run(15).map((r) => ({ ...r, status: undefined, grade: undefined }));
    const s = runsSummary(results, pending, 15 * H + 1200);
    expect(s).toMatchObject({ runs: 5, passed: 1, failed: 1, missed: 3, missedSlots: 1, pending: 1 });
    expect(s.actionsCorrect).toBe(13);
    expect(s.actionsGraded).toBe(14);
    expect(s.lastRunAt).toBe(15 * H + 5);
    expect(s.lastCompleted).toMatchObject({ tick: 14, outcome: "missed", notSent: 1 });
    const l = latestRun(results, pending)!;
    expect(l.tick).toBe(15);
    expect(l.actions.map((a) => a.kind)).toEqual(["deploy", "write", "fetch", "llm", "llm"]);
  });

  it("is empty without runs", () => {
    expect(runsSummary([], [], 100)).toMatchObject({ runs: 0, missed: 0, lastRunAt: null, lastCompleted: null });
    expect(latestRun([], [])).toBeNull();
  });
});

describe("demo data", () => {
  it("uses the runner's shapes: five types, appeals with outcomes, on-chain style grades", async () => {
    const { demoSnapshot } = await import("@/lib/heartbeat/demo");
    const now = Math.floor(Date.UTC(2026, 10, 2, 12) / 1000);
    const { results } = demoSnapshot(now - 720 * 3600, now);
    const s = summarize(results);
    for (const t of ["deploy", "write", "llm", "web", "image"] as const) expect(s.byType[t].total).toBeGreaterThan(0);
    expect(s.appeals.upheld + s.appeals.overturned + s.appeals.withdrawn).toBeGreaterThan(0);
    expect(results.some((x) => x.grade === "injected")).toBe(true);
    expect(results.some((x) => x.error?.includes("fixture drift"))).toBe(true);
    expect(results.filter((x) => x.kind === "deploy" && x.status === "FINALIZED").every((x) => x.finalizedSec! > 0)).toBe(true);
    // deterministic
    expect(JSON.stringify(demoSnapshot(now - 720 * 3600, now))).toBe(JSON.stringify({ results, pending: demoSnapshot(now - 720 * 3600, now).pending }));
  });
});
