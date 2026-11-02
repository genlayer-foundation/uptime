// UptimePool access for the jobs UI. Reads go through a public Bradbury RPC;
// writes are sent by the USER's wallet (deposit, topUp, withdraw, setPaused),
// never by this app. Under NEXT_PUBLIC_JOBS_MOCK=1 everything is simulated by
// lib/jobs/mock.ts and no wallet transaction is requested.
//
// Pool address: NEXT_PUBLIC_UPTIME_POOL_BRADBURY (lib/chains.ts poolAddress),
// or what /api/presets reports. Unset = the pool is not deployed, and the UI
// says so instead of guessing an address.

import { parseEther, type Address, type Hex } from "viem";
import { JOBS_MOCK } from "@/lib/jobs/client";
import { poolAddress } from "@/lib/chains";
import { ROLE_MAILER, ROLE_SCHEDULER, UPTIME_POOL_ABI } from "./poolAbi";
import { ensureBradbury, publicClient, requestAccount, walletClient } from "./wallet";

export type PoolInfo = {
  owner: Address;
  paused: boolean;
  balanceWei: bigint;
  /** What the scheduler could draw right now, after every allowance rule. */
  availableToSchedulerWei: bigint;
  perRunWei?: bigint;
  perDayWei?: bigint;
};

export type PoolTerms = { perRunWei: bigint; perDayWei: bigint };

let reported: Address | null = null;
/** Address /api/presets reported, preferred over the build-time env. */
export function setReportedPoolAddress(a: string | null | undefined) {
  reported = a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Address) : null;
}

export function poolContract(): Address | null {
  if (JOBS_MOCK) return "0x000000000000000000000000000000000000600d";
  return reported ?? poolAddress("bradbury") ?? null;
}

export function parseGen(s: string): bigint {
  const v = s.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(v)) throw new Error(`"${s}" is not a GEN amount`);
  return parseEther(v);
}

async function mock() {
  return (await import("@/lib/jobs/mock")).mockPool;
}

export async function readPool(poolId: string): Promise<PoolInfo | null> {
  if (JOBS_MOCK) {
    const p = (await mock()).get(poolId);
    if (!p) return null;
    return {
      owner: p.owner as Address,
      paused: p.paused,
      balanceWei: BigInt(p.balanceWei),
      availableToSchedulerWei: p.paused ? 0n : BigInt(p.balanceWei) < BigInt(p.perRunWei) ? BigInt(p.balanceWei) : BigInt(p.perRunWei),
      perRunWei: BigInt(p.perRunWei),
      perDayWei: BigInt(p.perDayWei),
    };
  }
  const address = poolContract();
  if (!address) return null;
  const [owner, paused, balance] = (await publicClient.readContract({
    address,
    abi: UPTIME_POOL_ABI,
    functionName: "getPool",
    args: [poolId as Hex],
  })) as readonly [Address, boolean, bigint];
  if (/^0x0{40}$/i.test(owner)) return null;
  const avail = (await publicClient.readContract({
    address,
    abi: UPTIME_POOL_ABI,
    functionName: "available",
    args: [poolId as Hex, ROLE_SCHEDULER],
  })) as bigint;
  let perRunWei: bigint | undefined;
  let perDayWei: bigint | undefined;
  try {
    const [terms] = (await publicClient.readContract({
      address,
      abi: UPTIME_POOL_ABI,
      functionName: "getAllowance",
      args: [poolId as Hex, ROLE_SCHEDULER],
    })) as readonly [{ periodAmount: bigint; maxPerCharge: bigint }, ...unknown[]];
    perDayWei = terms.periodAmount;
    perRunWei = terms.maxPerCharge;
  } catch {
    /* allowance view is optional for the panel */
  }
  return { owner, paused, balanceWei: balance, availableToSchedulerWei: avail, perRunWei, perDayWei };
}

type Write = { hash: Hex | "mock" };

async function send(functionName: "deposit" | "topUp" | "withdraw" | "setPaused", args: readonly unknown[], value?: bigint): Promise<Write> {
  const address = poolContract();
  if (!address) throw new Error("The UptimePool is not deployed yet (NEXT_PUBLIC_UPTIME_POOL_BRADBURY is unset).");
  const account = await requestAccount();
  await ensureBradbury();
  const wc = walletClient();
  // Simulate first: a revert surfaces as a readable error before the wallet prompt.
  const { request } = await publicClient.simulateContract({
    address,
    abi: UPTIME_POOL_ABI,
    functionName,
    args: args as never,
    value,
    account,
  } as never);
  const hash = await wc.writeContract(request as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash };
}

