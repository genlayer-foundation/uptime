export interface ContractDeployment {
  networkId: string;
  networkName: string;
  address: string;
  explorerUrl: string;
  rpcUrl: string;
}

export const CONTRACT_DEPLOYMENTS: ContractDeployment[] = [
  {
    networkId: "studionet",
    networkName: "Studionet",
    address: "0x1AE5Eb9a7A1ece2E873689e0ED33b818dd2f2573",
    explorerUrl: "https://explorer-studio.genlayer.com",
    rpcUrl: "https://studio.genlayer.com/api",
  },
  {
    networkId: "bradbury",
    networkName: "Bradbury Testnet",
    address: "0xb511D5eb502770739da07046bA2e75479C516Eac",
    explorerUrl: "https://explorer-bradbury.genlayer.com",
    rpcUrl: "https://rpc-bradbury.genlayer.com",
  },
];

export function getContractExplorerLink(deployment: ContractDeployment): string {
  return `${deployment.explorerUrl}/address/${deployment.address}`;
}

export function getTxExplorerLink(
  networkId: string,
  txHash: string
): string {
  const deployment = CONTRACT_DEPLOYMENTS.find(
    (d) => d.networkId === networkId
  );
  if (!deployment) return "#";
  return `${deployment.explorerUrl}/tx/${txHash}`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
