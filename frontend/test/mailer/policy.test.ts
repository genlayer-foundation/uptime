// Send-policy tests: cooldowns, caps, charge-before-send and skip-on-ChargeSkipped.
// Mocked provider and mocked chain only: nothing here opens a socket or signs a tx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, type MailerConfig } from "@/lib/mailer/config";
import type { ChargeRequest, ChargeResult, PoolCharger } from "@/lib/mailer/charger";
import { memoryAlertsRepo } from "@/lib/mailer/memoryRepo";
import { notifyRunFailedWith, type MailerDeps } from "@/lib/mailer/policy";
import type { MailProvider } from "@/lib/mailer/provider";
import type { Message } from "@/lib/mailer/templates";
import { defaultRuleSettings } from "@/lib/mailer/limits";
import type { AlertJob, AlertRule, AlertRun } from "@/lib/mailer/types";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const POOL_ID = `0x${"11".repeat(32)}`;

function env() {
  vi.stubEnv("MAILER_ENABLED", "1");
  vi.stubEnv("MAILER_PROVIDER", "postmark");
  vi.stubEnv("MAILER_PROVIDER_TOKEN", "test-token-not-real");
  vi.stubEnv("MAILER_FROM", "alerts@uptime.example");
  vi.stubEnv("MAILER_TOKEN_SECRET", "x".repeat(40));
  vi.stubEnv("MAILER_PUBLIC_URL", "https://uptime.example");
  vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN", "0.000000000000001"); // 1000 wei
  vi.stubEnv("MAILER_KEY", `0x${"22".repeat(32)}`);
  vi.stubEnv("UPTIME_POOL_BRADBURY", `0x${"33".repeat(20)}`);
}

function fakeProvider() {
  const sent: Message[] = [];
  const p: MailProvider & { sent: Message[]; fail?: "permanent" | "transient" } = {
    sent,
    async deliver(msg) {
      if (p.fail) return { ok: false, kind: p.fail, error: "postmark_300" };
      sent.push(msg);
      return { ok: true, id: `m${sent.length}` };
    },
    async suppressions() {
      return [];
    },
  };
  return p;
}

function fakeCharger(result: (req: ChargeRequest) => ChargeResult = () => ({ outcome: "charged", txHash: "0xabc" })) {
  const calls: ChargeRequest[] = [];
  const c: PoolCharger & { calls: ChargeRequest[] } = {
    calls,
    async charge(req) {
      calls.push(req);
      return result(req);
    },
  };
  return c;
}

/** A full rule: the owner's defaults, switched on, plus overrides. */
const rule = (over: Partial<AlertRule> & { recipientIds: number[] }): AlertRule => ({
  ...defaultRuleSettings(),
  enabled: true,
  jobId: "j1",
  ownerWallet: OWNER,
  ...over,
});

let clock = new Date("2026-11-02T12:00:00Z");
const advance = (min: number) => (clock = new Date(clock.getTime() + min * 60_000));

async function setup(opts: { charger?: ReturnType<typeof fakeCharger>; recipients?: string[]; studioAllowed?: boolean } = {}) {
  const repo = memoryAlertsRepo();
  const provider = fakeProvider();
  const charger = opts.charger ?? fakeCharger();
  const logs: string[] = [];
  const deps: MailerDeps = {
    repo,
    provider,
    charger,
    studioAllowed: () => opts.studioAllowed ?? true,
    now: () => clock,
    log: (l) => logs.push(l),
  };
  const ids: number[] = [];
  for (const e of opts.recipients ?? ["ana@example.com"]) {
    const { recipient } = await repo.upsertRecipient(OWNER, e, clock);
    await repo.confirmRecipient(recipient.id, clock);
    ids.push(recipient.id);
  }
  await repo.setRule(rule({ jobId: "j1", failAfter: 1, recipientIds: ids }), clock);
  return { repo, provider, charger, deps, ids, logs };
}

