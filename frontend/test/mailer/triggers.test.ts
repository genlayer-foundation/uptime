// Trigger tests: failure vs assertion, recovery, and the daily digest.
// Mocked provider and mocked chain only: nothing here opens a socket or signs a tx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargeRequest, PoolCharger } from "@/lib/mailer/charger";
import { defaultRuleSettings } from "@/lib/mailer/limits";
import { memoryAlertsRepo } from "@/lib/mailer/memoryRepo";
import { classifyRun, notifyRunDecidedWith, sendDigestWith, type MailerDeps } from "@/lib/mailer/policy";
import type { MailProvider } from "@/lib/mailer/provider";
import { summarizeRuns, type Message } from "@/lib/mailer/templates";
import type { AlertJob, AlertRule, AlertRun } from "@/lib/mailer/types";

const OWNER = "0x00000000000000000000000000000000000000aa";
const POOL_ID = `0x${"11".repeat(32)}`;

beforeEach(() => {
  vi.stubEnv("MAILER_ENABLED", "1");
  vi.stubEnv("MAILER_PROVIDER", "postmark");
  vi.stubEnv("MAILER_PROVIDER_TOKEN", "test-token-not-real");
  vi.stubEnv("MAILER_FROM", "alerts@uptime.example");
  vi.stubEnv("MAILER_TOKEN_SECRET", "x".repeat(40));
  vi.stubEnv("MAILER_PUBLIC_URL", "https://uptime.example");
  vi.stubEnv("MAILER_KEY", `0x${"22".repeat(32)}`);
  vi.stubEnv("UPTIME_POOL_BRADBURY", `0x${"33".repeat(20)}`);
  vi.stubEnv("MAILER_RECIPIENT_COOLDOWN_MIN", "0");
  clock = new Date("2026-11-02T12:00:00Z");
});
afterEach(() => vi.unstubAllEnvs());

let clock = new Date();
const advance = (min: number) => (clock = new Date(clock.getTime() + min * 60_000));

async function setup(over: Partial<AlertRule> = {}, emails = ["ana@example.com"]) {
  const repo = memoryAlertsRepo();
  const sent: Message[] = [];
  const provider: MailProvider = {
    async deliver(m) {
      sent.push(m);
      return { ok: true, id: `m${sent.length}` };
    },
    async suppressions() {
      return [];
    },
  };
  const calls: ChargeRequest[] = [];
  const charger: PoolCharger = {
    async charge(req) {
      calls.push(req);
      return { outcome: "charged", txHash: "0xabc" };
    },
  };
  const deps: MailerDeps = { repo, provider, charger, studioAllowed: () => true, now: () => clock, log: () => {} };
  const ids: number[] = [];
  for (const e of emails) {
    const { recipient } = await repo.upsertRecipient(OWNER, e, clock);
    await repo.confirmRecipient(recipient.id, clock);
    ids.push(recipient.id);
  }
  await repo.setRule({ ...defaultRuleSettings(), enabled: true, jobId: "j1", ownerWallet: OWNER, recipientIds: ids, ...over }, clock);
  return { repo, deps, sent, calls, ids };
}

const job: AlertJob = { id: "j1", owner: OWNER, name: "Docs up", network: "bradbury", poolId: POOL_ID };
let seq = 0;
const at = () => clock.toISOString();
const stepFail = (): AlertRun => ({ id: `r${++seq}`, startedAt: at(), steps: [{ status: "TIMEOUT" }], pass: false });
const assertFail = (): AlertRun => ({ id: `r${++seq}`, startedAt: at(), steps: [{ status: "ACCEPTED" }], pass: false });
const pass = (): AlertRun => ({ id: `r${++seq}`, startedAt: at(), steps: [{ status: "FINALIZED" }], pass: true });

describe("classifyRun", () => {
  it("splits step failures from assertion failures", () => {
    expect(classifyRun(stepFail())).toBe("step_failure");
    expect(classifyRun({ id: 1, steps: [{ status: "ERROR" }], pass: null })).toBe("step_failure");
    expect(classifyRun(assertFail())).toBe("assertion_failure");
    expect(classifyRun(pass())).toBe("pass");
    expect(classifyRun({ id: 1, steps: [{ status: "PENDING" }], pass: null })).toBe("pending");
  });
});

describe("failure and assertion triggers", () => {
  it("each fires only when its switch is on", async () => {
    const a = await setup({ onFailure: false });
    expect(await notifyRunDecidedWith(a.deps, job, stepFail())).toEqual({ status: "trigger_off", trigger: "failure" });
    expect((await notifyRunDecidedWith(a.deps, job, assertFail())).status).toBe("done");

    const b = await setup({ onAssertion: false });
    expect(await notifyRunDecidedWith(b.deps, job, assertFail())).toEqual({ status: "trigger_off", trigger: "assertion" });
    expect(b.sent).toHaveLength(0);
  });

  it("the ledger records which trigger sent each email", async () => {
    const { deps, repo } = await setup();
    await notifyRunDecidedWith(deps, job, stepFail());
    expect(repo.emails[0]).toMatchObject({ kind: "alert", trigger: "failure", outcome: "sent" });
  });
});

