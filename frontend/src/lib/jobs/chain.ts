// Per-network clients for the job executor, from the explicit chain config
// in lib/chains.ts (Bradbury = Phase 2 address overrides, never the stale
// genlayer-js defaults).
//
//   genlayer  genlayer-js client: deploy / write / read (Bradbury: 2.x, txs
//             carry the Phase 2 fee deposit, lib/genlayer/fees.ts; Studio: 1.x,
//             legacy addTransaction, lib/genlayer/studio.ts), signed by that
//             network's relayer key (lib/signer.ts: RELAYER_KEY_STUDIO /
//             RELAYER_KEY_BRADBURY); the Heartbeat signs with the same key
//   evm       viem on the Bradbury chain RPC: the UptimePool contract

import { createAccount, createClient } from "genlayer-js";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRADBURY_PHASE2, CHAINS } from "@/lib/chains";
import { signingKey } from "@/lib/signer";
import { withFees } from "@/lib/genlayer/fees";
import { studioClient } from "@/lib/genlayer/studio";
import type { Network } from "./types";

// The slice of genlayer-js the executor uses (fakeable in tests).
export interface ChainClient {
  deployContract(a: { code: string; args?: unknown[] }): Promise<`0x${string}`>;
  writeContract(a: { address: `0x${string}`; functionName: string; args?: unknown[]; value: bigint }): Promise<unknown>;
  readContract(a: { address: `0x${string}`; functionName: string; args?: unknown[] }): Promise<unknown>;
  getTransaction(a: { hash: `0x${string}` }): Promise<ChainTx>;
}

export interface ChainTx {
  statusName?: string;
  status?: string | number;
  createdTimestamp?: string;
  lastVoteTimestamp?: string;
  numOfRounds?: string;
  txExecutionResultName?: string;
  recipient?: string;
  to_address?: string;
  txDataDecoded?: { contractAddress?: string };
  lastRound?: { validatorVotesName?: string[] };
  [k: string]: unknown;
}

export function relayerKey(n: Network): `0x${string}` | null {
  return signingKey(n);
}

export function relayerAddress(n: Network): string | null {
  const k = relayerKey(n);
  try {
    return k ? privateKeyToAccount(k).address : null;
  } catch {
    return null; // malformed key: report "not configured", never the value
  }
}

export function genlayerClient(n: Network): ChainClient {
  const key = relayerKey(n);
  if (!key) throw new Error(`relayer key for ${n} not configured`);
  // Studio: genlayer-js 1.x, the legacy addTransaction hosted Studio decodes,
  // no fees (lib/genlayer/studio.ts).
  if (n === "studio") return studioClient(key) as unknown as ChainClient;
  // Bradbury deploys/writes carry the Phase 2 fee deposit (lib/genlayer/fees.ts).
  return withFees(createClient({ chain: CHAINS[n].chain, account: createAccount(key) }), n) as unknown as ChainClient;
}

export const BRADBURY_EVM = defineChain({
  id: BRADBURY_PHASE2.chainId,
  name: "GenLayer Testnet Bradbury",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [BRADBURY_PHASE2.chainRpc] } },
  blockExplorers: { default: { name: "Bradbury scan", url: BRADBURY_PHASE2.chainExplorer } },
  testnet: true,
});

function evmTransport() {
  return http(process.env.BRADBURY_EVM_RPC?.trim() || undefined);
}

export function bradburyPublicClient() {
  return createPublicClient({ chain: BRADBURY_EVM, transport: evmTransport() });
}

export function bradburyRelayerWallet() {
  const key = relayerKey("bradbury");
  if (!key) throw new Error("relayer key for bradbury not configured");
  return createWalletClient({ chain: BRADBURY_EVM, account: privateKeyToAccount(key), transport: evmTransport() });
}