const job = (over: Partial<AlertJob> = {}): AlertJob => ({
  id: "j1",
  owner: OWNER.toUpperCase().replace("0X", "0x"),
  name: "My <b>job</b>",
  network: "bradbury",
  poolId: POOL_ID,
  ...over,
});
let runSeq = 0;
const failedRun = (over: Partial<AlertRun> = {}): AlertRun => ({
  id: `r${++runSeq}`,
  steps: [{ status: "ACCEPTED" }],
  pass: false,
  ...over,
});
const cfg = (patch: Partial<MailerConfig["limits"]> = {}): MailerConfig => {
  const c = readConfig();
  return { ...c, limits: { ...c.limits, ...patch } };
};

beforeEach(() => {
  env();
  clock = new Date("2026-11-02T12:00:00Z");
});
afterEach(() => vi.unstubAllEnvs());

describe("switches", () => {
  it("does nothing at all when MAILER_ENABLED is unset", async () => {
    vi.stubEnv("MAILER_ENABLED", "");
    const { deps, provider, charger, repo } = await setup();
    expect(await notifyRunFailedWith(deps, job(), failedRun())).toEqual({ status: "disabled" });
    expect(provider.sent).toHaveLength(0);
    expect(charger.calls).toHaveLength(0);
    expect(repo.emails).toHaveLength(0);
  });

  it("is NOT ARMED without a provider token, and names it", async () => {
    vi.stubEnv("MAILER_PROVIDER_TOKEN", "");
    const { deps, provider } = await setup();
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res).toMatchObject({ status: "not_armed" });
    expect(res.status === "not_armed" && res.missing).toContain("MAILER_PROVIDER_TOKEN");
    expect(provider.sent).toHaveLength(0);
  });

  it("Bradbury is not armed when the operator prices email at 0", async () => {
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN", "0");
    const { deps, charger } = await setup();
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res.status === "not_armed" && res.missing).toContain("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN");
    expect(charger.calls).toHaveLength(0);
  });

  it("charges the price from lib/pricing (default 0.01 GEN when unset)", async () => {
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN", "");
    const { deps, charger } = await setup();
    await notifyRunFailedWith(deps, job(), failedRun());
    expect(charger.calls[0].amountWei).toBe(10n ** 16n);
  });
});

describe("failure detection and rules", () => {
  it("a passing run with no prior alert sends nothing; an undecided one is not decided", async () => {
    const { deps, provider } = await setup();
    expect((await notifyRunFailedWith(deps, job(), failedRun({ pass: true }))).status).toBe("not_down");
    expect(
      (await notifyRunFailedWith(deps, job(), failedRun({ pass: null, steps: [{ status: "PENDING" }] }))).status
    ).toBe("not_decided");
    expect(provider.sent).toHaveLength(0);
  });

  it("treats a step that is not ACCEPTED as a failure even with pass=null", async () => {
    const { deps, provider } = await setup();
    const res = await notifyRunFailedWith(deps, job(), failedRun({ pass: null, steps: [{ status: "TIMEOUT" }] }));
    expect(res.status).toBe("done");
    expect(provider.sent[0].text).toContain("a transaction timed out");
  });

  it("waits for failAfter consecutive failures", async () => {
    const { deps, repo, ids } = await setup();
    await repo.setRule(rule({ jobId: "j1", failAfter: 3, recipientIds: ids }), clock);
    expect((await notifyRunFailedWith(deps, job(), failedRun(), { consecutiveFailures: 2 })).status).toBe("below_threshold");
    expect((await notifyRunFailedWith(deps, job(), failedRun(), { consecutiveFailures: 3 })).status).toBe("done");
  });

  it("refuses a rule whose owner is not the job owner", async () => {
    const { deps } = await setup();
    expect((await notifyRunFailedWith(deps, job({ owner: OTHER }), failedRun())).status).toBe("no_rule");
  });

  it("skips a recipient that is unverified or belongs to another wallet", async () => {
    const { deps, repo, provider } = await setup();
    const { recipient: unverified } = await repo.upsertRecipient(OWNER, "pending@example.com", clock);
    const { recipient: foreign } = await repo.upsertRecipient(OTHER, "foreign@example.com", clock);
    await repo.confirmRecipient(foreign.id, clock);
    await repo.setRule(rule({ jobId: "j1", failAfter: 1, recipientIds: [unverified.id, foreign.id] }), clock);
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res.status === "done" && res.decisions.map((d) => d.reason)).toEqual(["not_verified", "not_verified"]);
    expect(provider.sent).toHaveLength(0);
  });
});

