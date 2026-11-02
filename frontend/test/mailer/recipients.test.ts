// Verified recipients, tokens, unsubscribe, bounces, chain-log interpretation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { interpretChargeLogs, POOL_MAILER_ABI } from "@/lib/mailer/charger";
import { memoryAlertsRepo } from "@/lib/mailer/memoryRepo";
import type { MailerDeps } from "@/lib/mailer/policy";
import { mapPostmarkReason, postmarkProvider, type MailProvider } from "@/lib/mailer/provider";
import { addRecipient, confirmRecipient, setJobRule, setRecipientCap, sweepBounces, unsubscribe } from "@/lib/mailer/recipients";
import { safeJobName } from "@/lib/mailer/templates";
import { unsubscribeToken } from "@/lib/mailer/tokens";
import type { Message } from "@/lib/mailer/templates";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
let clock = new Date("2026-11-02T12:00:00Z");

function setup(suppressionRows: Awaited<ReturnType<MailProvider["suppressions"]>> = []) {
  const repo = memoryAlertsRepo();
  const sent: Message[] = [];
  const provider: MailProvider = {
    async deliver(m) {
      sent.push(m);
      return { ok: true, id: "m" };
    },
    async suppressions() {
      return suppressionRows;
    },
  };
  const deps: MailerDeps = { repo, provider, charger: null, studioAllowed: () => true, now: () => clock, log: () => {} };
  return { repo, sent, deps };
}

function linkParams(m: Message): URLSearchParams {
  const url = m.text.match(/https:\/\/uptime\.example\/api\/alerts\/verify\?\S+/)![0];
  return new URL(url).searchParams;
}

beforeEach(() => {
  clock = new Date("2026-11-02T12:00:00Z");
  vi.stubEnv("MAILER_ENABLED", "1");
  vi.stubEnv("MAILER_PROVIDER", "postmark");
  vi.stubEnv("MAILER_PROVIDER_TOKEN", "t");
  vi.stubEnv("MAILER_FROM", "alerts@uptime.example");
  vi.stubEnv("MAILER_TOKEN_SECRET", "s".repeat(40));
  vi.stubEnv("MAILER_PUBLIC_URL", "https://uptime.example");
});
afterEach(() => vi.unstubAllEnvs());

describe("add + confirm", () => {
  it("sends one confirmation; the link confirms; the address is bound to the wallet", async () => {
    const { deps, sent, repo } = setup();
    const res = await addRecipient(deps, OWNER, " Ana@Example.com ");
    expect(res).toMatchObject({ ok: true, value: { email: "ana@example.com", state: "pending", mailed: "sent" } });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(OWNER);
    const q = linkParams(sent[0]);
    expect(await confirmRecipient(deps, { r: q.get("r"), x: q.get("x"), t: q.get("t") })).toBe(true);
    expect((await repo.listRecipients(OWNER))[0].verifiedAt).not.toBeNull();
    expect(await repo.listRecipients(OTHER)).toHaveLength(0);
  });

  it("rejects a tampered, foreign or expired token", async () => {
    const { deps, sent, repo } = setup();
    await addRecipient(deps, OWNER, "ana@example.com");
    const q = linkParams(sent[0]);
    expect(await confirmRecipient(deps, { r: q.get("r"), x: String(Number(q.get("x")) + 1), t: q.get("t") })).toBe(false);
    // same id+token, but the row now names another wallet's address: token is bound to both
    await repo.upsertRecipient(OTHER, "x@example.com", clock);
    expect(await confirmRecipient(deps, { r: "2", x: q.get("x"), t: q.get("t") })).toBe(false);
    clock = new Date(clock.getTime() + 25 * 3600_000);
    expect(await confirmRecipient(deps, { r: q.get("r"), x: q.get("x"), t: q.get("t") })).toBe(false);
  });

  it("max 3 addresses per wallet", async () => {
    const { deps } = setup();
    for (const e of ["a@example.com", "b@example.com", "c@example.com"]) {
      clock = new Date(clock.getTime() + 20 * 60_000);
      expect((await addRecipient(deps, OWNER, e)).ok).toBe(true);
    }
    expect(await addRecipient(deps, OWNER, "d@example.com")).toMatchObject({ ok: false, status: 409 });
    expect((await addRecipient(deps, OTHER, "d@example.com")).ok).toBe(true);
  });

  it("does not resend inside the cooldown, and never mails a suppressed address", async () => {
    const { deps, sent, repo } = setup();
    await addRecipient(deps, OWNER, "ana@example.com");
    expect(await addRecipient(deps, OWNER, "ana@example.com")).toMatchObject({ ok: true, value: { mailed: "pending" } });
    await repo.suppress("bob@example.com", "spam_complaint", null, clock);
    expect(await addRecipient(deps, OWNER, "bob@example.com")).toMatchObject({ ok: true, value: { mailed: "pending" } });
    expect(sent).toHaveLength(1);
  });

  it("refuses when the mailer is not armed", async () => {
    vi.stubEnv("MAILER_TOKEN_SECRET", "short");
    const { deps, sent } = setup();
    expect(await addRecipient(deps, OWNER, "ana@example.com")).toMatchObject({ ok: false, status: 503 });
    expect(sent).toHaveLength(0);
  });

  it("rejects invalid addresses", async () => {
    const { deps } = setup();
    for (const bad of ["", "nope", "a@b", "a b@example.com", "a@example.com\r\nBcc: x@y.z", 42]) {
      expect(await addRecipient(deps, OWNER, bad)).toMatchObject({ ok: false, status: 400 });
    }
  });
});

