export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  category: "rpc" | "explorer" | "bridge";
  url: string;
}

export const SERVICES: ServiceInfo[] = [
  {
    id: "zksync_bridge",
    name: "ZKSync Bridge",
    description: "Cross-chain bridge to ZKSync settlement layer",
    category: "bridge",
    url: "https://zksync-os-testnet-genlayer.zksync.dev",
  },
  {
    id: "studionet_rpc",
    name: "Studionet Node",
    description: "Development network RPC endpoint",
    category: "rpc",
    url: "https://studio.genlayer.com/api",
  },
  {
    id: "asimov_rpc",
    name: "Asimov Testnet",
    description: "Asimov testnet RPC endpoint",
    category: "rpc",
    url: "https://rpc-asimov.genlayer.com",
  },
  {
    id: "bradbury_rpc",
    name: "Bradbury Testnet",
    description: "Bradbury testnet RPC endpoint",
    category: "rpc",
    url: "https://rpc-bradbury.genlayer.com",
  },
  {
    id: "explorer_studio",
    name: "Studionet Explorer",
    description: "Block explorer for dev network",
    category: "explorer",
    url: "https://explorer-studio.genlayer.com",
  },
  {
    id: "explorer_asimov",
    name: "Asimov Explorer",
    description: "Block explorer for Asimov testnet",
    category: "explorer",
    url: "https://explorer-asimov.genlayer.com",
  },
  {
    id: "explorer_bradbury",
    name: "Bradbury Explorer",
    description: "Block explorer for Bradbury testnet",
    category: "explorer",
    url: "https://explorer-bradbury.genlayer.com",
  },
];

export function getServiceById(id: string): ServiceInfo | undefined {
  return SERVICES.find((s) => s.id === id);
}