describe("charge before send (Bradbury)", () => {
  it("charges role 2 for the price with settlementId = email id, THEN sends", async () => {
    const order: string[] = [];
    const charger = fakeCharger(() => {
      order.push("charge");
      return { outcome: "charged", txHash: "0xfeed" };
    });
    const { deps, provider, repo } = await setup({ charger });
    const orig = provider.deliver;
    provider.deliver = async (m, e) => {
      order.push("send");
      return orig(m, e);
    };
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(order).toEqual(["charge", "send"]);
    expect(charger.calls[0]).toMatchObject({ poolId: POOL_ID, ownerWallet: OWNER, amountWei: BigInt(1000), settlementId: BigInt(1) });
    expect(res.status === "done" && res.decisions[0]).toMatchObject({ outcome: "sent", chargeTx: "0xfeed" });
    expect(repo.emails[0]).toMatchObject({ outcome: "sent", chargeTx: "0xfeed", priceWei: "1000" });
  });

  it("does NOT send when the pool emitted ChargeSkipped", async () => {
    const charger = fakeCharger(() => ({ outcome: "skipped", reason: "OverPeriodCap", txHash: "0xdead" }));
    const { deps, provider, repo } = await setup({ charger });
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(provider.sent).toHaveLength(0);
    expect(res.status === "done" && res.decisions[0]).toMatchObject({ outcome: "refused", reason: "charge_skipped:OverPeriodCap" });
    expect(repo.emails[0]).toMatchObject({ outcome: "refused", chargeTx: "0xdead" });
  });

  it("does NOT send when the charge failed or threw", async () => {
    const failing = fakeCharger(() => ({ outcome: "failed", reason: "simulate:SettlementReplayed" }));
    const a = await setup({ charger: failing });
    await notifyRunFailedWith(a.deps, job(), failedRun());
    expect(a.provider.sent).toHaveLength(0);

    const throwing: PoolCharger = { charge: async () => Promise.reject(new Error("rpc down")) };
    const b = await setup({ charger: throwing as ReturnType<typeof fakeCharger> });
    const res = await notifyRunFailedWith(b.deps, job(), failedRun());
    expect(b.provider.sent).toHaveLength(0);
    expect(res.status === "done" && res.decisions[0].outcome).toBe("refused");
  });

  it("refuses a Bradbury job without a pool id, before touching the chain", async () => {
    const { deps, charger } = await setup();
    expect(await notifyRunFailedWith(deps, job({ poolId: undefined }), failedRun())).toEqual({ status: "throttled", reason: "no_pool" });
    expect(charger.calls).toHaveLength(0);
  });

  it("a refused charge does not use up the job cooldown", async () => {
    let skip = true;
    const charger = fakeCharger(() => (skip ? { outcome: "skipped", reason: "PoolPaused" } : { outcome: "charged", txHash: "0x1" }));
    const { deps, provider } = await setup({ charger });
    await notifyRunFailedWith(deps, job(), failedRun());
    skip = false;
    advance(1);
    await notifyRunFailedWith(deps, job(), failedRun());
    expect(provider.sent).toHaveLength(1);
  });
});

