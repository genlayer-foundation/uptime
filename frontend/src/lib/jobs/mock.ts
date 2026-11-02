// DEV-ONLY mock of the jobs API, loaded by ./client.ts when
// NEXT_PUBLIC_JOBS_MOCK=1. It answers the same routes as the backend
// (lib/jobs/types.ts contract) from browser memory, persisted to
// localStorage so created jobs survive a reload. Runs are generated
// deterministically from each job's schedule up to "now", so the pages
// show a realistic, living history: mostly ACCEPTED, with undetermined
// rounds, timeouts, submit failures and one outage window.
//
// It also simulates the UptimePool for the funding UI (`mockPool`), so the
// mock never asks a wallet to send anything. Nothing here ships to users
// unless the flag is set at build time.

import type { Assertion, Job, Run, Step, StepRun } from "./types";
import type { Preset, PresetsResponse, RunRow } from "./client";
import { evaluate } from "@/components/jobs/assert";
import { firingsBetween } from "@/components/jobs/schedule";

const KEY = "jobs-mock-v1";
const SAMPLE_OWNER = "0x0000000000000000000000000000000000005a3e";
const DAY = 86_400_000;

type PoolState = { owner: string; paused: boolean; balanceWei: string; perRunWei: string; perDayWei: string };
type State = { wallet: string | null; jobs: Job[]; pools: Record<string, PoolState> };

const WEBPROBE = "0x7E1a0b5c3D9f2A4e6B8c0D1E2f3A4b5C6d7E8f90";
const ASK = "0x3a5C7e9B1d3F5a7C9e1B3d5F7a9C1e3B5d7F9a1C";
const ORACLE = "0xB0b0000000000000000000000000000000c0FFee";

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function poolId(seed: string): string {
  let h = "";
  for (let i = 0; h.length < 64; i++) h += hash(`${seed}:${i}`).toString(16).padStart(8, "0");
  return `0x${h.slice(0, 64)}`;
}

function seed(): State {
  const jobs: Job[] = [
    {
      id: "job_docs_up",
      owner: SAMPLE_OWNER,
      name: "Docs site is up",
      network: "studio",
      preset: "check-url",
      schedule: { everyMinutes: 10 },
      steps: [
        { id: "probe", kind: "write", contract: WEBPROBE, method: "check_url", args: ["https://docs.genlayer.com", 200, "GenLayer"] },
      ],
      assertions: [{ step: "probe", path: "ok", op: "eq", expected: true }],
      paused: false,
      public: true,
      createdAt: hoursAgo(72),
    },
    {
      id: "job_canary_chain",
      owner: SAMPLE_OWNER,
      name: "Canary deploy + bump",
      network: "bradbury",
      preset: "deploy-then-call",
      schedule: { everyMinutes: 5 },
      steps: [
        { id: "deploy", kind: "deploy", preset: "canary-v2", args: [], schedule: { cron: "0 * * * *" } },
        { id: "bump", kind: "write", contract: "$deploy.address", method: "bump", args: ["{{run_id}}"] },
        { id: "count", kind: "read", contract: "$deploy.address", method: "get_count", args: [] },
      ],
      assertions: [
        { step: "count", op: "gte", expected: 1 },
        { step: "bump", path: "status", op: "eq", expected: "ok" },
      ],
      poolId: poolId("job_canary_chain"),
      paused: false,
      createdAt: hoursAgo(50),
    },
    {
      id: "job_oracle",
      owner: SAMPLE_OWNER,
      name: "Price oracle answers",
      network: "bradbury",
      preset: "ask",
      schedule: { cron: "*/15 * * * *" },
      steps: [
        { id: "ask", kind: "write", contract: ASK, method: "ask", args: ["What is the GEN/USD price on the page? Answer a number.", "https://example.com/price"] },
        { id: "read", kind: "read", contract: ASK, method: "last_answer", args: ["{{job_id}}"] },
      ],
      assertions: [
        { step: "read", path: "answer", op: "gt", expected: 0 },
        { step: "ask", path: "agreement", op: "gte", expected: 0.6 },
      ],
      poolId: poolId("job_oracle"),
      paused: false,
      createdAt: hoursAgo(30),
    },
    {
      id: "job_status_api",
      owner: SAMPLE_OWNER,
      name: "Status API reports healthy",
      network: "studio",
      preset: "check-api",
      schedule: { everyMinutes: 30 },
      steps: [
        { id: "api", kind: "write", contract: WEBPROBE, method: "check_api", args: ["https://status.example.com/api.json", "status.indicator", "eq", "none"] },
      ],
      assertions: [{ step: "api", path: "ok", op: "eq", expected: true }],
      paused: true,
      createdAt: hoursAgo(120),
    },
    {
      id: "job_public_view",
      owner: "0x1111111111111111111111111111111111111111",
      name: "Bradbury Heartbeat canary (Foundation)",
      network: "bradbury",
      preset: "heartbeat",
      schedule: { everyMinutes: 60 },
      steps: [{ id: "canary", kind: "deploy", preset: "canary", args: [] }],
      assertions: [{ step: "canary", path: "address", op: "exists" }],
      paused: false,
      public: true,
      createdAt: hoursAgo(200),
    },
  ];
  const g = (x: number) => (BigInt(Math.round(x * 1e6)) * 10n ** 12n).toString();
  return {
    wallet: null,
    jobs,
    pools: {
      [jobs[1].poolId!]: { owner: SAMPLE_OWNER, paused: false, balanceWei: g(4.25), perRunWei: g(0.002), perDayWei: g(0.6) },
      [jobs[2].poolId!]: { owner: SAMPLE_OWNER, paused: false, balanceWei: g(0.31), perRunWei: g(0.003), perDayWei: g(0.3) },
    },
  };
}

