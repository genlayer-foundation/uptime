import type { Stat } from "./types";

export const DASH = "—";

export function ratio(num: number, den: number): number | undefined {
  return den > 0 ? num / den : undefined;
}

export function pct(v: number | undefined, digits = 0): string {
  return v === undefined || Number.isNaN(v) ? DASH : `${(v * 100).toFixed(digits)}%`;
}

export function duration(sec: number | undefined): string {
  if (sec === undefined) return DASH;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function accuracy(s: Stat | undefined): number | undefined {
  return s ? ratio(s.correct, s.graded) : undefined;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

export function hourLabel(t: number, withDate: boolean): string {
  const d = new Date(t * 1000);
  return withDate
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(t: number): string {
  return new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
