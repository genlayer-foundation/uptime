// Minimal 5-field cron (minute hour day-of-month month day-of-week), UTC.
// Supports *, lists (a,b), ranges (a-b), steps (*/n, a-b/n), and 0 or 7 for
// Sunday. Day-of-month and day-of-week combine with OR when both are
// restricted, as in Vixie cron. No names (MON, JAN), no @macros, no seconds.

interface Spec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const FIELDS: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function field(src: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad cron field "${part}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`bad cron step "${part}"`);
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    if (a < lo || b > hi || a > b) throw new Error(`cron value out of range in "${part}"`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Spec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron must have 5 fields: minute hour day month weekday");
  const [minute, hour, dom, month, dow] = parts.map((p, i) => field(p, FIELDS[i]));
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

function dayMatches(s: Spec, d: Date): boolean {
  const dm = s.dom.has(d.getUTCDate());
  const wm = s.dow.has(d.getUTCDay());
  if (s.domAny && s.dowAny) return true;
  if (s.domAny) return wm;
  if (s.dowAny) return dm;
  return dm || wm;
}

// The first fire time strictly after `afterSec` (unix seconds), or null if
// none within ~5 years (e.g. "0 0 31 2 *").
export function cronNext(expr: string | Spec, afterSec: number): number | null {
  const s = typeof expr === "string" ? parseCron(expr) : expr;
  const d = new Date((Math.floor(afterSec / 60) + 1) * 60_000);
  const limit = afterSec + 5 * 366 * 86400;
  while (d.getTime() / 1000 <= limit) {
    if (!s.month.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(s, d)) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!s.hour.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!s.minute.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d.getTime() / 1000;
  }
  return null;
}

// Smallest gap between consecutive fires, sampled over the next 8 days from
// a fixed epoch (so validation is deterministic). Used for the 5-min floor.
export function cronMinGapSec(expr: string): number {
  const s = parseCron(expr);
  let t = cronNext(s, 1_767_225_600); // 2026-01-01T00:00Z
  if (t === null) return Infinity;
  const end = t + 8 * 86400;
  let min = Infinity;
  for (let i = 0; i < 20_000; i++) {
    const n = cronNext(s, t);
    if (n === null || n > end) break;
    min = Math.min(min, n - t);
    t = n;
  }
  return min;
}
