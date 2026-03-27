"use client";

import { useQuery } from "@tanstack/react-query";

export interface ZksyncSyncData {
  rpcBlock: number;
  blockTimestamp: number;
  currentTime: number;
  secondsBehind: number;
  error?: string;
}

async function fetchZksyncSync(): Promise<ZksyncSyncData> {
  const res = await fetch("/api/zksync-sync");
  if (!res.ok) throw new Error("Failed to fetch ZKSync sync data");
  return res.json();
}

export function useZksyncSync(enabled: boolean) {
  return useQuery<ZksyncSyncData>({
    queryKey: ["zksync-sync"],
    queryFn: fetchZksyncSync,
    enabled,
    refetchInterval: 60_000,
  });
}