let state: State | null = null;

function load(): State {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    state = raw ? (JSON.parse(raw) as State) : seed();
  } catch {
    state = seed();
  }
  return state;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: state lives for this tab only */
  }
}

/** Forget every mock change (exposed on window.__jobsMockReset in dev). */
export function resetMock() {
  state = seed();
  save();
}

// ---------------------------------------------------------------- determinism

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 finalizer: FNV alone correlates on keys that differ in the last chars.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const rand = (s: string) => hash(s) / 0xffffffff;

function hex(seed: string, len: number) {
  let out = "";
  for (let i = 0; out.length < len; i++) out += hash(`${seed}#${i}`).toString(16).padStart(8, "0");
  return `0x${out.slice(0, len)}`;
}

// A step with its own schedule appears only in the job slots it also fires in.
function stepDue(step: Step, slot: Date): boolean {
  if (!step.schedule) return true;
  const own = firingsBetween(step.schedule, new Date(slot.getTime() - 60_000), slot, 1);
  return own.length > 0 && own[own.length - 1].getTime() === slot.getTime();
}

function fakeResult(job: Job, step: Step, key: string, slotIdx: number): unknown {
  const r = rand(`${key}:res`);
  if (step.kind === "deploy") return { address: hex(`${key}:addr`, 40) };
  if (step.kind === "read") {
    if (step.method === "get_count") return 1 + (slotIdx % 12);
    if (step.method === "last_answer") return { answer: r < 0.01 ? 0 : Number((0.4 + r * 0.05).toFixed(4)) };
    return Math.round(r * 1000);
  }
  if (step.method === "check_url" || step.method === "check_api") {
    const ok = r > 0.015;
    return { ok, status_class: ok ? "2xx" : "5xx", contains: ok };
  }
  if (step.method === "ask") return { answer: (0.4 + r * 0.05).toFixed(4), agreement: r < 0.03 ? 0.4 : 0.8 + r * 0.2, rounds: r < 0.1 ? 2 : 1 };
  return { status: "ok" };
}

