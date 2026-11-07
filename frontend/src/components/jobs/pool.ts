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
import { UPTIME_POOL_V2_ABI } from "@/lib/pool/abiV2";
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
let reportedV2 = false;
let config: Promise<{ address: Address | null; v2: boolean }> | null = null;
/** Address /api/presets reported, preferred over the build-time env. `v2` = community pools (UptimePoolV2). */
export function setReportedPoolAddress(a: string | null | undefined, v2?: boolean) {
  reported = a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Address) : null;
  reportedV2 = !!v2 && !!reported;
  config = Promise.resolve({ address: poolContract(), v2: reportedV2 });
}

/**
 * The pool the server uses (UPTIME_POOL_V2_BRADBURY wins over v1 there), asked
 * once per page from /api/presets. Falls back to the build-time env (v1).
 */
export function ensurePoolConfig(): Promise<{ address: Address | null; v2: boolean }> {
  if (JOBS_MOCK) return Promise.resolve({ address: poolContract(), v2: false });
  config ??= fetch("/api/presets", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((r: { pool?: { bradbury?: string | null; v2?: boolean } } | null) => {
      if (r?.pool) setReportedPoolAddress(r.pool.bradbury, r.pool.v2);
      return { address: poolContract(), v2: reportedV2 };
    })
    .catch(() => ({ address: poolContract(), v2: false }));
  return config;
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
  const address = (await ensurePoolConfig()).address;
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
  const address = (await ensurePoolConfig()).address;
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
  const address = (await ensurePoolConfig()).address;
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
  const address = (await ensurePoolConfig()).address;
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

// ------------------------------------------------------------- community pools (v2)

export type Backing = {
  backers: number;
  balanceWei: bigint;
  /** First page of backers with their current (pro-rata) balance, largest first. */
  list: { who: Address; wei: bigint }[];
  /** The viewer's own unspent share, when a wallet is known. */
  mineWei: bigint;
};

/** Who backs this pool and with how much. Null unless UptimePool v2 is on. */
export async function readBacking(poolId: string, wallet: string | null): Promise<Backing | null> {
  const { address, v2 } = await ensurePoolConfig();
  if (!address || !v2) return null;
  const [owner] = (await publicClient.readContract({ address, abi: UPTIME_POOL_V2_ABI, functionName: "getPool", args: [poolId as Hex] })) as unknown as readonly [Address];
  if (/^0x0{40}$/i.test(owner)) return null; // only the job's owner can open its pool
  const [[backers, balance], [who, wei]] = (await Promise.all([
    publicClient.readContract({ address, abi: UPTIME_POOL_V2_ABI, functionName: "getBacking", args: [poolId as Hex] }),
    publicClient.readContract({ address, abi: UPTIME_POOL_V2_ABI, functionName: "getContributors", args: [poolId as Hex, 0n, 50n] }),
  ])) as unknown as [readonly [bigint, bigint], readonly [readonly Address[], readonly bigint[], bigint]];
  const list = who.map((w, i) => ({ who: w, wei: wei[i] })).filter((x) => x.wei > 0n).sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : 0));
  let mineWei = 0n;
  if (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    mineWei = (await publicClient.readContract({
      address, abi: UPTIME_POOL_V2_ABI, functionName: "balanceOf", args: [poolId as Hex, wallet as Address],
    })) as bigint;
  }
  return { backers: Number(backers), balanceWei: balance, list, mineWei };
}

/** v2: anyone adds GEN to a job's pool; it stays theirs to withdraw until spent. */
export const backJob = (poolId: string, valueWei: bigint) => send("topUp", [poolId as Hex], valueWei);
/** v2: withdraw the caller's own unspent share (the contract's ALL sentinel). */
export const withdrawMyShare = (poolId: string) => send("withdraw", [poolId as Hex, 2n ** 256n - 1n]);
