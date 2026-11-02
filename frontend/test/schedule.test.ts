import { describe, expect, it } from "vitest";
import { cronMinGapSec, cronNext, parseCron } from "@/lib/jobs/cron";
import {
  dueSlot,
  initialSchedule,
  MIN_INTERVAL_SEC,
  resumeSchedule,
  runsPerDay,
  validateSchedule,
} from "@/lib/jobs/schedule";

const T0 = 1_800_000_000; // a minute boundary; 2027-01-15T08:00:00Z
const iso = (t: number | null) => (t === null ? null : new Date(t * 1000).toISOString());

describe("validateSchedule", () => {
  it("enforces the 5-minute floor for everyMinutes", () => {
    expect(MIN_INTERVAL_SEC).toBe(300);
    expect(validateSchedule({ everyMinutes: 4 })).toMatch(/at least 5 minutes/);
    expect(validateSchedule({ everyMinutes: 5 })).toBeNull();
    expect(validateSchedule({ everyMinutes: 60 })).toBeNull();
    expect(validateSchedule({ everyMinutes: 5.5 })).toMatch(/whole number/);
    expect(validateSchedule({ everyMinutes: 8 * 24 * 60 })).toMatch(/7 days/);
  });
  it("needs exactly one of everyMinutes or cron", () => {
    expect(validateSchedule({})).toMatch(/exactly one/);
    expect(validateSchedule({ everyMinutes: 5, cron: "*/5 * * * *" })).toMatch(/exactly one/);
    expect(validateSchedule(undefined)).toMatch(/exactly one/);
  });
  it("enforces the 5-minute floor for cron, including wrap-around gaps", () => {
    expect(validateSchedule({ cron: "*/5 * * * *" })).toBeNull();
    expect(validateSchedule({ cron: "0 * * * *" })).toBeNull();
    expect(validateSchedule({ cron: "* * * * *" })).toMatch(/more often/);
    expect(validateSchedule({ cron: "*/2 * * * *" })).toMatch(/more often/);
    // */7 fires at :56 then :00 — a 4 minute gap across the hour.
    expect(validateSchedule({ cron: "*/7 * * * *" })).toMatch(/more often/);
    expect(validateSchedule({ cron: "0,3 * * * *" })).toMatch(/more often/);
    expect(validateSchedule({ cron: "0 0 31 2 *" })).toMatch(/never fires/);
    expect(validateSchedule({ cron: "61 * * * *" })).toMatch(/out of range/);
    expect(validateSchedule({ cron: "* * *" })).toMatch(/5 fields/);
  });
});

describe("cron", () => {
  it("finds the next fire strictly after a time (UTC)", () => {
    expect(iso(cronNext("*/5 * * * *", T0))).toBe("2027-01-15T08:05:00.000Z");
    expect(iso(cronNext("0 * * * *", T0))).toBe("2027-01-15T09:00:00.000Z");
    expect(iso(cronNext("30 2 * * *", T0))).toBe("2027-01-16T02:30:00.000Z");
    expect(iso(cronNext("0 9 1 * *", T0))).toBe("2027-02-01T09:00:00.000Z");
  });
  it("supports ranges, lists, steps and Sunday as 0 or 7", () => {
    expect(iso(cronNext("0 9 * * 1-5", T0))).toBe("2027-01-15T09:00:00.000Z"); // a Friday
    expect(iso(cronNext("0 9 * * 0", T0))).toBe("2027-01-17T09:00:00.000Z");
    expect(iso(cronNext("0 9 * * 7", T0))).toBe("2027-01-17T09:00:00.000Z");
    expect(iso(cronNext("15,45 8-10/2 * * *", T0))).toBe("2027-01-15T08:15:00.000Z");
    expect(parseCron("0 0 1,15 * *").dom.has(15)).toBe(true);
  });
  it("ORs day-of-month and day-of-week when both are restricted", () => {
    // 1st of the month OR a Monday: next is Monday 18th, before Feb 1st.
    expect(iso(cronNext("0 0 1 * 1", T0))).toBe("2027-01-18T00:00:00.000Z");
  });
  it("measures the minimum gap", () => {
    expect(cronMinGapSec("*/5 * * * *")).toBe(300);
    expect(cronMinGapSec("0 */6 * * *")).toBe(6 * 3600);
  });
});

describe("interval schedules", () => {
  const s = initialSchedule({ action: "job", intervalSec: 300 }, T0);

  it("anchors at the next minute (the Heartbeat at the next hour)", () => {
    expect(initialSchedule({ action: "job", intervalSec: 300 }, T0 + 17).anchorAt).toBe(T0 + 60);
    const hb = initialSchedule({ action: "job", intervalSec: 3600 }, T0 + 17, 3600);
    expect(hb.anchorAt % 3600).toBe(0);
    expect(hb.anchorAt).toBeGreaterThan(T0);
  });
  it("is not due before nextDueAt, due exactly on it", () => {
    expect(dueSlot(s, T0 - 1)).toBeNull();
    expect(dueSlot(s, T0)).toEqual({ slot: T0, missed: 0, next: T0 + 300 });
    expect(dueSlot(s, T0 + 299)).toEqual({ slot: T0, missed: 0, next: T0 + 300 });
  });
  it("dispatches only the latest slot after a gap and counts the missed ones", () => {
    expect(dueSlot(s, T0 + 910)).toEqual({ slot: T0 + 900, missed: 3, next: T0 + 1200 });
  });
  it("never re-fires a slot once nextDueAt moved on", () => {
    const after = { ...s, nextDueAt: T0 + 300, lastSlotAt: T0 };
    expect(dueSlot(after, T0 + 120)).toBeNull();
  });
  it("resumes at the next slot, skipping the ones slept through", () => {
    const r = resumeSchedule({ ...s, nextDueAt: T0 + 300 }, T0 + 3601);
    expect(r.nextDueAt).toBe(T0 + 3900);
    expect(resumeSchedule(s, T0 + 600).nextDueAt).toBe(T0 + 600);
  });
});

describe("cron schedules", () => {
  const s = initialSchedule({ action: "job", cron: "*/15 * * * *" }, T0 + 1);

  it("start at the next fire time (or now, when now is one)", () => {
    expect(s.nextDueAt).toBe(T0 + 900);
    expect(initialSchedule({ action: "job", cron: "*/15 * * * *" }, T0).nextDueAt).toBe(T0);
  });
  it("dispatch the latest fire time and count missed ones", () => {
    expect(dueSlot(s, T0 + 899)).toBeNull();
    expect(dueSlot(s, T0 + 900)).toEqual({ slot: T0 + 900, missed: 0, next: T0 + 1800 });
    expect(dueSlot(s, T0 + 2800)).toEqual({ slot: T0 + 2700, missed: 2, next: T0 + 3600 });
  });
  it("resume at the next fire time", () => {
    expect(resumeSchedule(s, T0 + 5000).nextDueAt).toBe(T0 + 5400);
  });
});

it("estimates runs per day for both kinds", () => {
  expect(runsPerDay([{ action: "a", intervalSec: 3600 }, { action: "b", intervalSec: 300 }])).toBe(24 + 288);
  expect(runsPerDay([{ action: "c", cron: "0 9 * * *" }])).toBe(1);
});
