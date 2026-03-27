export interface ServiceInfo {
  id: string;
  name: string;
  category: "rpc" | "explorer" | "bridge";
  url: string;
}

export const SERVICES: ServiceInfo[] = [
  {
    id: "zksync_bridge",
    name: "ZKSync Bridge",
    category: "bridge",
    url: "https://zksync-os-testnet-genlayer.zksync.dev",
  },
  {
    id: "studionet_rpc",
    name: "Studionet RPC",
    category: "rpc",
    url: "https://studio.genlayer.com/api",
  },
  {
    id: "asimov_rpc",
    name: "Asimov RPC",
    category: "rpc",
    url: "https://rpc-asimov.genlayer.com",
  },
  {
    id: "bradbury_rpc",
    name: "Bradbury RPC",
    category: "rpc",
    url: "https://rpc-bradbury.genlayer.com",
  },
  {
    id: "explorer_studio",
    name: "Studionet Explorer",
    category: "explorer",
    url: "https://explorer-studio.genlayer.com",
  },
  {
    id: "explorer_asimov",
    name: "Asimov Explorer",
    category: "explorer",
    url: "https://explorer-asimov.genlayer.com",
  },
  {
    id: "explorer_bradbury",
    name: "Bradbury Explorer",
    category: "explorer",
    url: "https://explorer-bradbury.genlayer.com",
  },
];

export function getServiceById(id: string): ServiceInfo | undefined {
  return SERVICES.find((s) => s.id === id);
}
