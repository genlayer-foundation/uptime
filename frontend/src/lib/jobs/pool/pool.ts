// Server side of the Bradbury pool: the scheduler's funding check, and the
// batched settlement that charges pools for the gas the relayer fronted.
//
// Pool ids are FIRST-COME on-chain: anyone can create a pool under any id.
// So before every run (and every charge) the owner on-chain must equal the
// job's owner wallet; a mismatch is fatal for the job.

import { decodeEventLog, type Log } from "viem";
import { isStudioAllowed, studioAllowlist } from "../allowlist";
import type { FundingCheck } from "../gate";
import type { JobRow } from "../internal";
import type { ChargeLine, LineOutcome, Repo } from "../repo";
import type { Network } from "../types";
import { readPrices, runChargeWei, type Prices } from "@/lib/pricing";
import { POOL_ABI, poolAddress, poolChargingEnabled, ROLE_SCHEDULER, SKIP_REASONS } from "@/lib/pool/abi";

const ZERO = "0x0000000000000000000000000000000000000000";

// Flat per-tx cost recorded on each Bradbury step run until real fees are
// measured (docs/PRODUCT.md §10). Unset or 0 = runs cost nothing.
export function runCostWei(): bigint {
  const v = process.env.UPTIME_RUN_COST_WEI?.trim();
  return v && /^\d+$/.test(v) ? BigInt(v) : BigInt(0);
}

export interface PoolView {
  owner: string;
  paused: boolean;
  balance: bigint;
  allowanceActive: boolean;
  allowancePaused: boolean;
  available: bigint; // what the scheduler role could draw in one line now
  maxPerCharge?: bigint; // the allowance's on-chain line cap = the per-run cap (0 = none)
}

export interface PoolReader {
  read(poolId: `0x${string}`): Promise<PoolView>;
}

export async function evmPoolReader(): Promise<PoolReader | null> {
  const address = poolAddress();
  if (!address) return null;
  const { bradburyPublicClient } = await import("../chain");
  const c = bradburyPublicClient();
  return {
    async read(id) {
      const [[owner, paused, balance], allowance, available] = await Promise.all([
        c.readContract({ address, abi: POOL_ABI, functionName: "getPool", args: [id] }),
        c.readContract({ address, abi: POOL_ABI, functionName: "getAllowance", args: [id, ROLE_SCHEDULER] }),
        c.readContract({ address, abi: POOL_ABI, functionName: "available", args: [id, ROLE_SCHEDULER] }),
      ]);
      return {
        owner, paused, balance, allowancePaused: allowance[3], allowanceActive: allowance[4], available,
        maxPerCharge: allowance[0].maxPerCharge,
      };
    },
  };
}

const txSteps = (j: JobRow) => j.steps.filter((s) => s.kind !== "read").length;

// A per-run cap of 0 means "no cap", on-chain (maxPerCharge) and off-chain alike.
function minCap(...caps: (bigint | null | undefined)[]): bigint | null {
  let out: bigint | null = null;
  for (const c of caps) if (c != null && c > BigInt(0) && (out === null || c < out)) out = c;
  return out;
}

/** The job's effective per-run cap: the lower of its off-chain cap and the pool's on-chain line cap. */
export function perRunCap(offchainWei: string | null | undefined, onchainWei?: bigint | null): bigint | null {
  return minCap(offchainWei ? BigInt(offchainWei) : null, onchainWei);
}

// Pure decision. pool === "unconfigured" means no pool contract address is set.
// `runWei` is the estimated charge for ONE whole run (its fee plus every tx's gas):
// settlement charges a run as one line, so the run must fit the per-run cap.
export function fundingDecision(j: JobRow, pool: PoolView | "unconfigured", allowlist: ReadonlySet<string>, runWei: bigint): FundingCheck {
  if (pool === "unconfigured") {
    // Before the pool contract exists only allowlisted (Foundation/Labs)
    // wallets may run on Bradbury, and the relayer pays.
    return isStudioAllowed(j.owner, allowlist)
      ? { ok: true }
      : { ok: false, reason: "Funding on GenLayer Testnet Bradbury is not available yet" };
  }
  if (pool.owner === ZERO) return { ok: false, reason: "Pool not funded: deposit GEN to start this job" };
  if (pool.owner.toLowerCase() !== j.owner) {
    return { ok: false, foreign: true, reason: "This job's pool id is owned by a different wallet" };
  }
  if (pool.paused) return { ok: false, paused: true, reason: "Pool is paused on-chain" };
  if (!pool.allowanceActive) return { ok: false, reason: "Grant the scheduler an allowance on your GEN pool" };
  if (pool.allowancePaused) return { ok: false, paused: true, reason: "The scheduler's allowance is paused on-chain" };
  const cap = perRunCap(j.perRunCapWei, pool.maxPerCharge);
  if (cap !== null && runWei > cap) {
    return { ok: false, reason: "One run is estimated to cost more than the per-run spending cap: raise the cap to continue" };
  }
  if (pool.available < runWei || pool.balance < runWei) {
    return { ok: false, unfunded: true, reason: "Pool balance or allowance cannot cover the next run: top up to continue" };
  }
  return { ok: true };
}

