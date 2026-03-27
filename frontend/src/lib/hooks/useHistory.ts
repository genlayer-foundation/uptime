"use client";

import { useQuery } from "@tanstack/react-query";
import type { CachedCheck } from "@/lib/cache/kv";

async function fetchHistory(
  serviceId: string,
  limit: number
): Promise<CachedCheck[]> {
  const res = await fetch(
    `/api/status?service=${serviceId}&history=true&limit=${limit}`
  );
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export function useHistory(serviceId: string, limit = 168) {
  return useQuery<CachedCheck[]>({
    queryKey: ["history", serviceId, limit],
    queryFn: () => fetchHistory(serviceId, limit),
    refetchInterval: 60_000,
  });
}
