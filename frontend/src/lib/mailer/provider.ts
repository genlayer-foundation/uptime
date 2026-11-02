// Email provider seam. One real implementation, Postmark over its HTTPS API,
// the provider Deckard's email lane uses (deckard-testnet-agent
// lib/deckard/email/provider/postmark.ex). Provider API, not SMTP: bounces come
// back as an outbound poll, so there is no inbound mail path (§11.1).
//
// Failure classification follows Deckard: Postmark ErrorCodes 300 (invalid
// address), 406 (inactive recipient) and 403 are PERMANENT; everything else,
// including unknown codes and transport errors, is TRANSIENT. A permanent send
// error does NOT auto-suppress (it also covers our own misconfiguration);
// suppressions come from the provider's own list via `suppressions()`.

import type { Message } from "./templates";
import type { SuppressionReason } from "./types";

export type DeliverResult =
  | { ok: true; id: string }
  | { ok: false; kind: "permanent" | "transient"; error: string };

export interface SuppressionRow {
  email: string;
  reason: SuppressionReason;
  detail: string;
}

export interface MailProvider {
  deliver(msg: Message, envelope: { from: string; fromName: string; replyTo: string | null }): Promise<DeliverResult>;
  /** The provider's suppression list (hard bounces, complaints, unsubscribes). */
  suppressions(since: Date | null): Promise<SuppressionRow[]>;
}

const PERMANENT_CODES = new Set([300, 403, 406]);

/** Map a Postmark SuppressionReason onto our closed vocabulary; unknown => null (dropped, never guessed). */
export function mapPostmarkReason(r: unknown): SuppressionReason | null {
  if (r === "HardBounce") return "hard_bounce";
  if (r === "SpamComplaint") return "spam_complaint";
  if (r === "ManualSuppression") return "unsubscribe";
  return null;
}

export function postmarkProvider(opts: {
  token: string;
  stream: string;
  apiBase?: string | null;
  fetch?: typeof fetch;
}): MailProvider {
  const base = (opts.apiBase || "https://api.postmarkapp.com").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Postmark-Server-Token": opts.token,
  };
  return {
    async deliver(msg, env) {
      const from = env.fromName ? `"${env.fromName}" <${env.from}>` : env.from;
      const body: Record<string, unknown> = {
        From: from,
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.text,
        HtmlBody: msg.html,
        MessageStream: opts.stream,
        TrackOpens: false,
        TrackLinks: "None",
        Headers: msg.headers.map(([Name, Value]) => ({ Name, Value })),
      };
      if (env.replyTo) body.ReplyTo = env.replyTo;
      try {
        const res = await f(`${base}/email`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as { ErrorCode?: number; MessageID?: string } | null;
        if (json && json.ErrorCode === 0 && json.MessageID) return { ok: true, id: String(json.MessageID) };
        const code = typeof json?.ErrorCode === "number" ? json.ErrorCode : null;
        // Never echo the provider body: it repeats the recipient address.
        if (code !== null) {
          return { ok: false, kind: PERMANENT_CODES.has(code) ? "permanent" : "transient", error: `postmark_${code}` };
        }
        return { ok: false, kind: "transient", error: `http_${res.status}` };
      } catch (e) {
        return { ok: false, kind: "transient", error: e instanceof Error ? e.name : "network" };
      }
    },

    async suppressions(since) {
      const q = since ? `?fromdate=${since.toISOString().slice(0, 10)}` : "";
      const res = await f(`${base}/message-streams/${encodeURIComponent(opts.stream)}/suppressions/dump${q}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`postmark suppressions: http_${res.status}`);
      const json = (await res.json()) as { Suppressions?: { EmailAddress?: string; SuppressionReason?: string }[] };
      const out: SuppressionRow[] = [];
      for (const row of json.Suppressions ?? []) {
        const reason = mapPostmarkReason(row.SuppressionReason);
        if (!reason || typeof row.EmailAddress !== "string") continue;
        out.push({ email: row.EmailAddress.trim().toLowerCase(), reason, detail: `postmark:${row.SuppressionReason}` });
      }
      return out;
    },
  };
}