export function makeFundingCheck(reader: PoolReader | null, allowlist?: ReadonlySet<string>) {
  return async (j: JobRow): Promise<FundingCheck> => {
    try {
      const v = reader ? await reader.read(j.poolId as `0x${string}`) : "unconfigured";
      // One run is ONE charge line: the run fee plus every tx's gas.
      return fundingDecision(j, v, allowlist ?? studioAllowlist(), runChargeWei(readPrices(), runCostWei() * BigInt(txSteps(j))));
    } catch (e) {
      return { ok: false, reason: `Pool unreadable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
    }
  };
}

// ---------------------------------------------------------------------------
// Settlement: ONE `charge` tx per period, as role 1 (scheduler), with ONE line
// per finished run: the run fee plus the gas of all its steps, clamped to the
// job's per-run cap. The pool's maxPerCharge is a per-LINE limit, so charging a
// run as a single line is what makes the on-chain limit a per-RUN cap; the
// clamp makes it hold off-chain too (the relayer absorbs any excess gas).
// A rule-breaking line is SKIPPED on-chain (ChargeSkipped), not reverted, so
// outcomes come from the receipt's events, one per line, in line order.
// OFF unless POOL_CHARGING_ENABLED=1.

export interface ChargeResult {
  hash: `0x${string}`;
  outcomes: LineOutcome[];
  chargedWei: string;
}

export interface PoolCharger {
  lastSettlement(): Promise<bigint>;
  // The pool's on-chain per-line (= per-run) cap for the scheduler; 0 = none.
  lineCap?(poolId: `0x${string}`): Promise<bigint>;
  // eth_call first: a revert (not a skip) stops the batch before gas is spent.
  simulate(ids: `0x${string}`[], amounts: bigint[], settlementId: bigint): Promise<void>;
  charge(ids: `0x${string}`[], amounts: bigint[], settlementId: bigint): Promise<ChargeResult>;
}

// Read the per-line outcome from a charge receipt's logs.
export function outcomesFromLogs(logs: Pick<Log, "data" | "topics">[], lines: number): { outcomes: LineOutcome[]; chargedWei: bigint } {
  const outcomes: LineOutcome[] = [];
  let charged = BigInt(0);
  for (const log of logs) {
    let ev;
    try {
      ev = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
    } catch {
      continue;
    }
    if (ev.eventName === "Charged") {
      outcomes.push({ charged: true });
      charged += ev.args.amount;
    } else if (ev.eventName === "ChargeSkipped") {
      outcomes.push({ charged: false, reason: SKIP_REASONS[Number(ev.args.reason)] ?? `reason ${ev.args.reason}` });
    }
  }
  while (outcomes.length < lines) outcomes.push({ charged: false, reason: "no event" });
  return { outcomes: outcomes.slice(0, lines), chargedWei: charged };
}

// The charge tx was sent but its receipt could not be read: it may have
// moved funds. Its lines stay locked (never re-charged automatically).
export class ChargeOutcomeUnknown extends Error {
  constructor(public hash: `0x${string}`, cause: unknown) {
    super(`charge ${hash} sent, receipt unknown: ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 300));
  }
}

export async function evmCharger(): Promise<PoolCharger> {
  const address = poolAddress();
  if (!address) throw new Error("UPTIME_POOL_BRADBURY not configured");
  const { bradburyPublicClient, bradburyRelayerWallet } = await import("../chain");
  const pub = bradburyPublicClient();
  const wallet = bradburyRelayerWallet();
  return {
    lastSettlement: () => pub.readContract({ address, abi: POOL_ABI, functionName: "lastSettlement", args: [ROLE_SCHEDULER] }),
    async lineCap(id) {
      const [terms] = await pub.readContract({ address, abi: POOL_ABI, functionName: "getAllowance", args: [id, ROLE_SCHEDULER] });
      return terms.maxPerCharge;
    },
    async simulate(ids, amounts, sid) {
      await pub.simulateContract({ address, abi: POOL_ABI, functionName: "charge", args: [ids, amounts, sid], account: wallet.account });
    },
    async charge(ids, amounts, sid) {
      const hash = await wallet.writeContract({ address, abi: POOL_ABI, functionName: "charge", args: [ids, amounts, sid] });
      let receipt;
      try {
        receipt = await pub.waitForTransactionReceipt({ hash });
      } catch (e) {
        throw new ChargeOutcomeUnknown(hash, e);
      }
      if (receipt.status !== "success") throw new Error(`charge reverted in ${hash}`);
      const mine = receipt.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase());
      const { outcomes, chargedWei } = outcomesFromLogs(mine, ids.length);
      return { hash, outcomes, chargedWei: chargedWei.toString() };
    },
  };
}

export type SettleResult =
  | { enabled: false }
  | {
      enabled: true;
      network: Network;
      settlementId?: number;
      onchainId?: string;
      lines: number;
      charged?: number;
      skipped?: number;
      capped?: number; // runs charged less than their cost because of the per-run cap
      totalWei: string;
      chargedWei?: string;
      txHash?: string;
      error?: string;
    };

