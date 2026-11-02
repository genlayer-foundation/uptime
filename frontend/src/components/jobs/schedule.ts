// Schedule helpers for the jobs UI: validation, next-run preview and runs/day.
// A Schedule is `everyMinutes` (>= 5) or a 5-field UTC cron that fires at most
// every 5 minutes (see lib/jobs/types.ts). The server is the authority; this
// only gives the wizard an honest preview before it submits.

import type { Schedule } from "@/lib/jobs/types";

export const MIN_INTERVAL_MIN = 5;

type Field = { min: number; max: number };
const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday; 7 also accepted)
];

type Parsed = { sets: Set<number>[]; domStar: boolean; dowStar: boolean };

function parseField(src: string, f: Field, isDow: boolean): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`bad cron field "${part}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`bad step in "${part}"`);
    let lo = f.min;
    let hi = f.max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] ? f.max : a);
    }
    const max = isDow ? 7 : f.max;
    if (lo < f.min || hi > max || lo > hi) throw new Error(`"${part}" is out of range ${f.min}-${f.max}`);
    for (let v = lo; v <= hi; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr: string): Parsed {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron needs 5 fields: minute hour day month weekday (UTC)");
  return {
    sets: parts.map((p, i) => parseField(p, FIELDS[i], i === 4)),
    domStar: parts[2] === "*",
    dowStar: parts[4] === "*",
  };
}

function matches(p: Parsed, d: Date): boolean {
  const [mi, h, dom, mo, dow] = p.sets;
  if (!mi.has(d.getUTCMinutes()) || !h.has(d.getUTCHours()) || !mo.has(d.getUTCMonth() + 1)) return false;
  const domOk = dom.has(d.getUTCDate());
  const dowOk = dow.has(d.getUTCDay());
  // Vixie cron: when both day fields are restricted, either may match.
  if (!p.domStar && !p.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** Next `count` firing times strictly after `from` (searches up to ~1 year). */
export function nextCronTimes(expr: string, from: Date, count = 3): Date[] {
  const p = parseCron(expr);
  const out: Date[] = [];
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60 && out.length < count; i++) {
    if (matches(p, t)) out.push(new Date(t.getTime()));
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return out;
}

/** Error message for an invalid schedule, or null. */
export function scheduleError(s: Schedule | undefined): string | null {
  if (!s || (s.everyMinutes == null && !s.cron)) return "Pick an interval or a cron expression.";
  if (s.everyMinutes != null && s.cron) return "Use an interval or a cron expression, not both.";
  if (s.everyMinutes != null) {
    if (!Number.isInteger(s.everyMinutes)) return "The interval must be a whole number of minutes.";
    if (s.everyMinutes < MIN_INTERVAL_MIN) return `The minimum interval is ${MIN_INTERVAL_MIN} minutes.`;
    return null;
  }
  try {
    // Every gap over the next day must be >= 5 minutes.
    const times = nextCronTimes(s.cron!, new Date(), 300);
    if (times.length === 0) return "This cron expression never fires.";
    for (let i = 1; i < times.length; i++) {
      if (times[i].getTime() - times[i - 1].getTime() < MIN_INTERVAL_MIN * 60_000) {
        return `This cron fires more often than every ${MIN_INTERVAL_MIN} minutes.`;
      }
    }
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid cron expression.";
  }
  return null;
}

/** Next run after `from`, or null if the schedule cannot be evaluated. */
export function nextRun(s: Schedule | undefined, from: Date, anchor?: Date): Date | null {
  if (!s) return null;
  if (s.everyMinutes) {
    const ms = s.everyMinutes * 60_000;
    const base = anchor ? anchor.getTime() : 0;
    const k = Math.floor((from.getTime() - base) / ms) + 1;
    return new Date(base + k * ms);
  }
  if (s.cron) {
    try {
      return nextCronTimes(s.cron, from, 1)[0] ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Firing times in [from, to], capped at `max` (most recent kept). */
export function firingsBetween(s: Schedule, from: Date, to: Date, max = 500): Date[] {
  const out: Date[] = [];
  if (s.everyMinutes) {
    const ms = s.everyMinutes * 60_000;
    let t = Math.ceil(from.getTime() / ms) * ms;
    for (; t <= to.getTime(); t += ms) out.push(new Date(t));
  } else if (s.cron) {
    let cur = new Date(from.getTime() - 60_000);
    for (let i = 0; i < 100_000; i++) {
      const [n] = nextCronTimes(s.cron, cur, 1);
      if (!n || n > to) break;
      out.push(n);
      cur = n;
    }
  }
  return out.slice(-max);
}

/** Approximate runs per day, for the cost preview. */
export function runsPerDay(s: Schedule | undefined): number | null {
  if (!s || scheduleError(s)) return null;
  if (s.everyMinutes) return Math.floor((24 * 60) / s.everyMinutes);
  const now = new Date();
  return firingsBetween(s, now, new Date(now.getTime() + 7 * 86_400_000), 100_000).length / 7;
}

export function describeSchedule(s: Schedule | undefined): string {
  if (!s) return "inherits job schedule";
  if (s.everyMinutes) {
    const m = s.everyMinutes;
    if (m % 1440 === 0) return `every ${m / 1440 === 1 ? "day" : `${m / 1440} days`}`;
    if (m % 60 === 0) return `every ${m / 60 === 1 ? "hour" : `${m / 60} hours`}`;
    return `every ${m} min`;
  }
  if (s.cron) return `cron ${s.cron} (UTC)`;
  return "no schedule";
}
