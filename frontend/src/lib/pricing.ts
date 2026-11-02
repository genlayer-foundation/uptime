// Uptime prices, in GEN. NOT AUDITED, TESTNET ONLY: on testnet GEN has no market
// value, so these are anti-abuse throttles, not revenue (docs/PRODUCT.md §11.2).
//
// ONE module for every price: the wizard's funding estimate, the alerts UI,
// the mailer's per-email charge and the scheduler's per-run charge all read
// from here, so what a user is shown before funding is what they are charged.
//
// Operator env vars (decimal GEN, up to 18 places). They are NEXT_PUBLIC_
// because the browser must show them: Next inlines them at BUILD time, so a
// change needs a redeploy (server code reads the same names at runtime).
// An unset or malformed value falls back to the default below.
//
//   NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN         0.01     per alert / digest email (Bradbury)
//   NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN       0.001    flat fee per scheduled run (Bradbury)
//   NEXT_PUBLIC_UPTIME_GAS_PER_TX_ESTIMATE_GEN 0.00001  ESTIMATE only, for display; runs are
//                                                       reimbursed at the ACTUAL gas they used
//
// The gas estimate is ~2x the unverified figure in PRODUCT.md §10 (0.01 gwei base
// fee x a guessed 500k gas = 5e-6 GEN per addTransaction). Replace it once measured.
//
// Studio is free: no pool, no fee, emails under a quota for allowlisted wallets.

import { formatEther, parseEther } from "viem";

export const PRICE_ENV = {
  email: "NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN",
  runFee: "NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN",
  gasPerTxEstimate: "NEXT_PUBLIC_UPTIME_GAS_PER_TX_ESTIMATE_GEN",
} as const;

export const DEFAULT_PRICES_GEN = { email: "0.01", runFee: "0.001", gasPerTxEstimate: "0.00001" } as const;

export interface Prices {
  /** Charged to the job's pool before each alert or digest email is sent. */
  emailWei: bigint;
  /** Flat fee the scheduler adds to every run's actual gas. */
  runFeeWei: bigint;
  /** Display-only estimate of one transaction's gas. */
  gasPerTxEstimateWei: bigint;
}

const GEN = /^\d+(\.\d{1,18})?$/;

/** Decimal GEN -> wei. Malformed, negative or empty -> the default. */
export function parsePriceGen(raw: string | undefined, dflt: string): bigint {
  const v = raw?.trim();
  return parseEther(v && GEN.test(v) ? v : dflt);
}

/**
 * The prices in force. Each env var is read with a LITERAL `process.env.X`
 * so Next can inline it into the browser bundle.
 */
export function readPrices(): Prices {
  return {
    emailWei: parsePriceGen(process.env.NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN, DEFAULT_PRICES_GEN.email),
    runFeeWei: parsePriceGen(process.env.NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN, DEFAULT_PRICES_GEN.runFee),
    gasPerTxEstimateWei: parsePriceGen(process.env.NEXT_PUBLIC_UPTIME_GAS_PER_TX_ESTIMATE_GEN, DEFAULT_PRICES_GEN.gasPerTxEstimate),
  };
}

// ------------------------------------------------------------------ charges

/** What the scheduler charges a pool for one run: the flat fee plus the gas it actually paid. */
export function runChargeWei(p: Prices, actualGasWei: bigint): bigint {
  if (actualGasWei < 0n) throw new Error("gas cannot be negative");
  return p.runFeeWei + actualGasWei;
}

// ---------------------------------------------------------------- estimates

/** Estimated charge for one run that sends `txPerRun` transactions. */
export function estimateRunWei(p: Prices, txPerRun: number): bigint {
  return p.runFeeWei + p.gasPerTxEstimateWei * BigInt(Math.max(0, Math.ceil(txPerRun)));
}

/** Scale a wei amount by a (possibly fractional, e.g. cron) runs-per-day figure, rounding up. */
function times(wei: bigint, factor: number): bigint {
  if (!Number.isFinite(factor) || factor <= 0) return 0n;
  const milli = BigInt(Math.round(factor * 1000));
  return (wei * milli + 999n) / 1000n;
}

/** Estimated run cost per day at this schedule. */
export function estimateJobPerDayWei(p: Prices, runsPerDay: number, txPerRun: number): bigint {
  return times(estimateRunWei(p, txPerRun), runsPerDay);
}

/**
 * The most a job's alerts can cost in a day: the per-job alert cap (failure +
 * recovery emails, all recipients together) plus one digest per recipient.
 */
export function alertsMaxPerDayWei(p: Prices, a: { perJobPerDay: number; digest: boolean; recipients: number }): bigint {
  const emails = Math.max(0, a.perJobPerDay) + (a.digest ? Math.max(0, a.recipients) : 0);
  return p.emailWei * BigInt(emails);
}

/**
 * The UptimePool allowance the MAILER (role 2) needs so the on-chain cap equals
 * the alert limits the owner chose: at most `alertsMaxPerDayWei` per 24 h,
 * one email price per charge.
 */
export function mailerAllowanceTerms(p: Prices, a: { perJobPerDay: number; digest: boolean; recipients: number }) {
  return {
    periodAmount: alertsMaxPerDayWei(p, a),
    periodDuration: 86_400n,
    startDate: 0n,
    expiry: 0n,
    maxPerCharge: p.emailWei,
  };
}

/** Days a deposit lasts at a daily spend, or null when nothing is spent. */
export function daysCovered(depositWei: bigint, perDayWei: bigint): number | null {
  if (perDayWei <= 0n) return null;
  return Number((depositWei * 100n) / perDayWei) / 100;
}

/** "0.01 GEN" style, trimmed, up to 6 decimals; tiny non-zero amounts say "<0.000001 GEN". */
export function formatGen(wei: bigint, digits = 6): string {
  if (wei > 0n && wei < 10n ** BigInt(18 - digits)) return `<${(1 / 10 ** digits).toFixed(digits)} GEN`;
  const [whole, frac = ""] = formatEther(wei).split(".");
  const f = frac.slice(0, digits).replace(/0+$/, "");
  return `${whole}${f ? `.${f}` : ""} GEN`;
}
