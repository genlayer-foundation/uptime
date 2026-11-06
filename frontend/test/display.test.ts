// The jobs UI's state labels: never-started vs paused, out of GEN, and a run
// the scheduler skipped (pass === null) is never drawn as running.
import { describe, expect, it } from "vitest";
import { jobPhase, nextRunLabel, PHASE, runVerdict } from "@/lib/jobs/display";

describe("job phase and its primary action", () => {
  it("a never-started job offers Fund & start / Start, never Resume", () => {
    expect(jobPhase({ paused: true, state: "draft" })).toBe("draft");
    expect(jobPhase({ paused: true, state: "draft" }, true)).toBe("ready");
    expect(PHASE.draft.actionLabel).toBe("Fund & start");
    expect(PHASE.ready).toMatchObject({ label: "Ready", action: "start", actionLabel: "Start" });
    expect(nextRunLabel("draft")).toBe("not started");
  });
  it("paused resumes, running pauses, out of GEN tops up", () => {
    expect(PHASE[jobPhase({ paused: true, state: "paused" })].actionLabel).toBe("Resume");
    expect(PHASE[jobPhase({ paused: false, state: "active" })].actionLabel).toBe("Pause");
    expect(PHASE[jobPhase({ paused: false, state: "unfunded" })]).toMatchObject({ label: "Out of GEN", action: "top-up", actionLabel: "Top up" });
    expect(jobPhase({ paused: true, state: "errored" })).toBe("stopped");
    expect(nextRunLabel("running")).toBeNull();
  });
  it("falls back to `paused` for a backend without `state`", () => {
    expect(jobPhase({ paused: true })).toBe("paused");
    expect(jobPhase({ paused: false })).toBe("running");
  });
});

describe("run verdict", () => {
  it("only an undecided, unskipped run is running", () => {
    expect(runVerdict({ pass: null })).toMatchObject({ label: "running", pulse: true });
    expect(runVerdict({ pass: null, skipped: "top up", unfunded: true })).toEqual({ label: "Skipped — out of GEN", tone: "neutral", pulse: false });
    expect(runVerdict({ pass: null, skipped: "allowlist" })).toMatchObject({ label: "skipped", pulse: false });
    expect(runVerdict({ pass: true }).label).toBe("pass");
    expect(runVerdict({ pass: false }).label).toBe("fail");
  });
});
