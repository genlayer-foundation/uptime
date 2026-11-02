import type { Run, StepRun } from "@/lib/jobs/types";

export function timeAgo(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 0) return timeUntil(iso, now);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function timeUntil(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const s = Math.max(0, Math.round((t - now) / 1000));
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `in ${Math.floor(s / 86400)}d`;
}

export function dateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function seconds(ms: number | undefined | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function pct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(x === 1 ? 0 : 1)}%`;
}

export function shortHex(h: string | undefined, n = 6): string {
  if (!h) return "—";
  if (h.startsWith("$")) return h;
  return h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
}

/** Pass rate over decided runs (pass !== null). */
export function passRate(runs: Run[]): number | null {
  const decided = runs.filter((r) => r.pass !== null);
  if (!decided.length) return null;
  return decided.filter((r) => r.pass).length / decided.length;
}

export function runsSince(runs: Run[], ms: number, now = Date.now()): Run[] {
  return runs.filter((r) => now - Date.parse(r.startedAt) <= ms);
}

export function rateClass(x: number | null): string {
  if (x == null) return "text-subtle";
  if (x >= 0.99) return "text-success-fg";
  if (x >= 0.9) return "text-warn-fg";
  return "text-danger-fg";
}

export function cnRate(x: number | null, loading = false): string {
  return loading ? "text-subtle" : rateClass(x);
}

export const OK_STATUSES: StepRun["status"][] = ["ACCEPTED", "FINALIZED"];

export function statusTone(s: StepRun["status"]): "ok" | "bad" | "warn" | "muted" {
  if (OK_STATUSES.includes(s)) return "ok";
  if (s === "PENDING") return "muted";
  if (s === "UNDETERMINED" || s === "TIMEOUT") return "warn";
  return "bad";
}

/** Mean time-to-accepted across a run's steps that report one. */
export function runLatencyMs(r: Run): number | null {
  const xs = r.steps.map((s) => s.timeToAcceptedMs).filter((x): x is number => typeof x === "number");
  if (!xs.length) return null;
  return Math.max(...xs);
}

export function gen(wei: bigint, digits = 4): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""} GEN`;
}

export function download(name: string, body: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
