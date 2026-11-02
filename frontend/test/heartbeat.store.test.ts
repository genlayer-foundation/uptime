// Store selection without any backing service: no DATABASE_URL and no KV.
import { afterEach, describe, expect, it } from "vitest";

const saved = { ...process.env };

describe("Heartbeat store selection", () => {
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is unconfigured with neither DATABASE_URL nor KV, and the API says so (503)", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const store = await import("@/lib/heartbeat/store");
    expect(store.storeConfigured()).toBe(false);
    await expect(store.nextTick()).rejects.toThrow(/No Heartbeat store configured/);
    const { GET } = await import("@/app/api/heartbeat/route");
    const res = await GET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(503);
  });

  it("counts DATABASE_URL alone, or KV alone, as configured", async () => {
    const store = await import("@/lib/heartbeat/store");
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    process.env.DATABASE_URL = "postgres://localhost/none";
    expect(store.storeConfigured()).toBe(true);
    delete process.env.DATABASE_URL;
    process.env.KV_REST_API_URL = "https://kv.invalid";
    process.env.KV_REST_API_TOKEN = "t";
    expect(store.storeConfigured()).toBe(true);
  });
});
