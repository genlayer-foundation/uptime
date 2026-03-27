import { createClient, createAccount } from "genlayer-js";
import {
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";

export const NETWORKS = {
  studionet: {
    name: "Studionet",
    chain: studionet,
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_STUDIONET as `0x${string}`,
  },
  asimov: {
    name: "Asimov",
    chain: testnetAsimov,
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ASIMOV as `0x${string}`,
  },
  bradbury: {
    name: "Bradbury",
    chain: testnetBradbury,
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_BRADBURY as `0x${string}`,
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export function getReadClient(networkId: NetworkId) {
  const network = NETWORKS[networkId];
  return createClient({ chain: network.chain });
}

export function getWriteClient(networkId: NetworkId) {
  const network = NETWORKS[networkId];
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) throw new Error("PRIVATE_KEY not configured");
  const account = createAccount(privateKey);
  return createClient({ chain: network.chain, account });
}
