// Mailer configuration. Every value is read at CALL time, so a changed env
// var applies on the next invocation. Secrets are referenced by env-var NAME;
// their values never appear in a log line, a response or an error message.
//
// Default posture: MAILER_ENABLED unset => the mailer does nothing at all
// (no row, no chain read, no provider call). Enabled but missing any
// precondition => NOT ARMED, which also does nothing and names what is missing.

import { PRICE_ENV, readPrices } from "../pricing";
import { isValidEmail } from "./address";

/** Name of the env var holding the provider credential (Resend API key or Postmark server token). */
export const PROVIDER_TOKEN_ENV = "MAILER_PROVIDER_TOKEN";
/** Name of the env var holding the mailer's EVM key (pool spender role 2). */
export const MAILER_KEY_ENV = "MAILER_KEY";

/** Verified addresses per wallet (D18). Fixed, not configurable. */
export { MAX_RECIPIENTS_PER_WALLET } from "./limits";
/** Confirmation links expire after this long. */
export const VERIFY_TTL_SEC = 24 * 3600;
/** Max length of the job name as it appears in an email (§11.4.3). */
export const JOB_NAME_MAX = 60;

export type ProviderName = "none" | "resend" | "postmark";

/**
 * OPERATOR limits. The per-job cap, the job cooldown and the per-mailbox daily
 * cap are the OWNER's, set self-serve per job / per address (lib/mailer/limits.ts).
 */
export interface MailerLimits {
  /** Min minutes between two failure alerts to the same mailbox (any job). Recovery and digest are exempt. */
  recipientCooldownMin: number;
  /** Emails per rolling 24 h across everyone: protects the sending domain. The global ceiling. */
  globalPerDay: number;
  /** Studio has no pool: free emails per owner wallet per rolling 24 h (D19). */
  studioPerWalletPerDay: number;
}

export interface MailerConfig {
  enabled: boolean;
  provider: ProviderName;
  from: string | null;
  fromName: string;
  replyTo: string | null;
  stream: string;
  apiBase: string | null;
  publicUrl: string | null;
  priceWei: bigint | null;
  limits: MailerLimits;
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function int(name: string, dflt: number, min: number, max: number): number {
  const v = env(name);
  if (!v || !/^\d+$/.test(v)) return dflt;
  return Math.min(max, Math.max(min, Number(v)));
}

export function readConfig(): MailerConfig {
  const p = env("MAILER_PROVIDER");
  const provider: ProviderName = p === "resend" || p === "postmark" ? p : "none";
  return {
    enabled: env("MAILER_ENABLED") === "1" || env("MAILER_ENABLED") === "true",
    provider,
    from: env("MAILER_FROM") ?? null,
    fromName: (env("MAILER_FROM_NAME") ?? "GenLayer Uptime").replace(/[\r\n"<>]/g, "").slice(0, 60),
    replyTo: env("MAILER_REPLY_TO") ?? null,
    // Postmark only; Resend has no message streams.
    stream: env("MAILER_STREAM") ?? "outbound",
    apiBase: env("MAILER_API_BASE") ?? null,
    publicUrl: env("MAILER_PUBLIC_URL")?.replace(/\/+$/, "") ?? null,
    // One price for the UI and the charge: lib/pricing.ts.
    priceWei: readPrices().emailWei,
    limits: {
      // 5 = the shortest job cooldown an owner can pick, so one job is never throttled below its own setting.
      recipientCooldownMin: int("MAILER_RECIPIENT_COOLDOWN_MIN", 5, 0, 1440),
      globalPerDay: int("MAILER_GLOBAL_DAILY_CEILING", 500, 1, 100000),
      studioPerWalletPerDay: int("MAILER_STUDIO_DAILY_QUOTA", 20, 0, 1000),
    },
  };
}

/** HMAC secret for confirmation and unsubscribe tokens. >= 32 chars or nothing. */
export function tokenSecret(): string | null {
  const s = env("MAILER_TOKEN_SECRET");
  return s && s.length >= 32 ? s : null;
}

export function providerToken(): string | null {
  return env(PROVIDER_TOKEN_ENV) ?? null;
}

function publicUrlOk(u: string | null): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
  } catch {
    return false;
  }
}

/**
 * ARMED is a conjunction. Returns the unmet preconditions by NAME (empty = armed).
 * Applies to every send, verification mail included.
 */
export function armedMissing(cfg: MailerConfig): string[] {
  const missing: string[] = [];
  if (!cfg.enabled) missing.push("MAILER_ENABLED");
  if (cfg.provider === "none") missing.push("MAILER_PROVIDER");
  if (!providerToken()) missing.push(PROVIDER_TOKEN_ENV);
  if (!cfg.from || !isValidEmail(cfg.from)) missing.push("MAILER_FROM");
  if (!tokenSecret()) missing.push("MAILER_TOKEN_SECRET");
  if (!publicUrlOk(cfg.publicUrl)) missing.push("MAILER_PUBLIC_URL");
  return missing;
}

/** Extra preconditions for a Bradbury alert, which is charged before it is sent. */
export function bradburyMissing(cfg: MailerConfig): string[] {
  const missing: string[] = [];
  if (!cfg.priceWei || cfg.priceWei <= BigInt(0)) missing.push(PRICE_ENV.email);
  if (!env(MAILER_KEY_ENV)) missing.push(MAILER_KEY_ENV);
  if (!poolAddress()) missing.push("UPTIME_POOL_BRADBURY");
  return missing;
}

/** The UptimePool address: v2 when UPTIME_POOL_V2_BRADBURY is set, else v1 (INTEGRATIONS.md). */
export function poolAddress(): `0x${string}` | null {
  const a = env("UPTIME_POOL_V2_BRADBURY") ?? env("UPTIME_POOL_BRADBURY") ?? env("NEXT_PUBLIC_UPTIME_POOL_BRADBURY");
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as `0x${string}`) : null;
}

export function mailerKey(): `0x${string}` | null {
  const k = env(MAILER_KEY_ENV);
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as `0x${string}`) : null;
}

export function bradburyEvmRpc(fallback: string): string {
  return env("BRADBURY_EVM_RPC") ?? fallback;
}
