// Self-serve alert settings: defaults, bounds and validation. PURE and
// client-safe (no node imports), so the alerts UI, the mock and the API routes
// validate with the same function and can never disagree about a range.
//
// Owner decision (2026-11-02): every wallet sets its own limits on the website.
//   alerts per job per day    default 10, 1-50
//   cooldown between alerts   default 15 min, 5-120
//   emails per recipient/day  default 20, 1-100 (across all of that wallet's jobs)
// The operator keeps a global ceiling on top (MAILER_GLOBAL_DAILY_CEILING,
// lib/mailer/config.ts): no per-user setting can exceed it.

export interface Bound {
  default: number;
  min: number;
  max: number;
}

export const LIMITS = {
  /** Alert emails (failure + recovery, all recipients) per job per rolling 24 h. */
  perJobPerDay: { default: 10, min: 1, max: 50 },
  /** Min minutes between two failure alerts of the same job. */
  cooldownMin: { default: 15, min: 5, max: 120 },
  /** Mail after this many consecutive failed runs. */
  failAfter: { default: 1, min: 1, max: 100 },
  /** Emails per mailbox per rolling 24 h, every kind and job included. */
  perRecipientPerDay: { default: 20, min: 1, max: 100 },
} as const satisfies Record<string, Bound>;

/** Verified addresses per wallet (D18). Fixed, not configurable. */
export const MAX_RECIPIENTS_PER_WALLET = 3;

/** What a job's alert rule reacts to. */
export interface Triggers {
  /** A step did not reach ACCEPTED/FINALIZED (timeout, undetermined, submit failure, error). */
  onFailure: boolean;
  /** Every step was accepted but an assertion did not hold. */
  onAssertion: boolean;
  /** The first passing run after a failure alert was sent. */
  onRecovery: boolean;
  /** One summary email per recipient per UTC day. */
  digest: boolean;
}

export const DEFAULT_TRIGGERS: Triggers = { onFailure: true, onAssertion: true, onRecovery: true, digest: false };

/** Everything the owner sets for one job, minus who owns it. */
export interface RuleSettings extends Triggers {
  enabled: boolean;
  failAfter: number;
  perJobPerDay: number;
  cooldownMin: number;
  recipientIds: number[];
}

export function defaultRuleSettings(): RuleSettings {
  return {
    enabled: false,
    ...DEFAULT_TRIGGERS,
    failAfter: LIMITS.failAfter.default,
    perJobPerDay: LIMITS.perJobPerDay.default,
    cooldownMin: LIMITS.cooldownMin.default,
    recipientIds: [],
  };
}

export type FieldErrors = Partial<Record<keyof RuleSettings, string>>;

const LABEL: Record<"failAfter" | "perJobPerDay" | "cooldownMin" | "perRecipientPerDay", string> = {
  failAfter: "Consecutive failures",
  perJobPerDay: "Alerts per day",
  cooldownMin: "Cooldown (minutes)",
  perRecipientPerDay: "Emails per day",
};

/** Whole number inside a bound, or an error message. Strings from a form are accepted. */
export function checkBound(name: keyof typeof LABEL, v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const b = LIMITS[name];
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < b.min || n > b.max) {
    return { ok: false, error: `${LABEL[name]} must be a whole number from ${b.min} to ${b.max}` };
  }
  return { ok: true, value: n };
}

function bool(v: unknown, dflt: boolean): boolean | null {
  if (v === undefined) return dflt;
  return typeof v === "boolean" ? v : null;
}

/**
 * Validate a rule from an untrusted body. Missing fields take their default;
 * present-but-wrong fields are errors (never silently clamped), so what the
 * owner saved is exactly what the mailer enforces.
 */
export function validateRuleSettings(input: Record<string, unknown>): { ok: true; value: RuleSettings } | { ok: false; errors: FieldErrors } {
  const d = defaultRuleSettings();
  const errors: FieldErrors = {};
  const out = { ...d } as RuleSettings;

  for (const k of ["enabled", "onFailure", "onAssertion", "onRecovery", "digest"] as const) {
    // A rule saved through the API is on unless it says otherwise.
    const b = bool(input[k], k === "enabled" ? true : d[k]);
    if (b === null) errors[k] = `${k} must be true or false`;
    else out[k] = b;
  }
  for (const k of ["failAfter", "perJobPerDay", "cooldownMin"] as const) {
    if (input[k] === undefined) continue;
    const r = checkBound(k, input[k]);
    if (r.ok) out[k] = r.value;
    else errors[k] = r.error;
  }

  const ids = input.recipientIds === undefined ? [] : input.recipientIds;
  if (!Array.isArray(ids) || ids.length > MAX_RECIPIENTS_PER_WALLET || ids.some((n) => !Number.isSafeInteger(Number(n)) || Number(n) <= 0)) {
    errors.recipientIds = `Pick up to ${MAX_RECIPIENTS_PER_WALLET} of your addresses`;
  } else {
    out.recipientIds = [...new Set(ids.map(Number))];
  }

  if (!errors.enabled && out.enabled && !errors.recipientIds && out.recipientIds.length === 0) {
    errors.recipientIds = "Pick at least one confirmed address, or turn alerts off";
  }
  if (out.enabled && !out.onFailure && !out.onAssertion && !out.onRecovery && !out.digest) {
    errors.onFailure = "Turn on at least one trigger, or turn alerts off";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out };
}

/** A recipient's own daily cap. `null` resets it to the default. */
export function validateRecipientCap(v: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  return checkBound("perRecipientPerDay", v);
}