const MAX_BATCH = 256; // UptimePool.MAX_BATCH
const MAX_STEP_LINES = MAX_BATCH * 8;

export interface RunCharge {
  runId: string;
  poolId: string;
  amountWei: bigint; // what this run's single on-chain line charges
  costWei: bigint; // what the run cost before the cap
  steps: ChargeLine[]; // its step lines, amounts summing to amountWei
}

/**
 * Group a run's step lines into ONE charge, capped. Each step's amount is its
 * gas, plus the run fee on the fee line; a capped run's steps are filled in
 * step order until the cap is spent, so the recorded lines add up to the charge.
 * `onchainCap` is the pool's maxPerCharge, when known.
 */
export function runCharges(lines: ChargeLine[], prices: Prices, onchainCap: (poolId: string) => bigint | null = () => null): RunCharge[] {
  const byRun = new Map<string, ChargeLine[]>();
  for (const l of lines) {
    const g = byRun.get(l.runId);
    if (g) g.push(l);
    else byRun.set(l.runId, [l]);
  }
  const out: RunCharge[] = [];
  for (const [runId, steps] of byRun) {
    const raw = steps.map((l) => (l.runFee ? runChargeWei(prices, BigInt(l.amountWei)) : BigInt(l.amountWei)));
    const costWei = raw.reduce((a, b) => a + b, BigInt(0));
    const cap = perRunCap(steps[0].capWei, onchainCap(steps[0].poolId));
    let left = cap === null || costWei <= cap ? costWei : cap;
    const amountWei = left;
    const priced = steps.map((l, i) => {
      const a = raw[i] < left ? raw[i] : left;
      left -= a;
      return { ...l, amountWei: a.toString() };
    });
    out.push({ runId, poolId: steps[0].poolId, amountWei, costWei, steps: priced });
  }
  return out;
}

export async function settle(
  repo: Repo,
  nowSec: number,
  opts: { enabled?: boolean; charger?: () => Promise<PoolCharger>; prices?: Prices } = {}
): Promise<SettleResult> {
  if (!(opts.enabled ?? poolChargingEnabled())) return { enabled: false };
  const network: Network = "bradbury";
  // Amounts come from lib/pricing.ts, the same module the wizard estimates
  // with: each run pays its actual gas plus one flat fee (on its first tx line).
  const prices = opts.prices ?? readPrices();
  const stepLines = await repo.unsettled(network, nowSec, MAX_STEP_LINES, { feeLines: prices.runFeeWei > BigInt(0) });
  // A full page may have cut its last run in half: leave that run for next time.
  let candidate = stepLines;
  if (stepLines.length === MAX_STEP_LINES) {
    const lastRun = stepLines[stepLines.length - 1].runId;
    const kept = stepLines.filter((l) => l.runId !== lastRun);
    if (kept.length) candidate = kept;
  }
  if (candidate.length === 0) return { enabled: true, network, lines: 0, totalWei: "0" };
  const charger = await (opts.charger ?? evmCharger)();
  const caps = new Map<string, bigint | null>();
  if (charger.lineCap) {
    for (const p of new Set(candidate.map((l) => l.poolId))) {
      // Unreadable: no extra clamp here; the on-chain line cap still applies.
      caps.set(p, await charger.lineCap(p as `0x${string}`).catch(() => null));
    }
  }
  const runs = runCharges(candidate, prices, (p) => caps.get(p) ?? null).slice(0, MAX_BATCH);
  const lines = runs.flatMap((r) => r.steps);
  const total = runs.reduce((s, r) => s + r.amountWei, BigInt(0)).toString();
  const capped = runs.filter((r) => r.amountWei < r.costWei).length;
  const last = await charger.lastSettlement();
  const { id, onchainId } = await repo.recordSettlement(network, nowSec, lines, last + BigInt(1));
  const ids = runs.map((r) => r.poolId as `0x${string}`);
  const amounts = runs.map((r) => r.amountWei);
  try {
    await charger.simulate(ids, amounts, onchainId);
    const r = await charger.charge(ids, amounts, onchainId);
    // One on-chain line per run: every step of a run shares its run's outcome.
    const outcomes = runs.flatMap((run, i) => run.steps.map(() => r.outcomes[i] ?? { charged: false, reason: "no event" }));
    await repo.finishSettlement(id, { ok: true, txHash: r.hash, error: null, outcomes, chargedWei: r.chargedWei });
    const charged = r.outcomes.filter((o) => o.charged).length;
    return {
      enabled: true, network, settlementId: id, onchainId: onchainId.toString(), lines: runs.length,
      charged, skipped: runs.length - charged, capped, totalWei: total, chargedWei: r.chargedWei, txHash: r.hash,
    };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const unknown = e instanceof ChargeOutcomeUnknown;
    await repo.finishSettlement(id, { ok: false, txHash: unknown ? e.hash : null, error, keepLocked: unknown });
    return { enabled: true, network, settlementId: id, onchainId: onchainId.toString(), lines: runs.length, totalWei: total, error };
  }
}
