"use client";

import { useQuery } from "@tanstack/react-query";
import type { CachedStatus } from "@/lib/cache/kv";

async function fetchStatus(): Promise<CachedStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export function useStatus() {
  return useQuery<CachedStatus>({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval: 60_000,
  });
}
