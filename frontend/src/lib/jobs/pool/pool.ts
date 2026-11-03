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
import type { LineOutcome, Repo } from "../repo";
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
      return { owner, paused, balance, allowancePaused: allowance[3], allowanceActive: allowance[4], available };
    },
  };
}

const txSteps = (j: JobRow) => j.steps.filter((s) => s.kind !== "read").length;

// Pure decision. pool === "unconfigured" means no pool contract address is set.
export function fundingDecision(j: JobRow, pool: PoolView | "unconfigured", allowlist: ReadonlySet<string>, costWei: bigint): FundingCheck {
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
  const perLine = j.perRunCapWei ? BigInt(j.perRunCapWei) : costWei;
  if (pool.available < perLine || pool.balance < perLine * BigInt(Math.max(1, txSteps(j)))) {
    return { ok: false, reason: "Pool balance or allowance cannot cover the next run: top up to continue" };
  }
  return { ok: true };
}

export function makeFundingCheck(reader: PoolReader | null, allowlist?: ReadonlySet<string>) {
  return async (j: JobRow): Promise<FundingCheck> => {
    try {
      const v = reader ? await reader.read(j.poolId as `0x${string}`) : "unconfigured";
      // The largest single line a run sends: its first tx's gas plus the run fee.
      return fundingDecision(j, v, allowlist ?? studioAllowlist(), runChargeWei(readPrices(), runCostWei()));
    } catch (e) {
      return { ok: false, reason: `Pool unreadable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
    }
  };
}

// ---------------------------------------------------------------------------
// Settlement: ONE `charge` tx per period for every unsettled Bradbury step
// run, as role 1 (scheduler). A rule-breaking line is SKIPPED on-chain
// (ChargeSkipped), not reverted, so outcomes come from the receipt's events,
// one per line, in line order. OFF unless POOL_CHARGING_ENABLED=1.

export interface ChargeResult {
  hash: `0x${string}`;
  outcomes: LineOutcome[];
  chargedWei: string;
}

export interface PoolCharger {
  lastSettlement(): Promise<bigint>;
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
      totalWei: string;
      chargedWei?: string;
      txHash?: string;
      error?: string;
    };

const MAX_BATCH = 256; // UptimePool.MAX_BATCH

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
  const lines = (await repo.unsettled(network, nowSec, MAX_BATCH, { feeLines: prices.runFeeWei > BigInt(0) })).map((l) => {
    const gas = BigInt(l.amountWei);
    return { ...l, amountWei: (l.runFee ? runChargeWei(prices, gas) : gas).toString() };
  });
  if (lines.length === 0) return { enabled: true, network, lines: 0, totalWei: "0" };
  const total = lines.reduce((s, l) => s + BigInt(l.amountWei), BigInt(0)).toString();
  const charger = await (opts.charger ?? evmCharger)();
  const last = await charger.lastSettlement();
  const { id, onchainId } = await repo.recordSettlement(network, nowSec, lines, last + BigInt(1));
  const ids = lines.map((l) => l.poolId as `0x${string}`);
  const amounts = lines.map((l) => BigInt(l.amountWei));
  try {
    await charger.simulate(ids, amounts, onchainId);
    const r = await charger.charge(ids, amounts, onchainId);
    await repo.finishSettlement(id, { ok: true, txHash: r.hash, error: null, outcomes: r.outcomes, chargedWei: r.chargedWei });
    const charged = r.outcomes.filter((o) => o.charged).length;
    return {
      enabled: true, network, settlementId: id, onchainId: onchainId.toString(), lines: lines.length,
      charged, skipped: lines.length - charged, totalWei: total, chargedWei: r.chargedWei, txHash: r.hash,
    };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const unknown = e instanceof ChargeOutcomeUnknown;
    await repo.finishSettlement(id, { ok: false, txHash: unknown ? e.hash : null, error, keepLocked: unknown });
    return { enabled: true, network, settlementId: id, onchainId: onchainId.toString(), lines: lines.length, totalWei: total, error };
  }
}
