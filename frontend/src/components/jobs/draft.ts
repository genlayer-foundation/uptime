// Editable wizard state and its conversion to the shared Job shape.
// Args and expected values are edited as JSON text and parsed on the way out.

import type { Assertion, Network, Schedule, Step } from "@/lib/jobs/types";
import type { NewJob } from "@/lib/jobs/client";
import { scheduleError } from "./schedule";

export type DraftStep = {
  uid: string;
  kind: Step["kind"];
  id: string;
  contract: string;
  method: string;
  argsText: string;
  value: string;
  deploySource: "preset" | "code";
  preset: string;
  code: string;
  ownSchedule: boolean;
  schedule: Schedule;
};

export type DraftAssertion = { uid: string; step: string; path: string; op: Assertion["op"]; expectedText: string };

export type Funding = { depositGen: string; perRunGen: string; perDayGen: string };

export type Draft = {
  preset?: string;
  name: string;
  network: Network;
  schedule: Schedule;
  steps: DraftStep[];
  assertions: DraftAssertion[];
  funding: Funding;
  public: boolean;
};

let n = 0;
export const uid = () => `u${Date.now().toString(36)}${(n++).toString(36)}`;

export const DEPLOY_PRESETS = [
  { id: "canary", label: "Canary (contracts/canary.py)" },
  { id: "canary-v2", label: "Canary v2 with bump() (deploy + call)" },
];

export function blankStep(kind: Step["kind"], existing: DraftStep[]): DraftStep {
  const base = kind === "deploy" ? "deploy" : kind === "read" ? "read" : "call";
  let id = base;
  for (let i = 2; existing.some((s) => s.id === id); i++) id = `${base}${i}`;
  return {
    uid: uid(),
    kind,
    id,
    contract: "",
    method: "",
    argsText: "[]",
    value: "",
    deploySource: "preset",
    preset: "canary",
    code: "",
    ownSchedule: false,
    schedule: { everyMinutes: 60 },
  };
}

export function stepToDraft(s: Step): DraftStep {
  const d = blankStep(s.kind, []);
  d.id = s.id;
  d.argsText = JSON.stringify(s.args ?? [], null, 0);
  if (s.schedule) {
    d.ownSchedule = true;
    d.schedule = s.schedule;
  }
  if (s.kind === "deploy") {
    d.deploySource = s.code ? "code" : "preset";
    d.preset = s.preset ?? "canary";
    d.code = s.code ?? "";
  } else {
    d.contract = s.contract;
    d.method = s.method;
    if (s.kind === "write") d.value = s.value ?? "";
  }
  return d;
}

export function assertionToDraft(a: Assertion): DraftAssertion {
  return { uid: uid(), step: a.step, path: a.path ?? "", op: a.op, expectedText: a.expected === undefined ? "" : JSON.stringify(a.expected) };
}

export function parseArgs(text: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text.trim() || "[]");
    if (!Array.isArray(v)) return { ok: false, error: "Args must be a JSON array, e.g. [\"https://example.com\", 200]" };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

/** Expected value: JSON if it parses, else the raw text as a string. */
export function parseExpected(text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const REF = /^\$([A-Za-z0-9_-]+)\.address$/;

export function stepErrors(d: DraftStep, all: DraftStep[]): Partial<Record<"id" | "contract" | "method" | "args" | "value" | "code" | "schedule", string>> {
  const e: ReturnType<typeof stepErrors> = {};
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(d.id)) e.id = "Letters, digits, - and _, starting with a letter.";
  else if (all.filter((s) => s.id === d.id).length > 1) e.id = "Step ids must be unique.";
  if (d.kind !== "deploy") {
    const ref = d.contract.match(REF);
    if (ref) {
      const target = all.find((s) => s.id === ref[1]);
      if (!target) e.contract = `No step "${ref[1]}".`;
      else if (target.kind !== "deploy") e.contract = `"${ref[1]}" is not a deploy step.`;
      else if (all.indexOf(target) > all.indexOf(d)) e.contract = `"${ref[1]}" must come before this step.`;
    } else if (!ADDR.test(d.contract)) e.contract = "A 0x address (40 hex) or $<deployStepId>.address";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(d.method)) e.method = "A method name.";
  } else if (d.deploySource === "code" && !d.code.trim()) e.code = "Paste the contract source.";
  const a = parseArgs(d.argsText);
  if (!a.ok) e.args = a.error;
  if (d.kind === "write" && d.value.trim() && !/^\d+(\.\d{1,18})?$/.test(d.value.trim())) e.value = "GEN amount, e.g. 0 or 0.01";
  if (d.ownSchedule) {
    const s = scheduleError(d.schedule);
    if (s) e.schedule = s;
  }
  return e;
}

export function toStep(d: DraftStep): Step {
  const args = (parseArgs(d.argsText) as { ok: true; value: unknown[] }).value ?? [];
  const schedule = d.ownSchedule ? d.schedule : undefined;
  if (d.kind === "deploy") {
    return { kind: "deploy", id: d.id, args, ...(d.deploySource === "code" ? { code: d.code } : { preset: d.preset }), ...(schedule ? { schedule } : {}) };
  }
  if (d.kind === "read") return { kind: "read", id: d.id, contract: d.contract.trim(), method: d.method.trim(), args, ...(schedule ? { schedule } : {}) };
  return {
    kind: "write",
    id: d.id,
    contract: d.contract.trim(),
    method: d.method.trim(),
    args,
    ...(d.value.trim() && d.value.trim() !== "0" ? { value: d.value.trim() } : {}),
    ...(schedule ? { schedule } : {}),
  };
}

export function toAssertion(a: DraftAssertion): Assertion {
  const out: Assertion = { step: a.step, op: a.op };
  if (a.path.trim()) out.path = a.path.trim();
  if (a.op !== "exists") out.expected = parseExpected(a.expectedText);
  return out;
}

export function assertionErrors(a: DraftAssertion, steps: DraftStep[]): string | null {
  if (!steps.some((s) => s.id === a.step)) return "Pick a step.";
  if (a.path && !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(a.path.trim())) return "Dot path, e.g. result.ok or items.0.price";
  if (a.op !== "exists" && a.expectedText.trim() === "") return "Expected value required (JSON, or plain text for a string).";
  if (["gt", "gte", "lt", "lte"].includes(a.op) && typeof parseExpected(a.expectedText) !== "number") return "Numeric comparison needs a number.";
  return null;
}

export function toNewJob(d: Draft): NewJob {
  return {
    name: d.name.trim(),
    network: d.network,
    schedule: d.schedule,
    steps: d.steps.map(toStep),
    assertions: d.assertions.map(toAssertion),
    ...(d.preset ? { preset: d.preset } : {}),
    public: d.public,
  };
}

export function draftFromTemplate(t: { name: string; preset?: string; steps?: Step[]; schedule?: Schedule; assertions?: Assertion[] }, network: Network): Draft {
  return {
    preset: t.preset,
    name: t.name,
    network,
    schedule: t.schedule ?? { everyMinutes: 15 },
    steps: (t.steps?.length ? t.steps : []).map(stepToDraft),
    assertions: (t.assertions ?? []).map(assertionToDraft),
    funding: { depositGen: "1", perRunGen: "0.01", perDayGen: "0.5" },
    public: false,
  };
}

