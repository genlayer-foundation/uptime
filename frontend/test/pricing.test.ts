// Pricing: defaults, operator overrides and the estimates the UI shows before funding.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertsMaxPerDayWei,
  daysCovered,
  estimateJobPerDayWei,
  estimateRunWei,
  formatGen,
  mailerAllowanceTerms,
  readPrices,
  runChargeWei,
} from "@/lib/pricing";

const GEN = 10n ** 18n;
afterEach(() => vi.unstubAllEnvs());

describe("readPrices", () => {
  it("defaults: 0.01 GEN per email, 0.001 GEN per run, 0.00001 GEN gas estimate per tx", () => {
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN", "");
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN", "");
    vi.stubEnv("NEXT_PUBLIC_UPTIME_GAS_PER_TX_ESTIMATE_GEN", "");
    expect(readPrices()).toEqual({ emailWei: GEN / 100n, runFeeWei: GEN / 1000n, gasPerTxEstimateWei: GEN / 100_000n });
  });

  it("operator env overrides; malformed falls back to the default", () => {
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN", "0.5");
    vi.stubEnv("NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN", "-1");
    expect(readPrices().emailWei).toBe(GEN / 2n);
    expect(readPrices().runFeeWei).toBe(GEN / 1000n);
  });
});

const P = { emailWei: GEN / 100n, runFeeWei: GEN / 1000n, gasPerTxEstimateWei: GEN / 100_000n };

describe("charges", () => {
  it("a run is charged the flat fee plus its ACTUAL gas", () => {
    expect(runChargeWei(P, 1234n)).toBe(GEN / 1000n + 1234n);
    expect(() => runChargeWei(P, -1n)).toThrow();
  });
});

describe("estimates", () => {
  it("one run = fee + tx x gas estimate", () => {
    expect(estimateRunWei(P, 2)).toBe(GEN / 1000n + 2n * (GEN / 100_000n)); // 0.00102
  });

  it("every 5 min (288 runs/day), one tx: ~0.29 GEN/day", () => {
    expect(estimateJobPerDayWei(P, 288, 1)).toBe(288n * (GEN / 1000n + GEN / 100_000n));
    expect(formatGen(estimateJobPerDayWei(P, 288, 1))).toBe("0.29088 GEN");
  });

  it("fractional cron rates round up, never down", () => {
    const w = estimateJobPerDayWei(P, 1 / 7, 1); // weekly
    expect(w * 7n).toBeGreaterThanOrEqual(estimateRunWei(P, 1));
  });

  it("no schedule = nothing", () => {
    expect(estimateJobPerDayWei(P, 0, 3)).toBe(0n);
    expect(estimateJobPerDayWei(P, Number.NaN, 3)).toBe(0n);
  });

  it("alerts: per-job cap x price, plus one digest per recipient", () => {
    expect(alertsMaxPerDayWei(P, { perJobPerDay: 10, digest: false, recipients: 3 })).toBe(GEN / 10n); // 0.1 GEN
    expect(alertsMaxPerDayWei(P, { perJobPerDay: 10, digest: true, recipients: 3 })).toBe(13n * (GEN / 100n));
  });

  it("the mailer allowance equals the alert maximum, one price per charge", () => {
    const t = mailerAllowanceTerms(P, { perJobPerDay: 50, digest: true, recipients: 1 });
    expect(t.periodAmount).toBe(51n * (GEN / 100n));
    expect(t.maxPerCharge).toBe(GEN / 100n);
    expect(t.periodDuration).toBe(86_400n);
  });

  it("days a deposit covers", () => {
    expect(daysCovered(GEN, GEN / 4n)).toBe(4);
    expect(daysCovered(GEN, 0n)).toBeNull();
  });

  it("formatGen", () => {
    expect(formatGen(GEN / 100n)).toBe("0.01 GEN");
    expect(formatGen(0n)).toBe("0 GEN");
    expect(formatGen(1n)).toBe("<0.000001 GEN");
    expect(formatGen(3n * GEN)).toBe("3 GEN");
  });
});
