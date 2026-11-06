// Fee deposit for every Bradbury Phase 2 transaction.
//
// Phase 2's ConsensusMainWithFees takes addTransaction(params) with a fee
// distribution and a non-zero msg.value (the deposit); a tx without one
// reverts (FeeValueMustBeNonZero). genlayer-js >= 2.0 encodes that call and,
// given a distribution without feeValue, computes the deposit itself with
// FeeManager.calculateRoundFees(distribution, validators). We pass the
// distribution only, so the deposit always matches what the chain charges.
//
// Default (checked against the live FeeManager on 2026-11-06): one funded
// leader rotation, no pre-funded appeal, 0.025 GEN execution budget per round
// => ~0.05 GEN deposit per tx. Unused budget is refunded at finalization.
// The Heartbeat's every-5th-tick appeal pays its own charge (appealTransaction).
//
// Override any field with BRADBURY_TX_FEES, a JSON object, e.g.
//   BRADBURY_TX_FEES='{"appealRounds":"1","rotations":["1","1"]}'   (~0.125 GEN)
// Studio is free: no fees there.

import type { NetworkKey } from "../chains";

export interface FeesDistribution {
  leaderTimeunitsAllocation: bigint;
  validatorTimeunitsAllocation: bigint;
  appealRounds: bigint;
  executionBudgetPerRound: bigint;
  rotations: bigint[];
  maxPriceGenPerTimeUnit: bigint;
  storageFeeMaxGasPrice: bigint;
  receiptFeeMaxGasPrice: bigint;
}

export const DEFAULT_BRADBURY_FEES: FeesDistribution = {
  leaderTimeunitsAllocation: 600n,
  validatorTimeunitsAllocation: 600n,
  appealRounds: 0n,
  executionBudgetPerRound: 25_000_000_000_000_000n, // 0.025 GEN
  rotations: [1n],
  maxPriceGenPerTimeUnit: 2n,
  storageFeeMaxGasPrice: 300_000_000n,
  receiptFeeMaxGasPrice: 300_000_000n,
};

type Env = Record<string, string | undefined>;

function uint(v: unknown, name: string): bigint {
  const n = typeof v === "bigint" ? v : BigInt(String(v));
  if (n < 0n) throw new Error(`BRADBURY_TX_FEES.${name} must be >= 0`);
  return n;
}

/** The fee distribution for a network's txs; null where txs are free (Studio). */
export function feesFor(n: NetworkKey, env: Env = process.env): { distribution: FeesDistribution } | null {
  if (n !== "bradbury") return null;
  const d: FeesDistribution = { ...DEFAULT_BRADBURY_FEES, rotations: [...DEFAULT_BRADBURY_FEES.rotations] };
  const raw = env.BRADBURY_TX_FEES?.trim();
  if (raw) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw);
    } catch {
      throw new Error("BRADBURY_TX_FEES is not valid JSON");
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === "rotations") {
        if (!Array.isArray(v) || !v.length) throw new Error("BRADBURY_TX_FEES.rotations must be a non-empty array");
        d.rotations = v.map((x) => uint(x, k));
      } else if (k in d) {
        (d as unknown as Record<string, bigint>)[k] = uint(v, k);
      } else {
        throw new Error(`BRADBURY_TX_FEES has unknown field "${k}"`);
      }
    }
  }
  if (d.rotations.length !== Number(d.appealRounds) + 1) {
    throw new Error("BRADBURY_TX_FEES: rotations needs appealRounds + 1 entries");
  }
  return { distribution: d };
}

interface Submitter {
  deployContract(a: Record<string, unknown>): Promise<unknown>;
  writeContract(a: Record<string, unknown>): Promise<unknown>;
}

/**
 * Wrap a genlayer-js client so every deploy and write carries the network's
 * fee distribution (unless the caller passes its own). Reads, getTransaction
 * and appeals pass through untouched.
 */
export function withFees<C extends Submitter>(client: C, n: NetworkKey, env: Env = process.env): C {
  const fees = feesFor(n, env);
  if (!fees) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "deployContract" || prop === "writeContract") {
        return (a: Record<string, unknown>) => target[prop]({ fees, ...a });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
