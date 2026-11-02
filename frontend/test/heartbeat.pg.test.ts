// Bradbury Heartbeat on Postgres: migrations 011 + 013, the store and both
// /api/heartbeat shapes, against a throwaway local Postgres.
// Skipped unless TEST_DATABASE_URL is set. Runs in its own schema (hb_test,
// via search_path) so it never races api.pg.test.ts, which drops `public`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProbeRecord } from "@/lib/heartbeat/types";

const base = process.env.TEST_DATABASE_URL;
const SCHEMA = "hb_test";
const url = base && `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;

const rec = (over: Partial<ProbeRecord> & Pick<ProbeRecord, "id" | "tick" | "kind" | "type">): ProbeRecord => ({
  submittedAt: 1_800_000_000 + over.tick * 3600,
  ...over,
});

async function getPoolTruncate() {
  const { getPool } = await import("@/lib/jobs/db");
  await getPool().query("TRUNCATE heartbeat_probes");
}

describe.skipIf(!url)("Heartbeat store on Postgres", () => {
  beforeAll(async () => {
    const c = new pg.Client({ connectionString: base });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await c.end();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    process.env.DATABASE_URL = url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/jobs/db");
    await getPool().end();
    const c = new pg.Client({ connectionString: base });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.end();
  });

  it("refuses to fall back silently when the tables are missing and there is no KV", async () => {
    const store = await import("@/lib/heartbeat/store");
    expect(store.storeConfigured()).toBe(true);
    await expect(store.getPending()).rejects.toThrow(/npm run db:migrate/);
  });

  it("applies 011_heartbeat.sql and 013_heartbeat_write.sql", () => {
    const r = spawnSync("node", [path.join(__dirname, "..", "scripts", "migrate.mjs")], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr);
    expect(r.stdout).toMatch(/applied 011_heartbeat\.sql/);
    expect(r.stdout).toMatch(/applied 013_heartbeat_write\.sql/);
  });

  it("stores every kind, write included, and counts ticks from 1", async () => {
    const store = await import("@/lib/heartbeat/store");
    expect(await store.nextTick()).toBe(1);
    const w = rec({ id: "1:write:", tick: 1, kind: "write", type: "write", status: "ACCEPTED", grade: "correct" });
    await store.resolve(w);
    expect(await store.getResults(0)).toEqual([w]);
    await getPoolTruncate();
  });

  it("round-trips records exactly (same text, same key order) through pending and resolve", async () => {
    const store = await import("@/lib/heartbeat/store");
    const r = rec({ id: "43:llm:r2-answer42", tick: 43, kind: "llm", type: "llm", qid: "r2-answer42", txHash: "0xabc", appealDue: true });
    await store.addPending(r);
    const [got] = (await store.getPending()).filter((x) => x.id === r.id);
    expect(JSON.stringify(got)).toBe(JSON.stringify(r));
    const done = { ...r, status: "ACCEPTED", resolvedAt: r.submittedAt + 90, latencySec: 80, rounds: 1,
      votes: { agree: 4, disagree: 1, timeout: 0, other: 0 }, answer: "42", grade: "correct" as const };
    await store.resolve(done);
    expect((await store.getPending()).map((x) => x.id)).not.toContain(r.id);
    const results = await store.getResults(0);
    expect(JSON.stringify(results.at(-1))).toBe(JSON.stringify(done));
    // since filter is on submittedAt
    expect((await store.getResults(done.submittedAt)).map((x) => x.id)).toEqual([done.id]);
  });

  it("serves /api/heartbeat (summary and ?format=rows) from Postgres, same shapes as before", async () => {
    await getPoolTruncate();
    const { demoSnapshot } = await import("@/lib/heartbeat/demo");
    const { summarize } = await import("@/lib/heartbeat/summary");
    const { NETWORK, getContractAddress } = await import("@/lib/genlayer/client");
    const store = await import("@/lib/heartbeat/store");
    const nowSec = Math.floor(Date.now() / 1000);
    const { results, pending } = demoSnapshot(nowSec - 48 * 3600, nowSec);
    for (const r of results) await store.resolve(r);
    for (const r of pending) await store.addPending(r);

    const { GET } = await import("@/app/api/heartbeat/route");
    const res = await GET(new Request("http://localhost/api/heartbeat?hours=24"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Heartbeat-Source")).toBeNull();
    const body = await res.json();
    const since = body.generatedAt - 24 * 3600;
    const win = results.filter((r) => r.submittedAt >= since);
    expect(win.length).toBeGreaterThan(0);
    const expected = JSON.parse(JSON.stringify({
      network: NETWORK.name,
      contract: getContractAddress() ?? null,
      explorerUrl: NETWORK.explorerUrl,
      generatedAt: body.generatedAt,
      hours: 24,
      ...summarize(win),
      pending: pending.length,
      recent: win.slice(-50).reverse(),
    }));
    expect(JSON.stringify(body)).toBe(JSON.stringify(expected));

    const rowsRes = await GET(new Request("http://localhost/api/heartbeat?hours=24&format=rows"));
    const rows = await rowsRes.json();
    expect(rows).toHaveLength(win.length);
    expect(Object.keys(rows[0])).toEqual([
      "time", "tick", "kind", "type", "probe", "status", "grade", "correct", "injected", "appeal_outcome", "upheld",
      "latency_sec", "finalized_sec", "rounds", "votes_agree", "votes_disagree", "votes_timeout", "answer", "tx", "error",
    ]);
    expect(rows[0].time).toBe(win[0].submittedAt * 1000);
    expect(rows.at(-1).tx).toBe(win.at(-1)!.txHash ?? "");
  });
});
