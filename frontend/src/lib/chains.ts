// Explicit per-network chain config. Import THIS instead of the genlayer-js defaults:
//
//   import { CHAINS } from "@/lib/chains";      // or "../chains" from src/lib/genlayer/
//   createClient({ chain: CHAINS.bradbury.chain, account });
//
// Bradbury is one rollup (Arbitrum Orbit / Conduit, chain 4221) that has carried several
// consensus deployments: Phase 2, Phantom Bradbury, Phase 3. They share the chain id, the
// chain RPC, the explorer and native GEN, and are told apart ONLY by contract address. So a
// deployment is one object below, `BRADBURY` names the one this app talks to, and nothing
// else in the app names a phase. Moving to the next deployment (or adding a second network
// such as Clarke) is a new object here, not a rename across the app.
//
// Phase 3 sources, all checked 2026-11-25:
//  - genlayerlabs/genlayer-networks bradbury-phase-3/testnet_deployments.json
//    (key genlayerOrbitTestnet.deployment_bradbury_phase_3; consensus release v0.6.0,
//    genlayerlabs/genlayer-consensus@8805afba): every address below is copied from it
//  - bradbury-phase-3/abi vs bradbury-phase-2/abi: addTransaction(params) (0x35a251fb),
//    submitAppeal, FeeManager.calculateRoundFees, ConsensusData, Appeals are unchanged
//  - the live chain: code at each address, and calculateRoundFees on the Phase 3 FeeManager
//    quotes the same deposit as Phase 2 did for the default distribution (lib/genlayer/fees.ts)
//
// genlayer-js is pinned at 2.0.0-rc.2, whose own testnetBradbury carries the PHASE 2 addresses
// (2.1.0 is the first release with Phase 3's). The override below replaces every address the
// SDK uses, and the ABIs the app calls are the same in both, so the pin stays.
//
// GenLayer node RPC: `gen_*` calls (readContract, schemas, gen_call) need a GenLayer node that
// tracks THIS deployment. The chain RPC serves none of them, and a node following another
// deployment answers for the same chain id with that deployment's contracts. Phase 3's node is
// https://rpc.bradbury.genlayer.com (checked 2026-11-25: it resolves Phase 3 transactions and
// contracts and has no code for Phase 2's; the older rpc-bradbury.genlayer.com, hyphen, still
// tracks Phase 2). NEXT_PUBLIC_BRADBURY_GENLAYER_RPC overrides it.
//
// That node answers eth_sendRawTransaction "method not found", so `sendRpc` names where signed
// transactions go instead (the chain RPC); lib/genlayer/sendRoute.ts reroutes them server-side.
// Browser wallets send through their own RPC (components/jobs/wallet.ts adds the chain RPC).

import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

type Address = `0x${string}`;

/** One consensus deployment on a GenLayer rollup. */
export interface Deployment {
  /** Shown to wallets and in logs. */
  name: string;
  chainId: number;
  /** Block 0 hash of the rollup. A different value means the RPC points at another chain. */
  genesisHash: `0x${string}`;
  /** Block the deployment starts at (its AddressManager). */
  genesisBlock: number;
  /** GenLayer node RPC: serves gen_* AND passes eth_* through. */
  genlayerRpc: string;
  /**
   * Where signed transactions (eth_sendRawTransaction) go when `genlayerRpc` does not accept
   * them. Unset = `genlayerRpc` takes them too.
   */
  sendRpc?: string;
  /** Plain EVM chain RPC (no gen_*). Rate-limited without a Conduit key. Use for the pool contract. */
  chainRpc: string;
  chainExplorer: string;
  contracts: {
    addressManager: Address;
    consensusMain: Address;
    consensusData: Address;
    staking: Address;
    stakingData: Address;
    feeManager: Address;
    roundsStorage: Address;
    appeals: Address;
    validatorWalletFactory: Address;
  };
}

/** Bradbury Phase 3 (consensus v0.6.0, deployed 2026-11-24 on chain 4221). */
const BRADBURY_PHASE_3: Deployment = {
  name: "GenLayer Bradbury Phase 3",
  chainId: 4221,
  genesisHash: "0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4",
  genesisBlock: 694191,
  genlayerRpc: process.env.NEXT_PUBLIC_BRADBURY_GENLAYER_RPC?.trim() || "https://rpc.bradbury.genlayer.com",
  sendRpc: "https://rpc.testnet-chain.genlayer.com",
  chainRpc: "https://rpc.testnet-chain.genlayer.com",
  chainExplorer: "https://scan.testnet-chain.genlayer.com",
  contracts: {
    addressManager: "0x0192C6C9482251790965B7136352B26234d81d79",
    consensusMain: "0x0f4F0e05475723790E4a2ed0598370783C300926",
    consensusData: "0x2247b85b7ca7fb1Fea990b4aFAB4328D9c597f28",
    staking: "0xcE16862EAf10B97A0619BeBb662991fb4a52e346",
    stakingData: "0x93C23BB63772868D536e7f4A46f8D947E0b9538C",
    feeManager: "0x8E8B6194020dB1CbEf9C6c9dcFeE8FfF1e5E33c3",
    roundsStorage: "0xa6bdB728B82c23786D6e3CAfc0B97235490A64Fb",
    appeals: "0x10F2d70ABB8F588f96bEB1a02c99163EB75A2CF1",
    validatorWalletFactory: "0xfE7bA48e90FeA19C955c18bBDE8BdC0810C2e6ed",
  },
};

/** The Bradbury deployment this app talks to. */
export const BRADBURY: Deployment = BRADBURY_PHASE_3;

function withAddress<T extends { address: Address } | null>(c: T, address: Address): T {
  if (c === null) throw new Error("genlayer-js chain is missing a contract this override expects");
  return { ...c, address };
}

/** The genlayer-js chain for a deployment: the SDK's ABIs with this deployment's addresses. */
function chainFor(d: Deployment): GenLayerChain {
  return {
    ...testnetBradbury,
    id: d.chainId,
    name: d.name,
    rpcUrls: { default: { http: [d.genlayerRpc] } },
    blockExplorers: { default: { name: "GenLayer Chain Explorer", url: d.chainExplorer } },
    consensusMainContract: withAddress(testnetBradbury.consensusMainContract, d.contracts.consensusMain),
    consensusDataContract: withAddress(testnetBradbury.consensusDataContract, d.contracts.consensusData),
    stakingContract: withAddress(testnetBradbury.stakingContract, d.contracts.staking),
    feeManagerContract: withAddress(testnetBradbury.feeManagerContract, d.contracts.feeManager),
    roundsStorageContract: withAddress(testnetBradbury.roundsStorageContract, d.contracts.roundsStorage),
    appealsContract: withAddress(testnetBradbury.appealsContract, d.contracts.appeals),
  };
}

export const bradburyChain: GenLayerChain = chainFor(BRADBURY);

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
    chain: bradburyChain,
    poolRpc: BRADBURY.chainRpc,
    explorerUrl: BRADBURY.chainExplorer,
  },
};

/** Local Studio, for development only. */
export const LOCALNET = localnet;

/** Uptime pool contract address per network, from env (not deployed yet). */
export function poolAddress(network: NetworkKey): Address | undefined {
  if (network !== "bradbury") return undefined;
  // Server-side, UPTIME_POOL_V2_BRADBURY (v2) wins; the browser learns it from /api/presets.
  const v = process.env.UPTIME_POOL_V2_BRADBURY || process.env.UPTIME_POOL_BRADBURY || process.env.NEXT_PUBLIC_UPTIME_POOL_BRADBURY;
  return v && v !== "undefined" ? (v.trim() as Address) : undefined;
}
