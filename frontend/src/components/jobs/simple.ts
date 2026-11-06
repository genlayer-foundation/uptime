// The wizard's plain fields ("URL", "Expected status", "Question", ...) read
// and write the SAME draft the Advanced editors show: each field is one
// argument of one action, or one rule. Nothing here invents a new job shape;
// a task's template (lib/jobs/presets.ts) stays the source of truth. If the
// draft no longer has the shape a task expects (edited in Advanced), the
// plain fields step aside.

import type { Assertion } from "@/lib/jobs/types";
import { OPS } from "./assert";
import { parseArgs, parseExpected, type Draft, type DraftAssertion, type DraftStep } from "./draft";
import type { TaskId } from "./tasks";

/** The action each task's plain fields edit, and the arg slots they own. */
// Matched by method (hosted contracts) or kind, never by step id.
const SHAPE: Record<TaskId, { kind: DraftStep["kind"]; method?: string; minArgs: number }> = {
  website: { kind: "write", method: "check_url", minArgs: 5 },
  api: { kind: "write", method: "check_api", minArgs: 7 },
  ai: { kind: "write", method: "ask", minArgs: 4 },
  call: { kind: "write", minArgs: 0 },
  deploy: { kind: "deploy", minArgs: 0 },
  "deploy-call": { kind: "deploy", minArgs: 0 },
};

export function mainStep(task: TaskId, d: Draft): DraftStep | null {
  const s = SHAPE[task];
  const step = d.steps.find((x) => x.kind === s.kind && (!s.method || x.method === s.method));
  if (!step) return null;
  const a = parseArgs(step.argsText);
  if (!a.ok || a.value.length < s.minArgs) return null;
  if (task === "deploy-call" && !secondStep(d)) return null;
  return step;
}

/** deploy-call: the action that runs on the newest deploy. */
export function secondStep(d: Draft): DraftStep | null {
  return d.steps.find((x) => x.kind !== "deploy" && /^\$[A-Za-z0-9_-]+\.address$/.test(x.contract)) ?? null;
}

export function args(step: DraftStep): unknown[] {
  const a = parseArgs(step.argsText);
  return a.ok ? a.value : [];
}

/** A draft with one arg of one step replaced. */
export function withArg(d: Draft, stepId: string, i: number, value: unknown): Draft {
  return {
    ...d,
    steps: d.steps.map((s) => {
      if (s.id !== stepId) return s;
      const a = args(s);
      a[i] = value;
      return { ...s, argsText: JSON.stringify(a) };
    }),
  };
}

export function withStep(d: Draft, stepId: string, patch: Partial<DraftStep>): Draft {
  return { ...d, steps: d.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
}

/** Inputs typed one per line: numbers, true/false and JSON stay typed, anything else is text. */
export function linesToArgs(text: string): unknown[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return l;
      }
    });
}

export function argsToLines(a: unknown[]): string {
  return a.map((x) => (typeof x === "string" && !/^[\d\-\[{"]|^(true|false|null)$/.test(x) ? x : JSON.stringify(x))).join("\n");
}

// --- the AI task's expected answer is the rule `result.answer equals …`

export function answerRule(d: Draft): DraftAssertion | undefined {
  return d.assertions.find((a) => a.path === "answer" && a.op === "eq");
}

/** The read action that holds the Ask contract's stored answer. */
function answerStep(d: Draft): string {
  return d.steps.find((s) => s.kind === "read" && s.method === "get_run")?.id ?? "result";
}

/** The Ask contract stores answers lowercased, a-z 0-9 and spaces only. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

export function withExpectedAnswer(d: Draft, answer: string, uid: () => string): Draft {
  const others = d.assertions.filter((a) => a.path !== "answer");
  const a = normalizeAnswer(answer);
  if (!a) return { ...d, assertions: others };
  const rule = answerRule(d) ?? { uid: uid(), step: answerStep(d), path: "answer", op: "eq" as const, expectedText: "" };
  return { ...d, assertions: [...others, { ...rule, expectedText: JSON.stringify(a) }] };
}

export function expectedAnswer(d: Draft): string {
  const r = answerRule(d);
  const v = r ? parseExpected(r.expectedText) : undefined;
  return typeof v === "string" ? v : v === undefined ? "" : String(v);
}

// --- "Passes when …", in words

const PLAIN_OP: Record<Assertion["op"], string> = {
  eq: "equals",
  ne: "is not",
  gt: "is above",
  gte: "is at least",
  lt: "is below",
  lte: "is at most",
  contains: "contains",
  exists: "exists",
};

export const API_OPS = OPS.map((o) => ({ value: o.op, label: PLAIN_OP[o.op] }));

function quote(v: unknown): string {
  return typeof v === "string" ? `“${v}”` : JSON.stringify(v);
}

function host(url: unknown): string {
  try {
    return new URL(String(url)).host || String(url);
  } catch {
    return String(url || "the page");
  }
}

function ruleText(a: DraftAssertion): string {
  const what = a.path ? `${a.step}’s ${a.path}` : `the result of ${a.step}`;
  return a.op === "exists" ? `${what} exists` : `${what} ${PLAIN_OP[a.op]} ${quote(parseExpected(a.expectedText))}`;
}

/** One sentence a person can check before paying for a single run. */
export function passesWhen(task: TaskId | null, d: Draft): string {
  const step = task ? mainStep(task, d) : null;
  if (task && step) {
    const a = args(step);
    switch (task) {
      case "website": {
        const status = Number(a[3]) || 0;
        const contains = String(a[4] ?? "");
        return `Passes when validators agree that ${host(a[2])} answers ${status ? `with status ${status}` : "with a 2xx status"}${
          contains ? ` and the page contains ${quote(contains)}` : ""
        }.`;
      }
      case "api": {
        const op = a[4] as Assertion["op"];
        const tol = String(a[6] ?? "").trim();
        return `Passes when validators agree that ${a[3] ? `the value at ${a[3]}` : "the response"} from ${host(a[2])} ${PLAIN_OP[op] ?? op}${
          op === "exists" ? "" : ` ${quote(a[5])}`
        }${tol ? `, give or take ${tol}` : ""}.`;
      }
      case "ai": {
        const exp = expectedAnswer(d);
        return exp
          ? `Passes when validators agree the answer is ${quote(exp)}.`
          : "Passes when validators agree on an answer.";
      }
      case "call":
        if (d.assertions.length === 0) return "Passes when validators accept the call.";
        break;
      case "deploy":
        return "Passes when validators accept the deploy and the new contract has an address.";
      default:
        break;
    }
  }
  if (d.assertions.length === 0) return "Passes when validators accept every action.";
  return `Passes when every action succeeds and ${d.assertions.map(ruleText).join(", and ")}.`;
}

export function hostOf(url: unknown): string {
  return host(url);
}
