// ABI of contracts/evm/src/UptimePool.sol (hand-written from the source at
// ad65096; re-check against `forge inspect UptimePool abi` when it changes).
// Client-safe: the UI imports it for the user's own deposit/withdraw/pause txs.
//
// NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.

const TERMS = {
  name: "terms",
  type: "tuple",
  components: [
    { name: "periodAmount", type: "uint128" },
    { name: "periodDuration", type: "uint64" },
    { name: "startDate", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "maxPerCharge", type: "uint128" },
  ],
} as const;

export const POOL_ABI = [
  // owner
  {
    type: "function", name: "deposit", stateMutability: "payable", outputs: [],
    inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "roles", type: "uint8[]" }, { ...TERMS, name: "terms", type: "tuple[]" }],
  },
  { type: "function", name: "topUp", stateMutability: "payable", outputs: [], inputs: [{ name: "uptimeId", type: "bytes32" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "withdrawTo", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "setPaused", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "paused", type: "bool" }], outputs: [] },
  { type: "function", name: "setAllowance", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "role", type: "uint8" }, TERMS], outputs: [] },
  { type: "function", name: "setAllowancePaused", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "role", type: "uint8" }, { name: "paused", type: "bool" }], outputs: [] },
  { type: "function", name: "revokeAllowance", stateMutability: "nonpayable", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "role", type: "uint8" }], outputs: [] },
  // spenders
  { type: "function", name: "charge", stateMutability: "nonpayable", inputs: [{ name: "ids", type: "bytes32[]" }, { name: "amounts", type: "uint256[]" }, { name: "settlementId", type: "uint256" }], outputs: [{ name: "total", type: "uint256" }] },
  // views
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "uptimeId", type: "bytes32" }], outputs: [
    { name: "owner", type: "address" }, { name: "paused", type: "bool" }, { name: "balance", type: "uint256" },
  ] },
  { type: "function", name: "getAllowance", stateMutability: "view", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "role", type: "uint8" }], outputs: [
    TERMS, { name: "spentInPeriod", type: "uint256" }, { name: "lastPeriod", type: "uint256" },
    { name: "paused", type: "bool" }, { name: "active", type: "bool" },
  ] },
  { type: "function", name: "available", stateMutability: "view", inputs: [{ name: "uptimeId", type: "bytes32" }, { name: "role", type: "uint8" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "lastSettlement", stateMutability: "view", inputs: [{ name: "role", type: "uint8" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "spenderOf", stateMutability: "view", inputs: [{ name: "role", type: "uint8" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "ALL", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  // events
  {
    type: "event", name: "Charged", anonymous: false,
    inputs: [
      { name: "uptimeId", type: "bytes32", indexed: true }, { name: "role", type: "uint8", indexed: true },
      { name: "settlementId", type: "uint256", indexed: true }, { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "ChargeSkipped", anonymous: false,
    inputs: [
      { name: "uptimeId", type: "bytes32", indexed: true }, { name: "role", type: "uint8", indexed: true },
      { name: "settlementId", type: "uint256", indexed: true }, { name: "amount", type: "uint256", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event", name: "Settled", anonymous: false,
    inputs: [
      { name: "role", type: "uint8", indexed: true }, { name: "settlementId", type: "uint256", indexed: true },
      { name: "spender", type: "address", indexed: true }, { name: "total", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ROLE_SCHEDULER = 1;
export const ROLE_MAILER = 2;

// UptimePool.SkipReason, by index.
export const SKIP_REASONS = [
  "None", "NoPool", "PoolPaused", "NoAllowance", "AllowancePaused", "NotStarted", "Expired",
  "ZeroAmount", "OverLineCap", "OverPeriodCap", "InsufficientBalance",
] as const;

export function poolAddress(): `0x${string}` | null {
  const a = (process.env.UPTIME_POOL_BRADBURY || process.env.NEXT_PUBLIC_UPTIME_POOL_BRADBURY)?.trim();
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as `0x${string}`) : null;
}

// Settlement (the scheduler's batched `charge`) stays OFF until the pool is
// deployed and reviewed. Anything but the exact string "1" is off.
export function poolChargingEnabled(): boolean {
  return process.env.POOL_CHARGING_ENABLED === "1";
}
