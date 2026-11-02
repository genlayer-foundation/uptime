// Due-time logic. Pure functions, no I/O: the dispatcher and the tests share them.
//
// A step's schedule is EITHER a fixed interval ("every N minutes", slots at
// anchorAt + k * intervalSec) OR a 5-field UTC cron expression. nextDueAt is
// the first slot not yet dispatched. When the dispatcher runs late it
// dispatches only the LATEST due slot and reports how many earlier slots it
// skipped, so a backlog never turns into a burst of txs.

import { cronMinGapSec, cronNext, parseCron } from "./cron";
import type { Schedule } from "./types";

// One schedule row per independently-scheduled group of steps (see
// internal.ts). Exactly one of intervalSec / cron is set.
export interface ScheduleSpec {
  action: string; // group key: "job", or the id of a step with its own schedule
  intervalSec?: number | null;
  cron?: string | null;
}

export interface ScheduleRow extends ScheduleSpec {
  anchorAt: number; // unix seconds
  nextDueAt: number;
  lastSlotAt: number | null;
}

export function toSpec(action: string, s: Schedule): ScheduleSpec {
  return s.cron ? { action, cron: s.cron.trim() } : { action, intervalSec: (s.everyMinutes ?? 0) * 60 };
}

export const MIN_INTERVAL_SEC = 5 * 60;
export const MAX_INTERVAL_SEC = 7 * 24 * 3600;

export function validateInterval(sec: unknown): string | null {
  if (typeof sec !== "number" || !Number.isInteger(sec)) return "interval must be a whole number of seconds";
  if (sec < MIN_INTERVAL_SEC) return `interval must be at least ${MIN_INTERVAL_SEC / 60} minutes`;
  if (sec > MAX_INTERVAL_SEC) return "interval must be at most 7 days";
  if (sec % 60 !== 0) return "interval must be a whole number of minutes";
  return null;
}

export function validateCron(expr: unknown): string | null {
  if (typeof expr !== "string" || expr.length > 100) return "cron must be a string";
  try {
    parseCron(expr);
  } catch (e) {
    return (e as Error).message;
  }
  const gap = cronMinGapSec(expr);
  if (gap === Infinity) return "cron never fires";
  if (gap < MIN_INTERVAL_SEC) return `cron fires more often than every ${MIN_INTERVAL_SEC / 60} minutes`;
  return null;
}

export function validateSchedule(s: unknown): string | null {
  const x = (s ?? {}) as Record<string, unknown>;
  const hasCron = x.cron !== undefined && x.cron !== null && x.cron !== "";
  const hasEvery = x.everyMinutes !== undefined && x.everyMinutes !== null;
  if (hasCron === hasEvery) return "give exactly one of everyMinutes or cron";
  if (hasCron) return validateCron(x.cron);
  const m = x.everyMinutes;
  if (typeof m !== "number" || !Number.isInteger(m)) return "everyMinutes must be a whole number";
  return validateInterval(m * 60);
}

// First slot: interval schedules start at the next boundary of `align`
// seconds (a minute for user jobs, the top of the hour for the Heartbeat so it
// keeps ticking at :00); cron schedules at their next fire time.
export function initialSchedule(spec: ScheduleSpec, nowSec: number, align = 60): ScheduleRow {
  if (spec.cron) {
    const first = cronNext(spec.cron, nowSec - 1);
    if (first === null) throw new Error("cron never fires");
    return { ...spec, intervalSec: null, anchorAt: first, nextDueAt: first, lastSlotAt: null };
  }
  const anchorAt = Math.ceil(nowSec / align) * align;
  return { ...spec, cron: null, anchorAt, nextDueAt: anchorAt, lastSlotAt: null };
}

export interface DueSlot {
  slot: number; // the slot being dispatched (unix seconds)
  missed: number; // earlier due slots that are skipped
  next: number; // the new nextDueAt
}

export function dueSlot(s: ScheduleRow, nowSec: number): DueSlot | null {
  if (nowSec < s.nextDueAt) return null;
  if (s.cron) {
    let slot = s.nextDueAt;
    let missed = 0;
    for (let i = 0; i < 100_000; i++) {
      const n = cronNext(s.cron, slot);
      if (n === null || n > nowSec) return { slot, missed, next: n ?? Number.MAX_SAFE_INTEGER };
      slot = n;
      missed++;
    }
    return { slot, missed, next: cronNext(s.cron, slot) ?? Number.MAX_SAFE_INTEGER };
  }
  const iv = s.intervalSec!;
  const k = Math.floor((nowSec - s.anchorAt) / iv);
  const slot = s.anchorAt + k * iv;
  // nextDueAt is always on the grid, but guard against a hand-edited row.
  const from = Math.max(s.nextDueAt, s.anchorAt);
  const missed = Math.max(0, Math.floor((slot - from) / iv));
  return { slot, missed, next: slot + iv };
}

// Resuming a paused job must not fire every slot it slept through: move
// nextDueAt to the next slot at or after now.
export function resumeSchedule(s: ScheduleRow, nowSec: number): ScheduleRow {
  if (s.cron) return { ...s, nextDueAt: cronNext(s.cron, nowSec - 1) ?? Number.MAX_SAFE_INTEGER };
  const k = Math.ceil((nowSec - s.anchorAt) / s.intervalSec!);
  return { ...s, nextDueAt: s.anchorAt + Math.max(0, k) * s.intervalSec! };
}

// Approximate runs per day, for cost previews.
export function runsPerDay(specs: ScheduleSpec[]): number {
  return specs.reduce((n, s) => {
    if (s.intervalSec) return n + 86400 / s.intervalSec;
    if (!s.cron) return n;
    let t = 1_767_225_600;
    let c = 0;
    for (;;) {
      const x = cronNext(s.cron, t);
      if (x === null || x > 1_767_225_600 + 86400) break;
      c++;
      t = x;
    }
    return n + c;
  }, 0);
}
