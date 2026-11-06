// Explicit per-network chain config. Import THIS instead of the genlayer-js defaults:
//
//   import { CHAINS } from "@/lib/chains";      // or "../chains" from src/lib/genlayer/
//   createClient({ chain: CHAINS.bradbury.chain, account });
//
// Why: genlayer-js 0.26.5 and 1.1.8 (per docs/PRODUCT.md §2) shipped `testnetBradbury`
// with the SUNSET Bradbury Phase 1 contracts. The RPC host it uses, rpc-bradbury.genlayer.com,
// now serves Phase 2 (genesis hash below matched on 2026-11-02), so the SDK talks to the right
// chain with the wrong consensus/staking addresses.
//
// Sources, all checked 2026-11-02:
//  - genlayerlabs/genlayer-consensus@4e5bacaa deployments/bradbury-phase-2.json
//  - the live AddressManager 0x3F71AE08…38E0, getAllContractAddresses(), via
//    https://rpc.testnet-chain.genlayer.com (every address below matched the manifest)
//  - testnet/CLAUDE.md (workspace) for AddressManager / Staking / ConsensusMain
//  - docs.genlayer.com/developers/networks for chain id, currency and genesis hash
//
// Docs advice: resolve Staking and ConsensusMain through the AddressManager rather than
// treating them as permanent. These are pinned for a deterministic client; re-check them
// against `AddressManager.getAllContractAddresses()` when Labs announces a redeploy.
//
// genlayer-js 2.0.0-rc.2 (pinned) ships Phase 2 ABIs and the same addresses in its own
// testnetBradbury; the override stays to pin the RPC host and catch a future SDK drift. 0.26.x
// encoded the legacy 5-arg addTransaction, which Phase 2 lacks: every submit reverted.
// Fees: lib/genlayer/fees.ts.

import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

type Address = `0x${string}`;

/** Bradbury Phase 2 (Arbitrum Orbit / Conduit, chain 4221). */
export const BRADBURY_PHASE2 = {
  chainId: 4221,
  /** Block 0 hash. A different value means the RPC points at another deployment. */
  genesisHash: "0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4",
  /** GenLayer node RPC: serves gen_* AND passes eth_* through. */
  genlayerRpc: "https://rpc-bradbury.genlayer.com",
  /** Plain EVM chain RPC (no gen_*). Rate-limited without a Conduit key. Use for the pool contract. */
  chainRpc: "https://rpc.testnet-chain.genlayer.com",
  chainExplorer: "https://scan.testnet-chain.genlayer.com",
  contracts: {
    addressManager: "0x3F71AE080BD6270A91dBcc7960d88797828538E0",
    consensusMain: "0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019",
    consensusData: "0xc5FA6f82BEe53598825d6edf7E3e24613082c75B",
    staking: "0xD8fBa96C0dBB0257028dBc0107060b958e5c7113",
    stakingData: "0x8951E93ae3E95F44Bc700fd8D145d30f5eeD408E",
    feeManager: "0x7678587A847712f2A96082AC07883A88D0fc7245",
    roundsStorage: "0x4038d4F72C7aAbA5a442cC0dA946012B9E3f4B8a",
    appeals: "0xdc953c3bCf8837987853ca05a78D52fFC3E18651",
    validatorWalletFactory: "0x399FCBe6b442903cbA4d3B647B4b30EddF729314",
  } satisfies Record<string, Address>,
  /** The SDK defaults these replace (Phase 1, sunset 2026-10-20). Kept to detect drift. */
  staleSdkDefaults: {
    consensusMain: "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D",
    consensusData: "0x85D7bf947A512Fc640C75327A780c90847267697",
    staking: "0x4A4449E617F8D10FDeD0b461CadEf83939E821A5",
    feeManager: "0xF205868bf5db79d2162843742D18D0900A9E462a",
    roundsStorage: "0x7134D05af13A14c0b66Fe129fb930b1d0C420e33",
  } satisfies Record<string, Address>,
} as const;

function withAddress<T extends { address: Address } | null>(c: T, address: Address): T {
  if (c === null) throw new Error("genlayer-js chain is missing a contract this override expects");
  return { ...c, address };
}

const p2 = BRADBURY_PHASE2.contracts;

export const bradburyPhase2: GenLayerChain = {
  ...testnetBradbury,
  id: BRADBURY_PHASE2.chainId,
  name: "GenLayer Bradbury Phase 2",
  rpcUrls: { default: { http: [BRADBURY_PHASE2.genlayerRpc] } },
  blockExplorers: { default: { name: "GenLayer Chain Explorer", url: BRADBURY_PHASE2.chainExplorer } },
  consensusMainContract: withAddress(testnetBradbury.consensusMainContract, p2.consensusMain),
  consensusDataContract: withAddress(testnetBradbury.consensusDataContract, p2.consensusData),
  stakingContract: withAddress(testnetBradbury.stakingContract, p2.staking),
  feeManagerContract: withAddress(testnetBradbury.feeManagerContract, p2.feeManager),
  roundsStorageContract: withAddress(testnetBradbury.roundsStorageContract, p2.roundsStorage),
};

export type NetworkKey = "studio" | "bradbury";

export interface NetworkConfig {
  key: NetworkKey;
  label: string;
  chain: GenLayerChain;
  /** Where the uptime pool lives; null where there is no pool (Studio GEN is free). */
  poolRpc: string | null;
  explorerUrl: string;
}

export const CHAINS: Record<NetworkKey, NetworkConfig> = {
  studio: {
    key: "studio",
    label: "GenLayer Studio",
    chain: studionet, // chain 61999, https://studio.genlayer.com/api
    poolRpc: null,
    explorerUrl: "https://explorer-studio.genlayer.com",
  },
  bradbury: {
    key: "bradbury",
    label: "Bradbury",
    chain: bradburyPhase2,
    poolRpc: BRADBURY_PHASE2.chainRpc,
    explorerUrl: BRADBURY_PHASE2.chainExplorer,
  },
};

/** Local Studio, for development only. */
export const LOCALNET = localnet;

/** Uptime pool contract address per network, from env (not deployed yet). */
export function poolAddress(network: NetworkKey): Address | undefined {
  if (network !== "bradbury") return undefined;
  const v = process.env.UPTIME_POOL_BRADBURY || process.env.NEXT_PUBLIC_UPTIME_POOL_BRADBURY;
  return v && v !== "undefined" ? (v.trim() as Address) : undefined;
}