describe("job rules", () => {
  it("only the job owner, only confirmed addresses, max 3", async () => {
    const { deps, repo } = setup();
    const { recipient: r } = await repo.upsertRecipient(OWNER, "ana@example.com", clock);
    expect(await setJobRule(deps, OWNER, OWNER, "j1", { recipientIds: [r.id] })).toMatchObject({ ok: false, status: 400 });
    await repo.confirmRecipient(r.id, clock);
    expect(await setJobRule(deps, OWNER, OTHER, "j1", { recipientIds: [r.id] })).toMatchObject({ ok: false, status: 404 });
    expect(await setJobRule(deps, OWNER, OWNER, "j1", { recipientIds: [r.id] })).toMatchObject({ ok: true });
    expect(await setJobRule(deps, OWNER, OWNER, "j1", { recipientIds: [1, 2, 3, 4] })).toMatchObject({ ok: false });
  });
});

describe("unsubscribe + bounces", () => {
  it("a valid token suppresses exactly that address; a bad one does nothing", async () => {
    const { deps, repo } = setup();
    await unsubscribe(deps, { e: "ana@example.com", t: "wrong" });
    expect(repo.suppressions.size).toBe(0);
    await unsubscribe(deps, { e: "ana@example.com", t: unsubscribeToken("s".repeat(40), "bob@example.com") });
    expect(repo.suppressions.size).toBe(0);
    await unsubscribe(deps, { e: "ana@example.com", t: unsubscribeToken("s".repeat(40), "ana@example.com") });
    expect(repo.suppressions.get("ana@example.com")?.reason).toBe("unsubscribe");
  });

  it("the sweep merges provider suppressions, idempotently", async () => {
    const { deps, repo } = setup([
      { email: "x@example.com", reason: "hard_bounce", detail: "postmark:HardBounce" },
      { email: "y@example.com", reason: "spam_complaint", detail: "postmark:SpamComplaint" },
    ]);
    expect(await sweepBounces(deps)).toEqual({ seen: 2, added: 2 });
    expect(await sweepBounces(deps)).toEqual({ seen: 2, added: 0 });
    expect(repo.suppressions.get("x@example.com")?.reason).toBe("hard_bounce");
  });

  it("Postmark reasons map onto the closed vocabulary; unknown is dropped", async () => {
    expect(mapPostmarkReason("HardBounce")).toBe("hard_bounce");
    expect(mapPostmarkReason("SpamComplaint")).toBe("spam_complaint");
    expect(mapPostmarkReason("ManualSuppression")).toBe("unsubscribe");
    expect(mapPostmarkReason("SomethingNew")).toBeNull();
  });

  it("Postmark provider: permanent vs transient, never a real socket", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const code = calls.length === 1 ? 0 : calls.length === 2 ? 406 : 429;
      return new Response(JSON.stringify({ ErrorCode: code, MessageID: code === 0 ? "id-1" : undefined }), { status: code ? 422 : 200 });
    }) as typeof fetch;
    const p = postmarkProvider({ token: "t", stream: "outbound", apiBase: "http://mock", fetch: fakeFetch });
    const msg: Message = { to: "a@example.com", subject: "s", text: "t", html: "h", headers: [["Auto-Submitted", "auto-generated"]] };
    const envelope = { from: "f@example.com", fromName: "Uptime", replyTo: null };
    expect(await p.deliver(msg, envelope)).toEqual({ ok: true, id: "id-1" });
    expect(await p.deliver(msg, envelope)).toMatchObject({ ok: false, kind: "permanent" });
    expect(await p.deliver(msg, envelope)).toMatchObject({ ok: false, kind: "transient" });
    expect(calls[0].url).toBe("http://mock/email");
    expect(calls[0].body).toMatchObject({ MessageStream: "outbound", TrackOpens: false, To: "a@example.com" });
  });
});

describe("templates", () => {
  it("job name: control chars, bidi overrides and links neutralized, 60 chars max", () => {
    const rlo = String.fromCharCode(0x202e);
    expect(safeJobName(`a${rlo}b\r\nc`)).toBe("a b c");
    expect(safeJobName("see https://x.example and www.y.example")).not.toMatch(/:\/\/|www\./);
    expect(safeJobName("x".repeat(200)).length).toBe(60);
    expect(safeJobName("")).toBe("Untitled job");
  });
});

