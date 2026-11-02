import { createClient, createAccount } from "genlayer-js";
import { bradburyPhase2 } from "../chains";

// The Bradbury Heartbeat example job runs on Bradbury only, through the
// explicit Phase 2 chain config (lib/chains.ts): genlayer-js's own
// testnetBradbury still carries the sunset Phase 1 consensus addresses.
export const NETWORK = {
  name: "Bradbury",
  chain: bradburyPhase2,
  explorerUrl: "https://explorer-bradbury.genlayer.com",
};

export function getContractAddress(): `0x${string}` | undefined {
  const val =
    process.env.HEARTBEAT_CONTRACT ||
    process.env.NEXT_PUBLIC_HEARTBEAT_CONTRACT;
  if (!val || val === "undefined") return undefined;
  return val.trim() as `0x${string}`;
}

export function getReadClient() {
  return createClient({ chain: NETWORK.chain });
}

export function getWriteClient() {
  const privateKey = process.env.PRIVATE_KEY?.trim() as
    | `0x${string}`
    | undefined;
  if (!privateKey) throw new Error("PRIVATE_KEY not configured");
  const account = createAccount(privateKey);
  return createClient({ chain: NETWORK.chain, account });
}

export function txExplorerLink(txHash: string): string {
  return `${NETWORK.explorerUrl}/tx/${txHash}`;
}
