// DEV-ONLY mock of /api/alerts/** for NEXT_PUBLIC_JOBS_MOCK=1 (routed from
// lib/jobs/mock.ts). Validates with the SAME functions as the real routes
// (lib/mailer/limits.ts), keeps state in localStorage, and never sends email:
// a new address stays "pending" until `mockConfirmRecipient` stands in for the
// confirmation link.

import { MAX_RECIPIENTS_PER_WALLET, defaultRuleSettings, validateRecipientCap, validateRuleSettings, LIMITS } from "@/lib/mailer/limits";
import type { JobRule, RecipientView } from "./client";

const KEY = "alerts-mock-v1";

type Rec = { id: number; wallet: string; email: string; createdAt: string; verified: boolean; removed: boolean; dailyCap: number | null };
type State = { seq: number; recipients: Rec[]; rules: Record<string, JobRule & { owner: string }> };

let state: State | null = null;
function load(): State {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    state = raw ? (JSON.parse(raw) as State) : { seq: 0, recipients: [], rules: {} };
  } catch {
    state = { seq: 0, recipients: [], rules: {} };
  }
  return state;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, error: string, extra: object = {}) => json(status, { error, ...extra });

function view(r: Rec): RecipientView {
  return {
    id: r.id,
    email: r.email,
    state: r.verified ? "verified" : "pending",
    createdAt: r.createdAt,
    dailyCap: r.dailyCap ?? LIMITS.perRecipientPerDay.default,
    dailyCapDefault: r.dailyCap == null,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stand-in for clicking the confirmation link (mock only). */
export function mockConfirmRecipient(id: number) {
  const r = load().recipients.find((x) => x.id === id && !x.removed);
  if (r) {
    r.verified = true;
    save();
  }
}

export function alertsMockRoute(
  method: string,
  p: string[],
  body: Record<string, unknown> | undefined,
  wallet: string | null,
  ownsJob: (jobId: string) => boolean
): Response {
  if (!wallet) return err(401, "not signed in");
  const w = wallet.toLowerCase();
  const s = load();
  const mine = () => s.recipients.filter((r) => r.wallet === w && !r.removed);

  if (p[0] === "recipients" && p.length === 1) {
    if (method === "GET") return json(200, { recipients: mine().map(view) });
    if (method === "POST") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254) return err(400, "not a valid email address");
      const existing = mine().find((r) => r.email === email);
      if (!existing && mine().length >= MAX_RECIPIENTS_PER_WALLET) return err(409, `at most ${MAX_RECIPIENTS_PER_WALLET} addresses per wallet`);
      const r = existing ?? { id: ++s.seq, wallet: w, email, createdAt: new Date().toISOString(), verified: false, removed: false, dailyCap: null };
      if (!existing) s.recipients.push(r);
      save();
      return json(200, {
        recipient: view(r),
        message: r.verified ? "This address is already confirmed." : "If this address can receive email, a confirmation link is on its way.",
      });
    }
  }
  if (p[0] === "recipients" && p.length === 2) {
    const r = mine().find((x) => x.id === Number(p[1]));
    if (!r) return err(404, "not found");
    if (method === "DELETE") {
      r.removed = true;
      for (const rule of Object.values(s.rules)) rule.recipientIds = rule.recipientIds.filter((x) => x !== r.id);
      save();
      return json(200, { removed: r.id });
    }
    if (method === "PATCH") {
      const v = validateRecipientCap(body?.dailyCap);
      if (!v.ok) return err(400, v.error);
      r.dailyCap = v.value;
      save();
      return json(200, { recipient: view(r) });
    }
  }
  if (p[0] === "jobs" && p.length === 2) {
    const jobId = decodeURIComponent(p[1]);
    if (!ownsJob(jobId)) return err(404, "job not found");
    if (method === "GET") {
      const rule = s.rules[jobId];
      return json(200, { rule: rule ? { ...rule, owner: undefined } : { ...defaultRuleSettings(), jobId } });
    }
    if (method === "PUT") {
      const v = validateRuleSettings(body ?? {});
      if (!v.ok) return err(400, Object.values(v.errors)[0] ?? "invalid rule", { fields: v.errors });
      const verified = new Set(mine().filter((r) => r.verified).map((r) => r.id));
      if (v.value.recipientIds.some((id) => !verified.has(id))) {
        const e = "every recipient must be one of your confirmed addresses";
        return err(400, e, { fields: { recipientIds: e } });
      }
      s.rules[jobId] = { ...v.value, jobId, owner: w };
      save();
      return json(200, { rule: { ...v.value, jobId } });
    }
  }
  return err(404, `mock: no alerts route for ${method} /${p.join("/")}`);
}
