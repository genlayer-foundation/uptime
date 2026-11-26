import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TICK_WINDOW_MIN, appealWatchIdle, noteAppealWatch, resetAppealGate } from "@/lib/heartbeat/appealGate";

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 25, h, m, s);

describe("appeal watch gate", () => {
  beforeEach(() => resetAppealGate());

  it("stands down until the next hour once nothing is waiting after the tick window", () => {
    expect(appealWatchIdle(at(5, 20))).toBe(false);
    noteAppealWatch(0, at(5, 20));
    expect(appealWatchIdle(at(5, 21))).toBe(true);
    expect(appealWatchIdle(at(5, 59, 59))).toBe(true);
    expect(appealWatchIdle(at(6, 0))).toBe(false);
  });

  it("remembers nothing inside the tick window, when the tick may not have landed yet", () => {
    noteAppealWatch(0, at(5, 0, 27));
    noteAppealWatch(0, at(5, TICK_WINDOW_MIN - 1, 59));
    expect(appealWatchIdle(at(5, TICK_WINDOW_MIN))).toBe(false);
  });

  it("keeps watching while a probe is waiting, and across the day boundary", () => {
    noteAppealWatch(0, at(5, 30));
    noteAppealWatch(1, at(5, 31));
    expect(appealWatchIdle(at(5, 32))).toBe(false);
    noteAppealWatch(0, at(23, 40));
    expect(appealWatchIdle(at(23, 59))).toBe(true);
    expect(appealWatchIdle(at(24, 0))).toBe(false);
  });
});

describe("/api/heartbeat when the database does not answer", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://localhost/none";
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.doUnmock("@/lib/jobs/db");
    vi.restoreAllMocks();
  });

  it("answers 503 database_unavailable with the SQLSTATE, not an empty 500", async () => {
    const quota = Object.assign(new Error("Your account or project has exceeded the quota."), { code: "53000" });
    vi.doMock("@/lib/jobs/db", () => ({
      hasDatabase: () => true,
      getPool: () => ({ query: async () => Promise.reject(quota) }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/heartbeat/route");
    const res = await GET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "database_unavailable", code: "53000" });
    const rows = await GET(new Request("http://localhost/api/heartbeat?format=rows"));
    expect(rows.status).toBe(503);
  });
});
