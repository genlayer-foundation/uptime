// Bradbury Heartbeat on Postgres: migration 011, the store, the one-time KV
// import and both /api/heartbeat shapes, against a throwaway local Postgres.
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

const rec = (over: Partial<ProbeRecord> & Pick<ProbeRecord, "id" | "tick" | "kind">): ProbeRecord => ({
  submittedAt: 1_800_000_000 + over.tick * 3600,
  ...over,
});

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

  it("applies 011_heartbeat.sql", () => {
    const r = spawnSync("node", [path.join(__dirname, "..", "scripts", "migrate.mjs")], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr);
    expect(r.stdout).toMatch(/applied 011_heartbeat\.sql/);
  });

  it("imports the KV history once: list order, pending, and the tick continues", async () => {
    const { getPool } = await import("@/lib/jobs/db");
    const { importOnce } = await import("@/lib/heartbeat/store-pg");
    const a = rec({ id: "40:deploy:", tick: 40, kind: "deploy", status: "ACCEPTED" });
    const b = rec({ id: "41:llm:q1", tick: 41, kind: "llm", qid: "q1", status: "TIMEOUT" });
    const b2 = { ...b, status: "ACCEPTED", grade: "correct" as const };
    const c = rec({ id: "39:fetch:", tick: 39, kind: "fetch", status: "SUBMIT_FAILED" });
    const p = rec({ id: "42:llm:q2", tick: 42, kind: "llm", qid: "q2" });
    const snap = { tick: 42, pending: [p, a], results: [a, b, c, b2] };
    expect(await importOnce(getPool(), async () => snap)).toBe(4);
    expect(await importOnce(getPool(), async () => { throw new Error("must not read KV twice"); })).toBe(0);

    const store = await import("@/lib/heartbeat/store");
    // Resolve order is the list's, the duplicate id keeps its later entry.
    expect(await store.getResults(0)).toEqual([a, c, b2]);
    expect(await store.getPending()).toEqual([p]);
    expect(await store.nextTick()).toBe(43);
  });

  it("round-trips records exactly (same text, same key order) through pending and resolve", async () => {
    const store = await import("@/lib/heartbeat/store");
    const r = rec({ id: "43:llm:q3", tick: 43, kind: "llm", qid: "q3", qkind: "fact", txHash: "0xabc", appealDue: true });
    await store.addPending(r);
    const [got] = (await store.getPending()).filter((x) => x.id === r.id);
    expect(JSON.stringify(got)).toBe(JSON.stringify(r));
    const done = { ...r, status: "ACCEPTED", resolvedAt: r.submittedAt + 90, latencySec: 80, rounds: 1,
      votes: { agree: 4, disagree: 1, timeout: 0, other: 0 }, answer: "Paris", grade: "correct" as const };
    await store.resolve(done);
    expect((await store.getPending()).map((x) => x.id)).not.toContain(r.id);
    const results = await store.getResults(0);
    expect(JSON.stringify(results.at(-1))).toBe(JSON.stringify(done));
    // since filter is on submittedAt
    expect((await store.getResults(done.submittedAt)).map((x) => x.id)).toEqual([done.id]);
  });

  it("serves /api/heartbeat (summary and ?format=rows) from Postgres, same shapes as before", async () => {
    const { getPool } = await import("@/lib/jobs/db");
    await getPool().query("TRUNCATE heartbeat_probes");
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
      "time", "tick", "kind", "qid", "qkind", "status", "grade", "correct", "injected", "upheld",
      "latency_sec", "rounds", "votes_agree", "votes_disagree", "votes_timeout", "answer", "tx", "error",
    ]);
    expect(rows[0].time).toBe(win[0].submittedAt * 1000);
    expect(rows.at(-1).tx).toBe(win.at(-1)!.txHash ?? "");
  });
});
