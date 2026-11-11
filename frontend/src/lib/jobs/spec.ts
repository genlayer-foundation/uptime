// Job validation, schedule groups, placeholders and assertions. Pure: the
// API, the executor and the tests share it. The server's answer is the one
// that counts; a UI may run validateJobInput too, for early feedback.

import { validateSchedule } from "./schedule";
import type { Assertion, Network, Schedule, Step, StepRun } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const REF = /^\$([A-Za-z0-9][A-Za-z0-9_-]{0,31})\.address$/;
const PATH = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists"] as const;
export const MAX_STEPS = 10;
export const MAX_ASSERTIONS = 20;
export const MAX_CODE = 64 * 1024;
export const DEPLOY_PRESETS = ["canary"] as const;

export const VALUE_REFUSED = "a step cannot send GEN: value must be 0";

/** True when a write step's `value` is anything but zero (malformed counts as non-zero). */
export function sendsValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  const s = String(value).trim();
  return !/^\d{1,78}$/.test(s) || BigInt(s) !== BigInt(0);
}

export class InvalidJob extends Error {}
function fail(msg: string): never {
  throw new InvalidJob(msg);
}

function args(v: unknown, label: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${label} must be an array`);
  if (JSON.stringify(v).length > 4096) fail(`${label} is larger than 4 KB`);
  return v;
}

function ident(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!IDENT.test(s)) fail(`${label} must be a method name`);
  return s;
}

function sched(v: unknown, label: string): Schedule {
  const err = validateSchedule(v);
  if (err) fail(`${label}: ${err}`);
  const x = v as Schedule;
  return x.cron ? { cron: x.cron.trim() } : { everyMinutes: x.everyMinutes };
}

export interface JobInput {
  name: string;
  network: Network;
  schedule: Schedule;
  steps: Step[];
  assertions: Assertion[];
  public: boolean;
  preset: string | null;
}

export function validateSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw) || raw.length === 0) fail("a job needs at least one step");
  if (raw.length > MAX_STEPS) fail(`a job has at most ${MAX_STEPS} steps`);
  const ids: string[] = [];
  const deploys = new Set<string>();
  for (const s of raw as Record<string, unknown>[]) {
    const id = String(s?.id ?? "");
    if (!STEP_ID.test(id)) fail(`step id "${id}" must be letters, digits, - or _`);
    if (ids.includes(id)) fail(`duplicate step id "${id}"`);
    ids.push(id);
    if (s.kind === "deploy") deploys.add(id);
  }
  const contract = (v: unknown, L: string, self: Record<string, unknown>, idx: number): string => {
    const s = typeof v === "string" ? v.trim() : "";
    if (ADDRESS.test(s)) return s;
    const m = REF.exec(s);
    if (!m) fail(`${L}: contract must be a 0x address or $<deployStepId>.address`);
    if (!deploys.has(m[1])) fail(`${L}: no deploy step "${m[1]}"`);
    // Within the same schedule group, the deploy must come first.
    const target = (raw as Record<string, unknown>[]).findIndex((x) => x.id === m[1]);
    const sameGroup = !self.schedule && !(raw as Record<string, unknown>[])[target].schedule;
    if (sameGroup && target > idx) fail(`${L}: deploy step "${m[1]}" must come before it`);
    return s;
  };

  return (raw as Record<string, unknown>[]).map((s, idx) => {
    const id = String(s.id);
    const L = `step "${id}"`;
    const own = s.schedule === undefined || s.schedule === null ? undefined : sched(s.schedule, `${L} schedule`);
    const base = { id, ...(own ? { schedule: own } : {}) };
    switch (s.kind) {
      case "write": {
        const value = s.value === undefined || s.value === "" ? undefined : String(s.value);
        if (value !== undefined && !/^\d{1,40}$/.test(value)) fail(`${L}: value must be whole wei`);
        // Steps are signed by the Uptime relayer, whose GEN is not the job's to
        // send: a call that carries value is refused (the executor refuses it
        // again before every submit, for jobs stored before this rule).
        if (value !== undefined && sendsValue(value)) fail(`${L}: ${VALUE_REFUSED}`);
        return {
          ...base, kind: "write", contract: contract(s.contract, L, s, idx), method: ident(s.method, `${L} method`),
          args: args(s.args, `${L} args`),
        };
      }
      case "read":
        return { ...base, kind: "read", contract: contract(s.contract, L, s, idx), method: ident(s.method, `${L} method`), args: args(s.args, `${L} args`) };
      case "deploy": {
        const code = typeof s.code === "string" && s.code.trim() ? s.code : undefined;
        const preset = typeof s.preset === "string" && s.preset ? s.preset : undefined;
        if (!!code === !!preset) fail(`${L}: give exactly one of code or preset`);
        if (preset && !(DEPLOY_PRESETS as readonly string[]).includes(preset)) fail(`${L}: unknown deploy preset "${preset}"`);
        if (code && code.length > MAX_CODE) fail(`${L}: contract source is larger than 64 KB`);
        return { ...base, kind: "deploy", ...(code ? { code } : { preset }), args: args(s.args, `${L} constructor args`) };
      }
      default:
        return fail(`${L}: kind must be write, deploy or read`);
    }
  }) as Step[];
}

export function validateAssertions(raw: unknown, steps: Step[]): Assertion[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail("assertions must be an array");
  if (raw.length > MAX_ASSERTIONS) fail(`at most ${MAX_ASSERTIONS} assertions`);
  return (raw as Record<string, unknown>[]).map((a, i) => {
    const L = `assertion ${i + 1}`;
    const step = String(a?.step ?? "");
    if (!steps.some((s) => s.id === step)) fail(`${L}: no step "${step}"`);
    const op = String(a.op ?? "");
    if (!(OPS as readonly string[]).includes(op)) fail(`${L}: op must be one of ${OPS.join(", ")}`);
    const path = typeof a.path === "string" ? a.path.trim() : "";
    if (path && (!PATH.test(path) || path.length > 200)) fail(`${L}: path must be a dot path like result.ok`);
    if (op !== "exists" && a.expected === undefined) fail(`${L}: expected is required for ${op}`);
    if (a.expected !== undefined && JSON.stringify(a.expected).length > 200) fail(`${L}: expected is too large`);
    if (["gt", "gte", "lt", "lte"].includes(op) && !Number.isFinite(Number(a.expected))) fail(`${L}: expected must be a number for ${op}`);
    return { step, op: op as Assertion["op"], ...(path ? { path } : {}), ...(a.expected !== undefined ? { expected: a.expected } : {}) };
  });
}

export function validateJobInput(body: Record<string, unknown>): JobInput {
  const network = body.network;
  if (network !== "studio" && network !== "bradbury") fail("network must be studio or bradbury");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) fail("name is required");
  const schedule = sched(body.schedule, "schedule");
  const steps = validateSteps(body.steps);
  return {
    name,
    network,
    schedule,
    steps,
    assertions: validateAssertions(body.assertions, steps),
    public: body.public === true,
    preset: typeof body.preset === "string" && body.preset ? body.preset.slice(0, 40) : null,
  };
}

// ---------------------------------------------------------------------------
// Schedule groups. Steps without their own schedule run together, in order,
// on the job schedule ("job"); each step with its own schedule is a group.

export interface Group {
  key: string;
  schedule: Schedule;
  steps: Step[];
}

export function groupsOf(job: { schedule: Schedule; steps: Step[] }): Group[] {
  const shared = job.steps.filter((s) => !s.schedule);
  const own = job.steps.filter((s) => s.schedule).map((s) => ({ key: s.id, schedule: s.schedule!, steps: [s] }));
  return [...(shared.length ? [{ key: "job", schedule: job.schedule, steps: shared }] : []), ...own];
}

// ---------------------------------------------------------------------------
// Placeholders, expanded per run inside strings (args and contract):
//   {{job_id}} {{run_id}} {{slot}} {{relayer}}   and   "$<deployStepId>.address"
// A string that is exactly "{{slot}}" becomes an integer (bigint); inside a
// longer string every placeholder is text.

export interface ExpandCtx {
  jobId: string;
  runId: string;
  slot: number;
  relayer: string;
  deployed: (stepId: string) => string | undefined;
}

export class MissingDeploy extends Error {
  constructor(public step: string) {
    super(`No deployed instance of "${step}" yet: waiting for its first accepted deploy`);
  }
}

export function expand(v: unknown, c: ExpandCtx): unknown {
  if (typeof v === "string") {
    if (v === "{{slot}}") return BigInt(c.slot); // a bare slot is an int argument
    const ref = REF.exec(v);
    if (ref) {
      const a = c.deployed(ref[1]);
      if (!a) throw new MissingDeploy(ref[1]);
      return a;
    }
    return v.replace(/\{\{(job_id|uptime_id|run_id|slot|relayer)\}\}/g, (_m, k: string) =>
      k === "run_id" ? c.runId : k === "slot" ? String(c.slot) : k === "relayer" ? c.relayer : String(c.jobId)
    );
  }
  if (Array.isArray(v)) return v.map((x) => expand(x, c));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, c)]));
  return v;
}

// JSON integers become bigint so they encode as GenVM ints.
export function toCalldata(v: unknown): unknown {
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (Array.isArray(v)) return v.map(toCalldata);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCalldata(x)]));
  return v;
}

// Make chain values JSON-safe: Maps → objects, bigints → numbers (or strings
// when unsafe), bytes → 0x hex.
export function jsonSafe(v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), jsonSafe(x)]));
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Uint8Array) return `0x${Buffer.from(v).toString("hex")}`;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

// ---------------------------------------------------------------------------
// Assertions

export function pick(v: unknown, path: string | undefined): { found: boolean; value: unknown } {
  if (!path) return { found: v !== undefined, value: v };
  let cur: unknown = v;
  for (const k of path.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(k)) cur = cur[Number(k)];
    else if (cur && typeof cur === "object" && k in (cur as object)) cur = (cur as Record<string, unknown>)[k];
    else return { found: false, value: undefined };
  }
  return { found: cur !== undefined, value: cur };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" || typeof b === "string") return String(a) === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkAssertion(result: unknown, a: Assertion): boolean {
  const { found, value } = pick(result, a.path);
  if (a.op === "exists") return found && value !== null;
  if (!found) return false;
  switch (a.op) {
    case "eq":
      return same(value, a.expected);
    case "ne":
      return !same(value, a.expected);
    case "contains":
      if (Array.isArray(value)) return value.some((x) => same(x, a.expected));
      return (typeof value === "string" ? value : JSON.stringify(value)).includes(String(a.expected));
    default: {
      const n = Number(value);
      const w = Number(a.expected);
      if (!Number.isFinite(n) || !Number.isFinite(w)) return false;
      return a.op === "gt" ? n > w : a.op === "gte" ? n >= w : a.op === "lt" ? n < w : n <= w;
    }
  }
}

export const OK_STATUSES = new Set<StepRun["status"]>(["ACCEPTED", "FINALIZED"]);

// pass = null while running; false if any step failed or any assertion on a
// step of this run fails; true otherwise.
export function runPass(steps: StepRun[], assertions: Assertion[], done: boolean): boolean | null {
  if (!done) return null;
  if (steps.length === 0 || steps.some((s) => !OK_STATUSES.has(s.status) || s.error)) return false;
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  return assertions.filter((a) => byId.has(a.step)).every((a) => checkAssertion(byId.get(a.step)!.result, a));
}

// Chain statusName → StepRun status.
export function stepStatus(chain: string): StepRun["status"] | null {
  switch (chain) {
    case "ACCEPTED":
    case "FINALIZED":
    case "UNDETERMINED":
      return chain;
    case "READY_TO_FINALIZE":
      return "ACCEPTED";
    case "LEADER_TIMEOUT":
    case "VALIDATORS_TIMEOUT":
      return "TIMEOUT";
    case "CANCELED":
      return "ERROR";
    default:
      return null; // not decided yet
  }
}