function makeRun(job: Job, slot: Date, slotIdx: number, now: number): Run {
  const key = `${job.id}:${slot.getTime()}`;
  const age = now - slot.getTime();
  // An outage on Bradbury about 30h ago, 3h long: rounds time out.
  const outage = job.network === "bradbury" && age > 27 * 3_600_000 && age < 30 * 3_600_000;
  const steps: StepRun[] = [];
  let broken = false;
  for (const step of job.steps) {
    if (!stepDue(step, slot)) continue;
    const sk = `${key}:${step.id}`;
    if (broken) {
      steps.push({ stepId: step.id, status: "ERROR", error: "skipped: an earlier step failed" });
      continue;
    }
    if (age < 90_000) {
      steps.push({ stepId: step.id, status: "PENDING", txHash: step.kind === "read" ? undefined : hex(`${sk}:tx`, 64) });
      continue;
    }
    const r = rand(sk);
    let status: StepRun["status"] = "ACCEPTED";
    if (outage && step.kind !== "read") status = r < 0.7 ? "TIMEOUT" : "ACCEPTED";
    else if (r < 0.015) status = "UNDETERMINED";
    else if (r < 0.025) status = "TIMEOUT";
    else if (r < 0.03) status = "SUBMIT_FAILED";
    else if (age > 2 * 3_600_000 && step.kind !== "read") status = "FINALIZED";

    const ttaBase = step.kind === "deploy" ? 14_000 : step.kind === "read" ? 300 : job.preset === "ask" ? 38_000 : 22_000;
    const tta = Math.round(ttaBase * (0.6 + rand(`${sk}:t`) * 0.9) * (outage ? 2.5 : 1));
    const sr: StepRun = { stepId: step.id, status };
    if (step.kind !== "read" && status !== "SUBMIT_FAILED") sr.txHash = hex(`${sk}:tx`, 64);
    if (status === "ACCEPTED" || status === "FINALIZED" || status === "UNDETERMINED") {
      sr.timeToAcceptedMs = tta;
      sr.result = status === "UNDETERMINED" ? undefined : fakeResult(job, step, sk, slotIdx);
    }
    if (step.kind !== "read" && sr.txHash) sr.gasGen = (0.0000041 + rand(`${sk}:g`) * 0.000003).toFixed(7);
    if (status === "TIMEOUT") sr.error = "no decision within 6 h";
    if (status === "SUBMIT_FAILED") sr.error = "nonce too low (relayer resubmits next slot)";
    if (status === "UNDETERMINED") sr.error = "validators did not agree after 3 rounds";
    if (!["ACCEPTED", "FINALIZED"].includes(status)) broken = true;
    steps.push(sr);
  }

  let pass: boolean | null;
  if (steps.some((s) => s.status === "PENDING")) pass = null;
  else if (steps.some((s) => !["ACCEPTED", "FINALIZED"].includes(s.status))) pass = false;
  else {
    const byStep = new Map(steps.map((s) => [s.stepId, s]));
    const relevant = job.assertions.filter((a: Assertion) => byStep.has(a.step));
    pass = relevant.every((a) => evaluate(a, byStep.get(a.step)!.result));
  }
  return { id: `run_${hash(key).toString(36)}`, jobId: job.id, startedAt: slot.toISOString(), steps, pass };
}

function runsFor(job: Job, limit: number): Run[] {
  const now = Date.now();
  const from = new Date(Math.max(Date.parse(job.createdAt), now - 14 * DAY));
  // A paused job stopped producing runs 6h ago in the mock's story, or when it was paused.
  const to = new Date(job.paused ? Math.min(now, Date.parse(job.createdAt) + 4 * DAY, now - 6 * 3_600_000) : now);
  if (to < from) return [];
  const slots = firingsBetween(job.schedule, from, to, Math.min(limit, 2000));
  const first = Math.max(0, slots.length - limit);
  return slots
    .slice(first)
    .map((s, i) => makeRun(job, s, first + i, now))
    .reverse();
}

function rows(runs: Run[]): RunRow[] {
  return runs.flatMap((r) =>
    r.steps.map((s) => ({
      runId: r.id,
      jobId: r.jobId,
      startedAt: r.startedAt,
      pass: r.pass,
      stepId: s.stepId,
      status: s.status,
      txHash: s.txHash,
      timeToAcceptedMs: s.timeToAcceptedMs,
      gasGen: s.gasGen,
      error: s.error,
    }))
  );
}

// ---------------------------------------------------------------- presets