describe("recovery", () => {
  it("first pass after a SENT failure alert mails a recovery, then nothing on further passes", async () => {
    const { deps, sent, calls, repo } = await setup();
    await notifyRunDecidedWith(deps, job, stepFail());
    advance(5); // inside the 15-min job cooldown: recovery is exempt
    const res = await notifyRunDecidedWith(deps, job, pass());
    expect(res).toMatchObject({ status: "done", trigger: "recovery" });
    expect(sent.map((m) => m.subject)).toEqual(["[Uptime] Job failed: Docs up", "[Uptime] Job recovered: Docs up"]);
    expect(calls).toHaveLength(2); // a recovery is a paid email on Bradbury
    expect(repo.emails[1]).toMatchObject({ trigger: "recovery", kind: "alert" });
    advance(5);
    expect(await notifyRunDecidedWith(deps, job, pass())).toEqual({ status: "not_down" });
    expect(sent).toHaveLength(2);
  });

  it("no recovery when the failure alert never went out", async () => {
    const { deps, sent } = await setup({ failAfter: 3 });
    await notifyRunDecidedWith(deps, job, stepFail(), { consecutiveFailures: 1 }); // below threshold
    expect(await notifyRunDecidedWith(deps, job, pass())).toEqual({ status: "not_down" });
    expect(sent).toHaveLength(0);
  });

  it("no recovery when the owner switched it off", async () => {
    const { deps, sent } = await setup({ onRecovery: false });
    await notifyRunDecidedWith(deps, job, assertFail());
    expect(await notifyRunDecidedWith(deps, job, pass())).toEqual({ status: "trigger_off", trigger: "recovery" });
    expect(sent).toHaveLength(1);
  });

  it("flapping is bounded: a failure inside the cooldown after a recovery is throttled, so no second recovery", async () => {
    const { deps, sent } = await setup();
    await notifyRunDecidedWith(deps, job, stepFail());
    advance(1);
    await notifyRunDecidedWith(deps, job, pass());
    advance(1);
    expect(await notifyRunDecidedWith(deps, job, stepFail())).toEqual({ status: "throttled", reason: "job_cooldown" });
    advance(1);
    expect((await notifyRunDecidedWith(deps, job, pass())).status).toBe("not_down");
    expect(sent).toHaveLength(2);
  });

  it("recovery counts toward the per-job daily cap", async () => {
    const { deps, sent } = await setup({ perJobPerDay: 1 });
    await notifyRunDecidedWith(deps, job, stepFail());
    const res = await notifyRunDecidedWith(deps, job, pass());
    expect(res.status === "done" && res.decisions[0].reason).toBe("job_daily_cap");
    expect(sent).toHaveLength(1);
  });
});

describe("daily digest", () => {
  const history = () => {
    const runs: AlertRun[] = [];
    for (let i = 0; i < 6; i++) {
      runs.push(i === 2 ? stepFail() : pass());
      advance(60);
    }
    return runs;
  };

  it("is off by default", async () => {
    const { deps, sent } = await setup();
    expect(await sendDigestWith(deps, job, history())).toEqual({ status: "trigger_off", trigger: "digest" });
    expect(sent).toHaveLength(0);
  });

  it("one per recipient per UTC day, however often the cron runs", async () => {
    const { deps, sent, calls } = await setup({ digest: true }, ["a@example.com", "b@example.com"]);
    const runs = history();
    expect((await sendDigestWith(deps, job, runs)).status).toBe("done");
    advance(60);
    const again = await sendDigestWith(deps, job, runs);
    expect(again.status === "done" && again.decisions.map((d) => d.reason)).toEqual(["duplicate", "duplicate"]);
    expect(sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(calls).toHaveLength(2);
    expect(sent[0].subject).toBe("[Uptime] Daily digest: Docs up");
    expect(sent[0].text).toContain("6 runs: 5 passed, 1 failed (pass rate 83.3%).");
    expect(sent[0].text).toContain("Last failure: a transaction timed out");
    clock = new Date("2026-11-03T09:00:00Z");
    await sendDigestWith(deps, job, [pass()]);
    expect(sent).toHaveLength(4);
  });

  it("is exempt from the per-job alert cap and the job cooldown", async () => {
    const { deps, sent } = await setup({ digest: true, perJobPerDay: 1 });
    await notifyRunDecidedWith(deps, job, stepFail());
    expect((await sendDigestWith(deps, job, history())).status).toBe("done");
    expect(sent).toHaveLength(2);
  });

  it("still counts toward the address's own daily cap", async () => {
    const { deps, repo, ids, sent } = await setup({ digest: true });
    await repo.setRecipientCap(ids[0], OWNER, 1, clock);
    await notifyRunDecidedWith(deps, job, stepFail());
    const res = await sendDigestWith(deps, job, history());
    expect(res.status === "done" && res.decisions[0].reason).toBe("recipient_daily_cap");
    expect(sent).toHaveLength(1);
  });

  it("nothing to report: no runs in the last 24 h sends nothing", async () => {
    const { deps, sent } = await setup({ digest: true });
    const old: AlertRun = { id: "old", startedAt: "2026-10-01T00:00:00Z", steps: [], pass: true };
    expect(await sendDigestWith(deps, job, [old])).toEqual({ status: "nothing_to_report" });
    expect(sent).toHaveLength(0);
  });

  it("summarizeRuns windows to 24 h and counts running ones", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const s = summarizeRuns(
      [
        { id: 1, startedAt: "2026-11-02T11:00:00Z", steps: [{ status: "ACCEPTED" }], pass: true },
        { id: 2, startedAt: "2026-11-02T10:00:00Z", steps: [{ status: "PENDING" }], pass: null },
        { id: 3, startedAt: "2026-11-01T11:00:00Z", steps: [{ status: "TIMEOUT" }], pass: false },
      ],
      now
    );
    expect(s).toEqual({ total: 2, passed: 1, failed: 0, pending: 1, lastFailure: null });
  });
});
