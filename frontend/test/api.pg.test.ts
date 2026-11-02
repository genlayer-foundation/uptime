// End-to-end through the real route handlers, real SQL and a real SIWE
// signature, against a throwaway local Postgres. Skipped unless
// TEST_DATABASE_URL is set (it DROPS the public schema of that database):
//   createdb uptime_test
//   TEST_DATABASE_URL=postgres://localhost/uptime_test npx vitest run
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job, Run } from "@/lib/jobs/types";

const url = process.env.TEST_DATABASE_URL;
const BASE = "http://localhost:3000";
const C1 = "0x1111111111111111111111111111111111111111";

describe.skipIf(!url)("API against Postgres", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  let cookie = "";

  beforeAll(async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.end();
    const r = spawnSync("node", [path.join(__dirname, "..", "scripts", "migrate.mjs")], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr);
    expect(r.stdout).toMatch(/applied 001_init\.sql[\s\S]*applied 010_alerts\.sql/);
    process.env.DATABASE_URL = url;
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/jobs/db");
    await getPool().end();
  });

  const req = (p: string, init: RequestInit = {}) =>
    new Request(`${BASE}${p}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) } });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("refuses user routes without a session", async () => {
    const { GET } = await import("@/app/api/jobs/route");
    expect((await GET(req("/api/jobs"))).status).toBe(401);
  });

  it("signs in with a wallet signature (SIWE), single-use nonce", async () => {
    const nonceRoute = await import("@/app/api/auth/nonce/route");
    const verify = await import("@/app/api/auth/verify/route");
    const me = await import("@/app/api/me/route");
    const { nonce } = await (await nonceRoute.POST()).json();
    const message = createSiweMessage({
      address: account.address, chainId: 4221, domain: "localhost:3000", nonce, uri: BASE, version: "1",
      statement: "Sign in to GenLayer Uptime",
    });
    const signature = await account.signMessage({ message });
    const res = await verify.POST(req("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wallet: account.address.toLowerCase(), studioAllowed: false });
    cookie = res.headers.get("set-cookie")!.split(";")[0];
    const again = await verify.POST(req("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) }));
    expect(again.status).toBe(401); // nonce spent
    expect(await (await me.GET(req("/api/me"))).json()).toMatchObject({ ready: true, wallet: account.address.toLowerCase() });
  });

  it("rejects a signature from a different wallet", async () => {
    const nonceRoute = await import("@/app/api/auth/nonce/route");
    const verify = await import("@/app/api/auth/verify/route");
    const { nonce } = await (await nonceRoute.POST()).json();
    const message = createSiweMessage({ address: account.address, chainId: 4221, domain: "localhost:3000", nonce, uri: BASE, version: "1" });
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    const res = await verify.POST(new Request(`${BASE}/api/auth/verify`, { method: "POST", body: JSON.stringify({ message, signature }) }));
    expect(res.status).toBe(401);
  });

  const body = (network: string) =>
    JSON.stringify({
      name: "check", network, schedule: { everyMinutes: 5 },
      steps: [
        { id: "call", kind: "write", contract: C1, method: "check_url", args: ["{{job_id}}", "{{run_id}}", "https://example.com", 0, ""] },
        { id: "result", kind: "read", contract: C1, method: "get_run", args: ["{{relayer}}", "{{job_id}}", "{{run_id}}"] },
      ],
      assertions: [{ step: "result", path: "result.ok", op: "eq", expected: true }],
    });

  it("refuses a Studio create from a non-allowlisted wallet (403) and stores nothing", async () => {
    const { POST, GET } = await import("@/app/api/jobs/route");
    const res = await POST(req("/api/jobs", { method: "POST", body: body("studio") }));
    expect(res.status).toBe(403);
    expect((await (await GET(req("/api/jobs"))).json()).jobs).toEqual([]);
  });

  it("refuses a cross-site mutation", async () => {
    const { POST } = await import("@/app/api/jobs/route");
    const res = await POST(req("/api/jobs", { method: "POST", body: body("bradbury"), headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("CRUD on Bradbury: draft create, list, read, edit, pause/resume gate, runs, delete", async () => {
    const jobs = await import("@/app/api/jobs/route");
    const one = await import("@/app/api/jobs/[id]/route");
    const pause = await import("@/app/api/jobs/[id]/pause/route");
    const resume = await import("@/app/api/jobs/[id]/resume/route");
    const runs = await import("@/app/api/jobs/[id]/runs/route");

    const res = await jobs.POST(req("/api/jobs", { method: "POST", body: body("bradbury") }));
    expect(res.status).toBe(201);
    const { job, status } = (await res.json()) as { job: Job; status: { state: string } };
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job).toMatchObject({ network: "bradbury", paused: true, schedule: { everyMinutes: 5 }, owner: account.address.toLowerCase() });
    expect(job.poolId).toBe(`0x${"0".repeat(32)}${job.id.replaceAll("-", "")}`);
    expect(status.state).toBe("draft");

    const list = await (await jobs.GET(req("/api/jobs"))).json();
    expect(list.jobs).toHaveLength(1);
    expect(list.meta[job.id]).toMatchObject({ lastRun: null, status: { state: "draft" } });

    expect((await (await one.GET(req(`/api/jobs/${job.id}`), ctx(job.id))).json()).owner).toBe(true);
    const edited = await one.PATCH(req(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ name: "renamed", schedule: { cron: "*/10 * * * *" } }) }), ctx(job.id));
    expect((await edited.json()).job).toMatchObject({ name: "renamed", schedule: { cron: "*/10 * * * *" } });
    const bad = await one.PATCH(req(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ schedule: { everyMinutes: 1 } }) }), ctx(job.id));
    expect(bad.status).toBe(400);

    // No pool contract configured and not allowlisted: resume refused (409).
    expect((await resume.POST(req(`/api/jobs/${job.id}/resume`, { method: "POST" }), ctx(job.id))).status).toBe(409);
    expect((await (await pause.POST(req(`/api/jobs/${job.id}/pause`, { method: "POST" }), ctx(job.id))).json()).status.state).toBe("paused");

    expect(await (await runs.GET(req(`/api/jobs/${job.id}/runs`), ctx(job.id))).json()).toEqual({ runs: [] });

    // Another visitor (no cookie) cannot see it; a junk id is a 404.
    expect((await one.GET(new Request(`${BASE}/api/jobs/${job.id}`), ctx(job.id))).status).toBe(404);
    expect((await one.GET(req("/api/jobs/12"), ctx("12"))).status).toBe(404);

    expect((await one.DELETE(req(`/api/jobs/${job.id}`, { method: "DELETE" }), ctx(job.id))).status).toBe(200);
    expect((await (await jobs.GET(req("/api/jobs"))).json()).jobs).toEqual([]);
  });

  it("serves presets and public jobs without auth", async () => {
    const presets = await import("@/app/api/presets/route");
    const jobs = await import("@/app/api/jobs/route");
    const p = await (await presets.GET(new Request(`${BASE}/api/presets?network=studio`))).json();
    expect(p.presets.map((x: { id: string }) => x.id)).toEqual(
      ["heartbeat", "check-url", "check-api", "ask", "call-contract", "deploy-contract", "deploy-then-call"]
    );
    expect((await (await jobs.GET(new Request(`${BASE}/api/jobs?public=1`))).json()).jobs).toEqual([]);
  });

  it("the SQL executor path: claim once, chain steps, record, export, settle", async () => {
    const { PgRepo } = await import("@/lib/jobs/repo");
    const { getPool } = await import("@/lib/jobs/db");
    const { dispatchDue, reconcile, toPublicRun, ensureHeartbeatJob } = await import("@/lib/jobs/executor");
    const { toRows } = await import("@/lib/jobs/export");
    const { settle } = await import("@/lib/jobs/pool/pool");
    const { newId, poolIdFor } = await import("@/lib/jobs/ids");
    const repo = new PgRepo(getPool());
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await repo.createJob({
      id, owner: account.address.toLowerCase(), name: "x", network: "bradbury", preset: null,
      schedule: { everyMinutes: 5 },
      steps: [
        { id: "d", kind: "deploy", preset: "canary", args: ["{{slot}}"] },
        { id: "r", kind: "read", contract: "$d.address", method: "get_tick", args: [] },
      ],
      assertions: [{ step: "r", op: "gt", expected: 0 }],
      state: "active", poolId: poolIdFor(id),
      schedules: [{ action: "job", intervalSec: 300, cron: null, anchorAt: now - 600, nextDueAt: now - 600, lastSlotAt: null }],
    });
    expect(await repo.claimSlot(id, "job", now - 1, now, now + 300)).toBe(false);

    const client = {
      deployContract: async () => "0xd0" as `0x${string}`,
      writeContract: async () => "0xw0",
      readContract: async () => BigInt(5),
      getTransaction: async () => ({ statusName: "ACCEPTED", createdTimestamp: "10", lastVoteTimestamp: "22", txDataDecoded: { contractAddress: C1 } }),
    };
    const deps = {
      repo, gate: { allowlist: new Set<string>(), funding: async () => ({ ok: true }) },
      clientFor: () => client, relayerFor: () => C1, nowSec: () => now, deployPresets: { canary: "# canary" },
      runCostWei: () => BigInt(7),
    };
    expect((await dispatchDue(deps)).started).toBe(1);
    expect((await dispatchDue(deps)).started).toBe(0); // claimed once
    await reconcile(deps);
    const [run] = await repo.listRuns(id, 5);
    const pub: Run = toPublicRun(run);
    expect(pub.pass).toBe(true);
    expect(pub.steps).toEqual([
      { stepId: "d", status: "ACCEPTED", txHash: "0xd0", result: { address: C1, execution: null }, timeToAcceptedMs: 12_000, gasGen: "0.000000000000000007" },
      expect.objectContaining({ stepId: "r", status: "ACCEPTED", result: 5 }),
    ]);
    expect(await repo.lastDeployAddress(id, "d")).toBe(C1);
    expect(toRows([run])[0]).toMatchObject({ runId: run.id, jobId: id, stepId: "d", status: "ACCEPTED", pass: true, pass_num: 1, latency_sec: 12, timeToAcceptedMs: 12_000, tx: "0xd0", txHash: "0xd0", gasGen: "0.000000000000000007" });

    // Settlement: one line (the deploy), charged once.
    const charge = async () => ({ hash: "0xc0" as `0x${string}`, outcomes: [{ charged: true }], chargedWei: "7" });
    const charger = { lastSettlement: async () => BigInt(0), simulate: async () => undefined, charge };
    expect(await settle(repo, now + 10, { enabled: true, charger: async () => charger })).toMatchObject({ lines: 1, charged: 1, onchainId: "1" });
    expect(await repo.unsettled("bradbury", now + 10, 10)).toEqual([]);
    expect(await repo.consecutiveFailures(id)).toBe(0);

    const hb = await ensureHeartbeatJob(repo, C1, C1, now);
    expect((await ensureHeartbeatJob(repo, C1, C1, now))!.id).toBe(hb!.id);
    const jobs = await import("@/app/api/jobs/route");
    const pub2 = await (await jobs.GET(new Request(`${BASE}/api/jobs?public=1`))).json();
    expect(pub2.jobs.map((j: Job) => j.name)).toEqual(["Bradbury Heartbeat"]);
  });

  it("the Postgres AlertsRepo round-trips the mailer's ledger", async () => {
    const { pgAlertsRepo } = await import("@/lib/jobs/alertsRepo");
    const { getPool } = await import("@/lib/jobs/db");
    const a = pgAlertsRepo(getPool());
    const w = account.address.toLowerCase();
    const now = new Date();
    const { recipient, created } = await a.upsertRecipient(w, "ops@example.com", now);
    expect(created).toBe(true);
    expect((await a.upsertRecipient(w, "ops@example.com", now)).created).toBe(false);
    expect(await a.confirmRecipient(recipient.id, now)).toBe(true);
    await a.setRule({ jobId: "j1", ownerWallet: w, enabled: true, failAfter: 2, recipientIds: [recipient.id] }, now);
    expect(await a.getRule("j1")).toMatchObject({ failAfter: 2, recipientIds: [recipient.id] });
    const e = await a.claimEmail({ claimKey: "k1", kind: "alert", jobId: "j1", runId: "r1", recipientId: recipient.id, email: "ops@example.com", ownerWallet: w, network: "studio", priceWei: null }, now);
    expect(e).toMatchObject({ outcome: "queued" });
    expect(await a.claimEmail({ claimKey: "k1", kind: "alert", jobId: "j1", runId: "r1", recipientId: recipient.id, email: "ops@example.com", ownerWallet: w, network: "studio", priceWei: null }, now)).toBeNull();
    await a.finishEmail(e!.id, { outcome: "sent", providerMessageId: "m1" }, now);
    expect(await a.countEmails({ jobId: "j1", since: new Date(0) })).toBe(1);
    expect(await a.countEmails({ jobId: "j1", since: new Date(0), excludeRunId: "r1" })).toBe(0);
    expect(await a.lastEmailAt({ email: "ops@example.com", since: new Date(0) })).toBeInstanceOf(Date);
    expect(await a.suppress("ops@example.com", "unsubscribe", null, now)).toBe(true);
    expect(await a.isSuppressed("ops@example.com")).toBe(true);
    expect(await a.removeRecipient(recipient.id, w, now)).toBe(true);
    expect((await a.getRule("j1"))!.recipientIds).toEqual([]);
  });
});
