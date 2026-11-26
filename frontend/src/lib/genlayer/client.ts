import { createClient, createAccount } from "genlayer-js";
import { BRADBURY, bradburyChain } from "../chains";
import { signingKey } from "../signer";
import { withFees } from "./fees";
import { routeDeploymentSends } from "./sendRoute";

// The Bradbury Heartbeat example job runs on Bradbury only, through the
// explicit chain config (lib/chains.ts): the pinned genlayer-js's own
// testnetBradbury carries an older deployment's consensus addresses.
export const NETWORK = {
  name: "Bradbury",
  chain: bradburyChain,
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
  // Same signer as the Bradbury job executor: the scheduler wallet
  // (RELAYER_KEY_BRADBURY), which must be the Heartbeat contract's operator.
  const privateKey = signingKey("bradbury");
  if (!privateKey) throw new Error("RELAYER_KEY_BRADBURY not configured");
  const account = createAccount(privateKey);
  // The node RPC may refuse signed txs: they go to the deployment's sendRpc (sendRoute.ts).
  routeDeploymentSends(BRADBURY);
  // Every deploy/write carries the fee deposit (lib/genlayer/fees.ts).
  return withFees(createClient({ chain: NETWORK.chain, account }), "bradbury");
}

export function txExplorerLink(txHash: string): string {
  return `${NETWORK.explorerUrl}/tx/${txHash}`;
}