const PRESETS: Preset[] = [
  {
    id: "heartbeat",
    name: "Bradbury Heartbeat",
    description: "Canary deploy, a web fetch and two graded LLM questions every hour. Run by the Foundation.",
    networks: ["bradbury"],
    availability: { bradbury: { ok: false, reason: "Run by the Foundation" }, studio: { ok: false, reason: "Bradbury only" } },
  },
  {
    id: "check-url",
    name: "Check a URL",
    description: "Validators GET a page and agree on its status class and whether it contains a string.",
    template: {
      schedule: { everyMinutes: 10 },
      steps: [{ id: "probe", kind: "write", contract: WEBPROBE, method: "check_url", args: ["https://example.com", 200, ""] }],
      assertions: [{ step: "probe", path: "ok", op: "eq", expected: true }],
    },
  },
  {
    id: "check-api",
    name: "Check an API",
    description: "GET a JSON endpoint, extract a value and compare it on-chain.",
    template: {
      schedule: { everyMinutes: 15 },
      steps: [{ id: "api", kind: "write", contract: WEBPROBE, method: "check_api", args: ["https://api.example.com/health", "status", "eq", "ok"] }],
      assertions: [{ step: "api", path: "ok", op: "eq", expected: true }],
    },
  },
  {
    id: "ask",
    name: "Ask the web / LLM",
    description: "Optionally read a page, ask a question, record the validators' short normalized answer.",
    template: {
      schedule: { everyMinutes: 60 },
      steps: [{ id: "ask", kind: "write", contract: ASK, method: "ask", args: ["Is the page announcing an outage? Answer yes or no.", "https://status.example.com"] }],
      assertions: [{ step: "ask", path: "answer", op: "eq", expected: "no" }],
    },
  },
  {
    id: "call-contract",
    name: "Call your contract",
    description: "The relayer calls a write method on your contract. Its msg.sender is the relayer address.",
    template: {
      schedule: { everyMinutes: 30 },
      steps: [{ id: "call", kind: "write", contract: "", method: "", args: [] }],
      assertions: [],
    },
  },
  {
    id: "read-view",
    name: "Read a view",
    description: "Read a view method, no transaction. Records the value and RPC latency.",
    template: {
      schedule: { everyMinutes: 5 },
      steps: [{ id: "read", kind: "read", contract: ORACLE, method: "get_value", args: [] }],
      assertions: [{ step: "read", op: "exists" }],
    },
  },
  {
    id: "deploy",
    name: "Deploy a contract",
    description: "Deploy a fresh canary and record time to ACCEPTED.",
    template: {
      schedule: { everyMinutes: 60 },
      steps: [{ id: "deploy", kind: "deploy", preset: "canary", args: [] }],
      assertions: [{ step: "deploy", path: "address", op: "exists" }],
    },
  },
  {
    id: "deploy-then-call",
    name: "Deploy every X, call every Y",
    description: "Deploy hourly, then call the latest deployed instance every 5 minutes.",
    template: {
      schedule: { everyMinutes: 5 },
      steps: [
        { id: "deploy", kind: "deploy", preset: "canary-v2", args: [], schedule: { everyMinutes: 60 } },
        { id: "bump", kind: "write", contract: "$deploy.address", method: "bump", args: [] },
      ],
      assertions: [],
    },
  },
];

// ---------------------------------------------------------------- pool simulation

export const mockPool = {
  get(id: string): PoolState | null {
    return load().pools[id.toLowerCase()] ?? load().pools[id] ?? null;
  },
  deposit(id: string, owner: string, valueWei: bigint, perRunWei: bigint, perDayWei: bigint) {
    const s = load();
    if (s.pools[id]) throw new Error("PoolExists()");
    s.pools[id] = { owner, paused: false, balanceWei: valueWei.toString(), perRunWei: perRunWei.toString(), perDayWei: perDayWei.toString() };
    save();
  },
  topUp(id: string, valueWei: bigint) {
    const p = mockPool.get(id);
    if (!p) throw new Error("UnknownPool()");
    p.balanceWei = (BigInt(p.balanceWei) + valueWei).toString();
    save();
  },
  withdraw(id: string, amountWei: bigint | "all") {
    const p = mockPool.get(id);
    if (!p) throw new Error("UnknownPool()");
    const bal = BigInt(p.balanceWei);
    const amt = amountWei === "all" ? bal : amountWei;
    if (amt > bal) throw new Error(`InsufficientBalance(${bal}, ${amt})`);
    p.balanceWei = (bal - amt).toString();
    save();
  },
  setPaused(id: string, paused: boolean) {
    const p = mockPool.get(id);
    if (!p) throw new Error("UnknownPool()");
    p.paused = paused;
    save();
  },
};

// ---------------------------------------------------------------- routes

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const err = (status: number, error: string) => json(status, { error });

function validate(j: Partial<Job>): string | null {
  if (!j.name?.trim()) return "name is required";
  if (j.network !== "studio" && j.network !== "bradbury") return "network must be studio or bradbury";
  if (!j.schedule || (!j.schedule.everyMinutes && !j.schedule.cron)) return "schedule is required";
  if (j.schedule.everyMinutes && j.schedule.everyMinutes < 5) return "minimum interval is 5 minutes";
  if (!Array.isArray(j.steps) || j.steps.length === 0) return "at least one step is required";
  const ids = new Set<string>();
  for (const s of j.steps) {
    if (!s.id || ids.has(s.id)) return `step ids must be unique and non-empty (${s.id || "empty"})`;
    ids.add(s.id);
    if (s.kind !== "deploy" && !s.contract) return `step ${s.id}: contract is required`;
    if (s.kind !== "deploy" && !s.method) return `step ${s.id}: method is required`;
  }
  for (const a of j.assertions ?? []) if (!ids.has(a.step)) return `assertion refers to unknown step ${a.step}`;
  return null;
}