/** Create the pool: lock `valueWei` and grant the scheduler a per-day / per-run allowance. */
export async function depositPool(poolId: string, valueWei: bigint, terms: PoolTerms, owner?: string): Promise<Write> {
  if (JOBS_MOCK) {
    (await mock()).deposit(poolId, owner ?? "0x0", valueWei, terms.perRunWei, terms.perDayWei);
    return { hash: "mock" };
  }
  return send(
    "deposit",
    [
      poolId as Hex,
      [ROLE_SCHEDULER],
      [{ periodAmount: terms.perDayWei, periodDuration: 86_400n, startDate: 0n, expiry: 0n, maxPerCharge: terms.perRunWei }],
    ],
    valueWei
  );
}

export async function topUpPool(poolId: string, valueWei: bigint): Promise<Write> {
  if (JOBS_MOCK) {
    (await mock()).topUp(poolId, valueWei);
    return { hash: "mock" };
  }
  return send("topUp", [poolId as Hex], valueWei);
}

/** Withdraw to the owner. `"all"` passes the contract's ALL sentinel (type(uint256).max). */
export async function withdrawPool(poolId: string, amount: bigint | "all"): Promise<Write> {
  if (JOBS_MOCK) {
    (await mock()).withdraw(poolId, amount);
    return { hash: "mock" };
  }
  const ALL = 2n ** 256n - 1n;
  return send("withdraw", [poolId as Hex, amount === "all" ? ALL : amount]);
}

export async function setPoolPaused(poolId: string, paused: boolean): Promise<Write> {
  if (JOBS_MOCK) {
    (await mock()).setPaused(poolId, paused);
    return { hash: "mock" };
  }
  return send("setPaused", [poolId as Hex, paused]);
}

// ------------------------------------------------------------- mailer allowance

/** `setAllowance` from UptimePool.sol (owner only); not in the generated ABI excerpt. */
const SET_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "setAllowance",
    stateMutability: "nonpayable",
    inputs: [
      { name: "uptimeId", type: "bytes32" },
      { name: "role", type: "uint8" },
      {
        name: "terms",
        type: "tuple",
        components: [
          { name: "periodAmount", type: "uint128" },
          { name: "periodDuration", type: "uint64" },
          { name: "startDate", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "maxPerCharge", type: "uint128" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export type MailerAllowance = { active: boolean; perDayWei: bigint; perChargeWei: bigint; paused: boolean };

/** The mailer's (role 2) allowance on a pool: the on-chain cap on what alerts can cost per day. */
export async function readMailerAllowance(poolId: string): Promise<MailerAllowance | null> {
  if (JOBS_MOCK) {
    const p = (await mock()).get(poolId);
    if (!p) return null;
    return p.mailerPerDayWei
      ? { active: true, perDayWei: BigInt(p.mailerPerDayWei), perChargeWei: BigInt(p.mailerPerChargeWei ?? "0"), paused: false }
      : { active: false, perDayWei: 0n, perChargeWei: 0n, paused: false };
  }
  const address = poolContract();
  if (!address) return null;
  const [terms, , , paused, active] = (await publicClient.readContract({
    address,
    abi: UPTIME_POOL_ABI,
    functionName: "getAllowance",
    args: [poolId as Hex, ROLE_MAILER],
  })) as readonly [{ periodAmount: bigint; maxPerCharge: bigint }, bigint, bigint, boolean, boolean];
  return { active, perDayWei: terms.periodAmount, perChargeWei: terms.maxPerCharge, paused };
}

/**
 * Grant or replace the mailer's allowance, signed by the OWNER's wallet. The
 * terms come from lib/pricing.ts `mailerAllowanceTerms`, so the on-chain cap
 * equals the alert limits saved for the job.
 */
export async function setMailerAllowance(
  poolId: string,
  terms: { periodAmount: bigint; periodDuration: bigint; startDate: bigint; expiry: bigint; maxPerCharge: bigint }
): Promise<Write> {
  if (JOBS_MOCK) {
    (await mock()).setMailerAllowance(poolId, terms.periodAmount, terms.maxPerCharge);
    return { hash: "mock" };
  }
  const address = poolContract();
  if (!address) throw new Error("The UptimePool is not deployed yet (NEXT_PUBLIC_UPTIME_POOL_BRADBURY is unset).");
  const account = await requestAccount();
  await ensureBradbury();
  const { request } = await publicClient.simulateContract({
    address,
    abi: SET_ALLOWANCE_ABI,
    functionName: "setAllowance",
    args: [poolId as Hex, ROLE_MAILER, terms],
    account,
  } as never);
  const hash = await walletClient().writeContract(request as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash };
}