describe("cooldowns and caps (checked before the chain)", () => {
  it("job cooldown: one alert per job per 15 min", async () => {
    const { deps, provider, charger } = await setup();
    await notifyRunFailedWith(deps, job(), failedRun());
    advance(5);
    expect(await notifyRunFailedWith(deps, job(), failedRun())).toEqual({ status: "throttled", reason: "job_cooldown" });
    expect(charger.calls).toHaveLength(1);
    advance(11);
    await notifyRunFailedWith(deps, job(), failedRun());
    expect(provider.sent).toHaveLength(2);
  });

  it("the same run is never mailed twice (claim is idempotent)", async () => {
    const { deps, provider, charger } = await setup();
    const run = failedRun();
    const c = cfg({ recipientCooldownMin: 0 });
    await notifyRunFailedWith(deps, job(), run, { config: c });
    const again = await notifyRunFailedWith(deps, job(), run, { config: c });
    expect(again.status === "done" && again.decisions[0].reason).toBe("duplicate");
    expect(provider.sent).toHaveLength(1);
    expect(charger.calls).toHaveLength(1);
  });

  it("all recipients of one run get the alert despite the job cooldown", async () => {
    const { deps, provider } = await setup({ recipients: ["a1@example.com", "a2@example.com", "a3@example.com"] });
    await notifyRunFailedWith(deps, job(), failedRun());
    expect(provider.sent.map((m) => m.to)).toEqual(["a1@example.com", "a2@example.com", "a3@example.com"]);
  });

  it("per-recipient cooldown applies across jobs", async () => {
    const { deps, repo, ids, provider, charger } = await setup();
    await repo.setRule(rule({ jobId: "j2", failAfter: 1, recipientIds: ids }), clock);
    await notifyRunFailedWith(deps, job(), failedRun(), { config: cfg({ recipientCooldownMin: 30 }) });
    advance(1);
    const res = await notifyRunFailedWith(deps, job({ id: "j2" }), failedRun(), { config: cfg({ recipientCooldownMin: 30 }) });
    expect(res.status === "done" && res.decisions[0].reason).toBe("recipient_cooldown");
    expect(provider.sent).toHaveLength(1);
    expect(charger.calls).toHaveLength(1);
  });

  it("per-job daily cap is the owner's rule.perJobPerDay", async () => {
    const { deps, provider, repo, ids } = await setup();
    await repo.setRule(rule({ recipientIds: ids, perJobPerDay: 2, cooldownMin: 5 }), clock);
    const c = cfg({ recipientCooldownMin: 0 });
    for (let i = 0; i < 4; i++) {
      await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
      advance(6);
    }
    expect(provider.sent).toHaveLength(2);
  });

  it("the default per-job cap is 10 a day", async () => {
    const { deps, provider, repo, ids } = await setup();
    await repo.setRule(rule({ recipientIds: ids, cooldownMin: 5 }), clock);
    for (let i = 0; i < 14; i++) {
      await notifyRunFailedWith(deps, job(), failedRun(), { config: cfg({ recipientCooldownMin: 0 }) });
      advance(6);
    }
    expect(provider.sent).toHaveLength(10);
  });

  it("job cooldown is the owner's rule.cooldownMin", async () => {
    const { deps, provider, repo, ids } = await setup();
    await repo.setRule(rule({ recipientIds: ids, cooldownMin: 60 }), clock);
    await notifyRunFailedWith(deps, job(), failedRun());
    advance(30);
    expect(await notifyRunFailedWith(deps, job(), failedRun())).toEqual({ status: "throttled", reason: "job_cooldown" });
    advance(31);
    await notifyRunFailedWith(deps, job(), failedRun());
    expect(provider.sent).toHaveLength(2);
  });

  it("per-recipient daily cap: the address's own cap, else the default 20", async () => {
    const { deps, provider, repo, ids } = await setup();
    await repo.setRule(rule({ recipientIds: ids, cooldownMin: 5, perJobPerDay: 50 }), clock);
    await repo.setRecipientCap(ids[0], OWNER, 3, clock);
    const c = cfg({ recipientCooldownMin: 0 });
    for (let i = 0; i < 5; i++) {
      await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
      advance(6);
    }
    expect(provider.sent).toHaveLength(3);
    await repo.setRecipientCap(ids[0], OWNER, null, clock);
    for (let i = 0; i < 30; i++) {
      await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
      advance(6);
    }
    expect(provider.sent).toHaveLength(20);
  });

  it("global ceiling stops everyone, and the chain is not hit", async () => {
    const { deps, provider, charger, repo, ids } = await setup({ recipients: ["a@example.com", "b@example.com"] });
    await repo.setRule(rule({ jobId: "j1", failAfter: 1, recipientIds: ids }), clock);
    const res = await notifyRunFailedWith(deps, job(), failedRun(), { config: cfg({ globalPerDay: 1 }) });
    expect(res.status === "done" && res.decisions.map((d) => d.reason ?? d.outcome)).toEqual(["sent", "global_ceiling"]);
    expect(provider.sent).toHaveLength(1);
    expect(charger.calls).toHaveLength(1);
  });

  it("windows roll: a cap frees up after 24h", async () => {
    const { deps, provider, repo, ids } = await setup();
    const c = cfg();
    await repo.setRule(rule({ recipientIds: ids, perJobPerDay: 1 }), clock);
    await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
    advance(60);
    await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
    advance(24 * 60);
    await notifyRunFailedWith(deps, job(), failedRun(), { config: c });
    expect(provider.sent).toHaveLength(2);
  });
});