describe("charge receipt interpretation", () => {
  const pool = `0x${"33".repeat(20)}`;
  const poolId = `0x${"11".repeat(32)}` as `0x${string}`;
  const req = { poolId, amountWei: BigInt(1000), settlementId: BigInt(7) };

  function log(eventName: "Charged" | "ChargeSkipped", args: { uptimeId: `0x${string}`; role: number; settlementId: bigint }, data: `0x${string}`, address = pool): Log {
    const topics = encodeEventTopics({ abi: POOL_MAILER_ABI, eventName, args });
    return { address, topics, data, blockHash: null, blockNumber: null, logIndex: 0, transactionHash: null, transactionIndex: 0, removed: false } as unknown as Log;
  }

  it("Charged for exactly this line => charged", () => {
    const l = log("Charged", { uptimeId: poolId, role: 2, settlementId: BigInt(7) }, encodeAbiParameters([{ type: "uint256" }], [BigInt(1000)]));
    expect(interpretChargeLogs([l], pool, req).outcome).toBe("charged");
  });

  it("ChargeSkipped => skipped with the contract's reason", () => {
    const l = log(
      "ChargeSkipped",
      { uptimeId: poolId, role: 2, settlementId: BigInt(7) },
      encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [BigInt(1000), 9])
    );
    expect(interpretChargeLogs([l], pool, req)).toEqual({ outcome: "skipped", reason: "OverPeriodCap" });
  });

  it("a Charged event from another address, role, pool or settlement does not count", () => {
    const amt = encodeAbiParameters([{ type: "uint256" }], [BigInt(1000)]);
    const wrong = [
      log("Charged", { uptimeId: poolId, role: 2, settlementId: BigInt(7) }, amt, `0x${"44".repeat(20)}`),
      log("Charged", { uptimeId: poolId, role: 1, settlementId: BigInt(7) }, amt),
      log("Charged", { uptimeId: `0x${"22".repeat(32)}`, role: 2, settlementId: BigInt(7) }, amt),
      log("Charged", { uptimeId: poolId, role: 2, settlementId: BigInt(8) }, amt),
    ];
    expect(interpretChargeLogs(wrong, pool, req)).toEqual({ outcome: "failed", reason: "no_charge_event" });
  });

  it("a Charged event for a different amount fails", () => {
    const l = log("Charged", { uptimeId: poolId, role: 2, settlementId: BigInt(7) }, encodeAbiParameters([{ type: "uint256" }], [BigInt(1)]));
    expect(interpretChargeLogs([l], pool, req)).toEqual({ outcome: "failed", reason: "charged_amount_mismatch" });
  });
});

describe("self-serve settings", () => {
  async function confirmed() {
    const s = setup();
    const { recipient } = await s.repo.upsertRecipient(OWNER, "ana@example.com", clock);
    await s.repo.confirmRecipient(recipient.id, clock);
    return { ...s, id: recipient.id };
  }

  it("setJobRule stores the owner's triggers and limits exactly", async () => {
    const { deps, repo, id } = await confirmed();
    const res = await setJobRule(deps, OWNER, OWNER, "j1", { recipientIds: [id], perJobPerDay: 25, cooldownMin: 30, digest: true, onRecovery: false });
    expect(res.ok).toBe(true);
    expect(await repo.getRule("j1")).toMatchObject({ enabled: true, perJobPerDay: 25, cooldownMin: 30, digest: true, onRecovery: false, onFailure: true });
  });

  it("setJobRule refuses out-of-range limits with a per-field error, and stores nothing", async () => {
    const { deps, repo, id } = await confirmed();
    const res = await setJobRule(deps, OWNER, OWNER, "j1", { recipientIds: [id], perJobPerDay: 51, cooldownMin: 4 });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(!res.ok && Object.keys(res.fields ?? {}).sort()).toEqual(["cooldownMin", "perJobPerDay"]);
    expect(await repo.getRule("j1")).toBeNull();
  });

  it("setRecipientCap: 1-100 on your own address, null resets, others are not found", async () => {
    const { deps, id } = await confirmed();
    expect(await setRecipientCap(deps, OWNER, id, 7)).toMatchObject({ ok: true, value: { dailyCap: 7, dailyCapDefault: false } });
    expect(await setRecipientCap(deps, OWNER, id, null)).toMatchObject({ ok: true, value: { dailyCap: 20, dailyCapDefault: true } });
    expect(await setRecipientCap(deps, OWNER, id, 101)).toMatchObject({ ok: false, status: 400 });
    expect(await setRecipientCap(deps, OTHER, id, 5)).toMatchObject({ ok: false, status: 404 });
  });
});
