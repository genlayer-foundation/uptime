// Client-side assertion evaluation: a preview of what the server decides.
// Used by the dev mock to grade sample runs and by the run table to show
// which assertion failed. The server's verdict (`Run.pass`) always wins.

import type { Assertion } from "@/lib/jobs/types";

export const OPS: { op: Assertion["op"]; label: string }[] = [
  { op: "eq", label: "equals" },
  { op: "ne", label: "not equal" },
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "contains", label: "contains" },
  { op: "exists", label: "exists" },
];

/** Dot path into a value; numeric segments index arrays. Empty path = the value. */
export function getPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const seg of path.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function evaluate(a: Assertion, result: unknown): boolean {
  const v = getPath(result, a.path);
  switch (a.op) {
    case "exists":
      return v !== undefined && v !== null;
    case "eq":
      return JSON.stringify(v) === JSON.stringify(a.expected);
    case "ne":
      return JSON.stringify(v) !== JSON.stringify(a.expected);
    case "contains":
      if (typeof v === "string") return v.includes(String(a.expected));
      if (Array.isArray(v)) return v.some((x) => JSON.stringify(x) === JSON.stringify(a.expected));
      return false;
    default: {
      const x = num(v);
      const y = num(a.expected);
      if (x == null || y == null) return false;
      if (a.op === "gt") return x > y;
      if (a.op === "gte") return x >= y;
      if (a.op === "lt") return x < y;
      return x <= y;
    }
  }
}

export function describeAssertion(a: Assertion): string {
  const op = OPS.find((o) => o.op === a.op)?.label ?? a.op;
  const lhs = `${a.step}${a.path ? `.${a.path}` : ""}`;
  return a.op === "exists" ? `${lhs} exists` : `${lhs} ${op} ${JSON.stringify(a.expected)}`;
}
