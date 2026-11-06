// GET /api/jobs?all=1 is gated server-side, before any repo query: no session
// is 401, a signed-in non-operator is 403 (UPTIME_ADMIN_WALLETS unset or not
// listing them). Runs without Postgres; the admin happy path is in api.pg.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/jobs/auth/session";

const SECRET = "x".repeat(32);
const ALICE = "0x00000000000000000000000000000000000a11ce";
const OPERATOR = "0x0000000000000000000000000000000000000909";
const keys = ["DATABASE_URL", "SESSION_SECRET", "UPTIME_ADMIN_WALLETS"] as const;
let saved: Record<string, string | undefined> = {};

function req(wallet?: string) {
  const headers: Record<string, string> = {};
  if (wallet) {
    const token = signSession({ wallet, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  return new Request("http://localhost/api/jobs?all=1", { headers });
}

describe("GET /api/jobs?all=1 operator gate", () => {
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    // Unreachable DB: the refusals below must not depend on any query.
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/none";
    process.env.SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("refuses anonymous and non-operator callers", async () => {
    const { GET } = await import("@/app/api/jobs/route");
    expect((await GET(req())).status).toBe(401);
    delete process.env.UPTIME_ADMIN_WALLETS;
    expect((await GET(req(ALICE))).status).toBe(403);
    process.env.UPTIME_ADMIN_WALLETS = OPERATOR;
    expect((await GET(req(ALICE))).status).toBe(403);
    expect((await GET(req(ALICE.toUpperCase().replace("0X", "0x")))).status).toBe(403);
  });
});
