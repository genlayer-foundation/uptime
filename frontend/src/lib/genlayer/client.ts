import { createClient, createAccount } from "genlayer-js";
import {
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";

function getContractAddress(key: string): `0x${string}` | undefined {
  const val =
    process.env[key] || process.env[`NEXT_PUBLIC_${key}`];
  if (!val || val === "undefined") return undefined;
  return val.trim() as `0x${string}`;
}

export const NETWORKS = {
  studionet: {
    name: "Studionet",
    chain: studionet,
    get contractAddress() {
      return getContractAddress("CONTRACT_STUDIONET");
    },
  },
  asimov: {
    name: "Asimov",
    chain: testnetAsimov,
    get contractAddress() {
      return getContractAddress("CONTRACT_ASIMOV");
    },
  },
  bradbury: {
    name: "Bradbury",
    chain: testnetBradbury,
    get contractAddress() {
      return getContractAddress("CONTRACT_BRADBURY");
    },
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export function getReadClient(networkId: NetworkId) {
  const network = NETWORKS[networkId];
  return createClient({ chain: network.chain });
}

export function getWriteClient(networkId: NetworkId) {
  const network = NETWORKS[networkId];
  const privateKey = process.env.PRIVATE_KEY?.trim() as
    | `0x${string}`
    | undefined;
  if (!privateKey) throw new Error("PRIVATE_KEY not configured");
  const account = createAccount(privateKey);
  return createClient({ chain: network.chain, account });
}