let delayMs = 180;

export async function mockFetch(input: string, init: RequestInit = {}): Promise<Response> {
  await new Promise((r) => setTimeout(r, delayMs));
  const s = load();
  const url = new URL(input, "http://mock.local");
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const p = parts.slice(1);

  if (p[0] === "auth") {
    if (p[1] === "nonce") return json(200, { nonce: hex(`nonce:${Date.now()}`, 16).slice(2) });
    if (p[1] === "verify" && method === "POST") {
      const m = String(body?.message ?? "").match(/0x[0-9a-fA-F]{40}/);
      if (!m || !String(body?.signature ?? "").startsWith("0x")) return err(400, "message and signature are required");
      s.wallet = m[0];
      // The sample jobs belong to whoever signs in to the mock.
      for (const j of s.jobs) if (j.owner === SAMPLE_OWNER) j.owner = s.wallet;
      for (const pool of Object.values(s.pools)) if (pool.owner === SAMPLE_OWNER) pool.owner = s.wallet;
      save();
      return json(200, { wallet: s.wallet, studioAllowed: true });
    }
    if (p[1] === "logout") {
      s.wallet = null;
      save();
      return json(200, { ok: true });
    }
  }
  if (p[0] === "me") return json(200, { ready: true, wallet: s.wallet, studioAllowed: !!s.wallet });

  if (p[0] === "presets") {
    const res: PresetsResponse = { minIntervalSec: 300, pool: { bradbury: null }, presets: PRESETS };
    return json(200, res);
  }

  if (p[0] === "jobs") {
    const mine = (j: Job) => !!s.wallet && j.owner.toLowerCase() === s.wallet.toLowerCase();
    if (p.length === 1) {
      if (method === "GET") {
        if (url.searchParams.get("public") === "1") return json(200, { jobs: s.jobs.filter((j) => j.public) });
        if (!s.wallet) return err(401, "sign in first");
        return json(200, { jobs: s.jobs.filter(mine) });
      }
      if (method === "POST") {
        if (!s.wallet) return err(401, "sign in first");
        const e = validate(body ?? {});
        if (e) return err(400, e);
        const job: Job = {
          assertions: [],
          ...body,
          id: `job_${hash(`${Date.now()}:${Math.random()}`).toString(36)}`,
          owner: s.wallet,
          paused: !!body.paused,
          createdAt: new Date().toISOString(),
        };
        s.jobs.unshift(job);
        save();
        return json(201, { job });
      }
    }
    const job = s.jobs.find((j) => j.id === decodeURIComponent(p[1] ?? ""));
    if (!job) return err(404, "job not found");
    const canRead = mine(job) || job.public;
    if (!canRead) return err(s.wallet ? 403 : 401, "not your job");
    if (p.length === 2) {
      if (method === "GET") return json(200, { job });
      if (!mine(job)) return err(403, "not your job");
      if (method === "PATCH") {
        const next = { ...job, ...body, id: job.id, owner: job.owner, createdAt: job.createdAt };
        const e = validate(next);
        if (e) return err(400, e);
        Object.assign(job, next);
        save();
        return json(200, { job });
      }
      if (method === "DELETE") {
        s.jobs = s.jobs.filter((j) => j.id !== job.id);
        save();
        return json(200, { ok: true });
      }
    }
    if ((p[2] === "pause" || p[2] === "resume") && method === "POST") {
      if (!mine(job)) return err(403, "not your job");
      job.paused = p[2] === "pause";
      save();
      return json(200, { job });
    }
    if (p[2] === "runs" && method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 2000);
      const runs = runsFor(job, limit);
      return url.searchParams.get("format") === "rows" ? json(200, rows(runs)) : json(200, { runs });
    }
  }
  return err(404, `mock: no route for ${method} ${url.pathname}`);
}

if (typeof window !== "undefined") {
  (window as unknown as { __jobsMockReset?: () => void; __jobsMockDelay?: (ms: number) => void }).__jobsMockReset = () => {
    resetMock();
    location.reload();
  };
  (window as unknown as { __jobsMockDelay?: (ms: number) => void }).__jobsMockDelay = (ms) => {
    delayMs = ms;
  };
}
