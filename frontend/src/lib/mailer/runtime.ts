// Wiring. The mailer owns no database connection: the backend registers its
// Postgres AlertsRepo (and the Studio allowlist check, and the job-owner
// lookup the rules route needs) once at startup:
//
//   import { configureMailer } from "@/lib/mailer";
//   configureMailer({ repo: pgAlertsRepo(pool), studioAllowed: isStudioAllowed, jobOwner, digestSource });
//
// Until then every entry point FAILS CLOSED: notifyRunFailed returns
// { status: "not_wired" } and the API routes answer 503.

import { providerToken, readConfig } from "./config";
import { evmPoolCharger, type PoolCharger } from "./charger";
import type { MailerDeps } from "./policy";
import { postmarkProvider, resendProvider, type MailProvider } from "./provider";
import type { AlertsRepo } from "./repo";
import type { AlertJob, AlertRun } from "./types";

export interface MailerWiring {
  repo: AlertsRepo;
  provider?: MailProvider | null;
  charger?: PoolCharger | null;
  studioAllowed?: (wallet: string) => boolean | Promise<boolean>;
  /** Owner wallet of a job, or null if the job does not exist. Used by the rules route. */
  jobOwner?: (jobId: string) => Promise<string | null>;
  /** A job and its runs since `since`, for the daily digest. Without it the digest cron answers 503. */
  digestSource?: (jobId: string, since: Date) => Promise<{ job: AlertJob; runs: AlertRun[] } | null>;
  now?: () => Date;
  log?: (line: string) => void;
}

let wiring: MailerWiring | null = null;

export function configureMailer(w: MailerWiring): void {
  wiring = w;
}

/** Test hook. */
export function resetMailer(): void {
  wiring = null;
}

function defaultProvider(): MailProvider | null {
  const cfg = readConfig();
  const token = providerToken();
  if (!token) return null;
  if (cfg.provider === "resend") return resendProvider({ token, apiBase: cfg.apiBase });
  if (cfg.provider === "postmark") return postmarkProvider({ token, stream: cfg.stream, apiBase: cfg.apiBase });
  return null;
}

export function mailerDeps(): MailerDeps | null {
  if (!wiring) return null;
  const w = wiring;
  return {
    repo: w.repo,
    provider: w.provider !== undefined ? w.provider : defaultProvider(),
    charger: w.charger !== undefined ? w.charger : evmPoolCharger(),
    studioAllowed: w.studioAllowed ?? (() => false),
    now: w.now ?? (() => new Date()),
    log: w.log ?? ((line) => console.warn(line)),
  };
}

export function jobOwnerLookup(): ((jobId: string) => Promise<string | null>) | null {
  return wiring?.jobOwner ?? null;
}

export function digestSourceLookup(): MailerWiring["digestSource"] | null {
  return wiring?.digestSource ?? null;
}
