import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

// The heartbeat runs on Bradbury only.
export const NETWORK = {
  name: "Bradbury",
  chain: testnetBradbury,
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
