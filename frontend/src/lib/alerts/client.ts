// Typed browser client for the self-serve alerts API (app/api/alerts/**).
// Same transport as the jobs client, so NEXT_PUBLIC_JOBS_MOCK=1 answers from
// the in-browser mock (./mock.ts) and no email is ever sent from a review build.

import { apiCall } from "@/lib/jobs/client";
import type { RuleSettings } from "@/lib/mailer/limits";

export type RecipientView = {
  id: number;
  email: string;
  state: "pending" | "verified";
  createdAt: string;
  dailyCap: number;
  dailyCapDefault: boolean;
};

export type JobRule = RuleSettings & { jobId: string };

const enc = encodeURIComponent;

export const alertsApi = {
  listRecipients: async () => (await apiCall<{ recipients: RecipientView[] }>("GET", "/api/alerts/recipients")).recipients,
  addRecipient: (email: string) => apiCall<{ recipient: RecipientView; message: string }>("POST", "/api/alerts/recipients", { email }),
  removeRecipient: (id: number) => apiCall<{ removed: number }>("DELETE", `/api/alerts/recipients/${id}`),
  setRecipientCap: async (id: number, dailyCap: number | null) =>
    (await apiCall<{ recipient: RecipientView }>("PATCH", `/api/alerts/recipients/${id}`, { dailyCap })).recipient,
  getRule: async (jobId: string) => (await apiCall<{ rule: JobRule }>("GET", `/api/alerts/jobs/${enc(jobId)}`)).rule,
  putRule: async (jobId: string, rule: RuleSettings) => (await apiCall<{ rule: JobRule }>("PUT", `/api/alerts/jobs/${enc(jobId)}`, rule)).rule,
};

/** The alerts routes answer 503 while MAILER_ENABLED is off or the backend has not wired the mailer. */
export function alertsOff(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { status?: number }).status === 503;
}
