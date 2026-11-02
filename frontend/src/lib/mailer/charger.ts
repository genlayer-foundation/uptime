// Charge-before-send on Bradbury (§11.2, D16). The mailer is spender ROLE 2 on
// contracts/evm/src/UptimePool.sol. `charge(ids[], amounts[], settlementId)`
// never reverts for a bad LINE: it emits ChargeSkipped and moves nothing. So a
// mined tx proves nothing on its own. The email is sent ONLY when:
//   1. the pool exists and its on-chain owner is the job's owner wallet,
//   2. an eth_call simulation returns total == price (the line would charge),
//   3. the receipt is `success` AND carries a Charged event for exactly this
//      pool, role 2, settlementId and amount, from the pool address.
// Anything else is a refusal and no email goes out.
//
// settlementId = the email ledger row id (strictly increasing, one per email).

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRADBURY_PHASE2 } from "../chains";
import { bradburyEvmRpc, mailerKey, poolAddress } from "./config";

export const ROLE_MAILER = 2;

export const SKIP_REASONS = [
  "None",
  "NoPool",
  "PoolPaused",
  "NoAllowance",
  "AllowancePaused",
  "NotStarted",
  "Expired",
  "ZeroAmount",
  "OverLineCap",
  "OverPeriodCap",
  "InsufficientBalance",
] as const;

/** The subset of the UptimePool ABI the mailer uses. Mirrors UptimePool.sol. */
export const POOL_MAILER_ABI = [
  {
    type: "function",
    name: "charge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "settlementId", type: "uint256" },
    ],
    outputs: [{ name: "total", type: "uint256" }],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ name: "uptimeId", type: "bytes32" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "paused", type: "bool" },
      { name: "balance", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Charged",
    inputs: [
      { name: "uptimeId", type: "bytes32", indexed: true },
      { name: "role", type: "uint8", indexed: true },
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChargeSkipped",
    inputs: [
      { name: "uptimeId", type: "bytes32", indexed: true },
      { name: "role", type: "uint8", indexed: true },
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
    ],
  },
] as const;

export type ChargeResult =
  | { outcome: "charged"; txHash: string }
  | { outcome: "skipped"; reason: string; txHash?: string }
  | { outcome: "failed"; reason: string; txHash?: string };

export interface ChargeRequest {
  poolId: `0x${string}`;
  ownerWallet: string; // lowercased
  amountWei: bigint;
  settlementId: bigint;
}

export interface PoolCharger {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Read the receipt's logs: Charged => charged, ChargeSkipped => skipped with the
 * contract's reason, neither => failed. Only logs from `pool` for this exact
 * (poolId, role 2, settlementId) count. Pure, so tests feed it encoded logs.
 */
export function interpretChargeLogs(
  logs: readonly Log[],
  pool: string,
  req: Pick<ChargeRequest, "poolId" | "amountWei" | "settlementId">
): ChargeResult & { outcome: "charged" | "skipped" | "failed" } {
  const mine = logs.filter((l) => l.address?.toLowerCase() === pool.toLowerCase());
  const events = parseEventLogs({ abi: POOL_MAILER_ABI, logs: mine as Log[], strict: true });
  for (const ev of events) {
    const a = ev.args as { uptimeId: string; role: number; settlementId: bigint; amount: bigint; reason?: number };
    if (a.uptimeId.toLowerCase() !== req.poolId.toLowerCase()) continue;
    if (Number(a.role) !== ROLE_MAILER || a.settlementId !== req.settlementId) continue;
    if (ev.eventName === "Charged") {
      if (a.amount !== req.amountWei) return { outcome: "failed", reason: "charged_amount_mismatch" };
      return { outcome: "charged", txHash: "" };
    }
    if (ev.eventName === "ChargeSkipped") {
      return { outcome: "skipped", reason: SKIP_REASONS[Number(a.reason)] ?? `Reason${a.reason}` };
    }
  }
  return { outcome: "failed", reason: "no_charge_event" };
}

function shortError(e: unknown): string {
  const err = e as { shortMessage?: string; name?: string; data?: { errorName?: string }; cause?: { data?: { errorName?: string } } };
  const name = err?.data?.errorName ?? err?.cause?.data?.errorName;
  if (name) return name;
  return (err?.shortMessage ?? err?.name ?? "error").slice(0, 120);
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** Real charger over viem. Built lazily; returns null when not configured. Signs with MAILER_KEY. */
export function evmPoolCharger(): PoolCharger | null {
  const pool = poolAddress();
  const key = mailerKey();
  if (!pool || !key) return null;
  const chain = defineChain({
    id: BRADBURY_PHASE2.chainId,
    name: "GenLayer Bradbury Phase 2",
    nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
    rpcUrls: { default: { http: [bradburyEvmRpc(BRADBURY_PHASE2.chainRpc)] } },
  });
  const transport = http(bradburyEvmRpc(BRADBURY_PHASE2.chainRpc), { timeout: 20_000 });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });

  return {
    async charge(req) {
      // 0. pinned chain: refuse to sign for anything but 4221
      try {
        if ((await pub.getChainId()) !== BRADBURY_PHASE2.chainId) return { outcome: "failed", reason: "wrong_chain" };
      } catch (e) {
        return { outcome: "failed", reason: `rpc:${shortError(e)}` };
      }
      // 1. the pool is the job owner's
      try {
        const [owner] = await pub.readContract({ address: pool, abi: POOL_MAILER_ABI, functionName: "getPool", args: [req.poolId] });
        if (owner === ZERO) return { outcome: "skipped", reason: "NoPool" };
        if (owner.toLowerCase() !== req.ownerWallet) return { outcome: "failed", reason: "pool_owner_mismatch" };
      } catch (e) {
        return { outcome: "failed", reason: `getPool:${shortError(e)}` };
      }
      // 2. simulate: total must equal the price, else the line would be skipped
      let request;
      try {
        const sim = await pub.simulateContract({
          address: pool,
          abi: POOL_MAILER_ABI,
          functionName: "charge",
          args: [[req.poolId], [req.amountWei], req.settlementId],
          account,
        });
        if (sim.result !== req.amountWei) return { outcome: "skipped", reason: "simulation_skipped" };
        request = sim.request;
      } catch (e) {
        return { outcome: "failed", reason: `simulate:${shortError(e)}` };
      }
      // 3. send, then trust only the receipt's events
      let hash: `0x${string}`;
      try {
        hash = await wallet.writeContract(request);
      } catch (e) {
        return { outcome: "failed", reason: `send:${shortError(e)}` };
      }
      try {
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
        if (receipt.status !== "success") return { outcome: "failed", reason: "reverted", txHash: hash };
        const r = interpretChargeLogs(receipt.logs, pool, req);
        return r.outcome === "charged" ? { outcome: "charged", txHash: hash } : { ...r, txHash: hash };
      } catch (e) {
        // Mined state unknown: do NOT send. The row keeps the hash for an operator.
        return { outcome: "failed", reason: `receipt:${shortError(e)}`, txHash: hash };
      }
    },
  };
}
