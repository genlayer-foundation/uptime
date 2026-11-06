// Resend adapter: wire shape, failure classification, provider selection. Never a real socket.
import { afterEach, describe, expect, it, vi } from "vitest";
import { armedMissing, readConfig } from "@/lib/mailer/config";
import { resendProvider } from "@/lib/mailer/provider";
import type { Message } from "@/lib/mailer/templates";

const msg: Message = {
  to: "a@example.com",
  subject: "s",
  text: "t",
  html: "h",
  headers: [["List-Unsubscribe", "<https://x/u>"], ["Auto-Submitted", "auto-generated"]],
};
const envelope = { from: "uptime@genlayer.foundation", fromName: "GenLayer Uptime", replyTo: "ops@genlayer.foundation" };

function fake(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[calls.length - 1];
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, f };
}

afterEach(() => vi.unstubAllEnvs());

describe("resend provider", () => {
  it("sends the Resend wire shape with a Bearer key", async () => {
    const { calls, f } = fake([{ status: 200, body: { id: "re-1" } }]);
    const p = resendProvider({ token: "re_test", apiBase: "http://mock/", fetch: f });
    expect(await p.deliver(msg, envelope)).toEqual({ ok: true, id: "re-1" });
    expect(calls[0].url).toBe("http://mock/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: '"GenLayer Uptime" <uptime@genlayer.foundation>',
      to: ["a@example.com"],
      subject: "s",
      text: "t",
      html: "h",
      headers: { "List-Unsubscribe": "<https://x/u>", "Auto-Submitted": "auto-generated" },
      reply_to: "ops@genlayer.foundation",
    });
  });

  it("4xx is permanent, 429 and 5xx transient; the provider message is never echoed", async () => {
    const { f } = fake([
      { status: 422, body: { name: "validation_error", message: "Invalid `to` field: a@example.com" } },
      { status: 403, body: { name: "validation_error", message: "domain not verified" } },
      { status: 429, body: { name: "daily_quota_exceeded", message: "quota" } },
      { status: 500, body: { name: "internal_server_error", message: "x" } },
      { status: 200, body: {} },
    ]);
    const p = resendProvider({ token: "t", fetch: f });
    const r1 = await p.deliver(msg, envelope);
    expect(r1).toEqual({ ok: false, kind: "permanent", error: "resend_422_validation_error" });
    expect(JSON.stringify(r1)).not.toContain("a@example.com");
    expect(await p.deliver(msg, envelope)).toMatchObject({ ok: false, kind: "permanent" });
    expect(await p.deliver(msg, envelope)).toEqual({ ok: false, kind: "transient", error: "resend_429_daily_quota_exceeded" });
    expect(await p.deliver(msg, envelope)).toMatchObject({ ok: false, kind: "transient" });
    expect(await p.deliver(msg, envelope)).toMatchObject({ ok: false, kind: "transient", error: "resend_200" });
  });

  it("a transport error is transient", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await resendProvider({ token: "t", fetch: f }).deliver(msg, envelope)).toEqual({ ok: false, kind: "transient", error: "TypeError" });
  });

  it("suppressions: no poll endpoint, returns nothing", async () => {
    const { calls, f } = fake([]);
    expect(await resendProvider({ token: "t", fetch: f }).suppressions(null)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("MAILER_PROVIDER=resend is recognised; an unknown value is none (not armed)", () => {
    vi.stubEnv("MAILER_PROVIDER", "resend");
    expect(readConfig().provider).toBe("resend");
    vi.stubEnv("MAILER_PROVIDER", "sendgrid");
    expect(readConfig().provider).toBe("none");
    expect(armedMissing(readConfig())).toContain("MAILER_PROVIDER");
  });
});