describe("Studio", () => {
  it("is free (no charge) under a per-wallet daily quota", async () => {
    const { deps, provider, charger, repo, ids } = await setup();
    await repo.setRule(rule({ recipientIds: ids, cooldownMin: 5 }), clock);
    const c = cfg({ studioPerWalletPerDay: 2, recipientCooldownMin: 0 });
    for (let i = 0; i < 3; i++) {
      await notifyRunFailedWith(deps, job({ network: "studio", poolId: undefined }), failedRun(), { config: c });
      advance(6);
    }
    expect(provider.sent).toHaveLength(2);
    expect(charger.calls).toHaveLength(0);
  });

  it("only for allowlisted wallets", async () => {
    const { deps, provider } = await setup({ studioAllowed: false });
    expect(await notifyRunFailedWith(deps, job({ network: "studio" }), failedRun())).toEqual({
      status: "throttled",
      reason: "studio_not_allowed",
    });
    expect(provider.sent).toHaveLength(0);
  });
});

describe("suppression", () => {
  it("a suppressed address is recorded, never charged, never mailed", async () => {
    const { deps, provider, charger, repo } = await setup();
    await repo.suppress("ana@example.com", "hard_bounce", null, clock);
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res.status === "done" && res.decisions[0].outcome).toBe("suppressed");
    expect(charger.calls).toHaveLength(0);
    expect(provider.sent).toHaveLength(0);
    expect(repo.emails[0].outcome).toBe("suppressed");
  });

  it("a suppression store failure refuses", async () => {
    const { deps, provider, repo } = await setup();
    repo.isSuppressed = async () => Promise.reject(new Error("db down"));
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res.status === "done" && res.decisions[0].reason).toBe("suppression_check_failed");
    expect(provider.sent).toHaveLength(0);
  });

  it("an unsubscribe landing between charge and send stops the send", async () => {
    const { deps, provider, repo } = await setup();
    const charger = fakeCharger(() => {
      void repo.suppress("ana@example.com", "unsubscribe", null, clock);
      return { outcome: "charged", txHash: "0x9" };
    });
    deps.charger = charger;
    const res = await notifyRunFailedWith(deps, job(), failedRun());
    expect(res.status === "done" && res.decisions[0].reason).toBe("suppressed_before_send");
    expect(provider.sent).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("a provider failure is recorded and not retried", async () => {
    const { deps, provider, repo } = await setup();
    provider.fail = "transient";
    const run = failedRun();
    await notifyRunFailedWith(deps, job(), run);
    expect(repo.emails[0]).toMatchObject({ outcome: "failed", reason: "transient:postmark_300" });
    provider.fail = undefined;
    await notifyRunFailedWith(deps, job(), run);
    expect(provider.sent).toHaveLength(0);
  });

  it("the message is a fixed template: name escaped, unsubscribe headers present", async () => {
    const { deps, provider } = await setup();
    await notifyRunFailedWith(deps, job({ name: "<script>x</script> visit https://evil.example\r\nBcc: a@b" }), failedRun());
    const m = provider.sent[0];
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).not.toContain("https://evil");
    expect(m.headers.map(([k]) => k)).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post", "Auto-Submitted"]);
    expect(m.headers[0][1]).toMatch(/^<https:\/\/uptime\.example\/api\/alerts\/unsubscribe\?e=ana%40example\.com&t=/);
  });

  it("never throws: a repo crash becomes status error", async () => {
    const { deps, repo } = await setup();
    repo.getRule = async () => Promise.reject(new Error("boom"));
    expect(await notifyRunFailedWith(deps, job(), failedRun())).toEqual({ status: "error", error: "boom" });
  });
});
