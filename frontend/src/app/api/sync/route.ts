import { NextResponse } from "next/server";
import { getReadClient, NETWORKS, type NetworkId } from "@/lib/genlayer/client";
import {
  getLastSyncedIndex,
  setLastSyncedIndex,
  appendChecks,
  setCachedStatus,
  type CachedCheck,
  type CachedStatus,
} from "@/lib/cache/kv";
import { SERVICES } from "@/lib/utils/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Checks per hour for uptime windows
const CHECKS_24H = 24;
const CHECKS_7D = 168;
const CHECKS_30D = 720;

export async function GET() {
  const networkId = (process.env.DEPLOY_NETWORK || "studionet") as NetworkId;
  const network = NETWORKS[networkId];

  if (!network?.contractAddress) {
    return NextResponse.json(
      { error: `No contract address for ${networkId}` },
      { status: 500 }
    );
  }

  const client = getReadClient(networkId);
  const contractAddress = network.contractAddress;

  const status: CachedStatus = {
    services: {},
    last_sync: Math.floor(Date.now() / 1000),
  };

  for (const service of SERVICES) {
    try {
      // Get on-chain count
      const onChainCount = await client.readContract({
        address: contractAddress,
        functionName: "get_check_count",
        args: [service.id],
      });
      const total = Number(onChainCount);

      // Get last synced index
      const lastSynced = await getLastSyncedIndex(service.id);

      // Fetch new checks if any
      if (total > lastSynced) {
        const newChecks = (await client.readContract({
          address: contractAddress,
          functionName: "get_checks",
          args: [service.id, lastSynced, total - lastSynced],
        })) as Array<Record<string, unknown>>;

        const checks: CachedCheck[] = (newChecks || []).map(
          (c: Record<string, unknown>) => ({
            timestamp: Number(c.timestamp),
            is_up: Boolean(c.is_up),
            extra_data: String(c.extra_data ?? ""),
          })
        );

        await appendChecks(service.id, checks);
        await setLastSyncedIndex(service.id, total);
      }

      // Get uptime stats from contract
      const [stats24h, stats7d, stats30d] = await Promise.all([
        client.readContract({
          address: contractAddress,
          functionName: "get_uptime_stats",
          args: [service.id, CHECKS_24H],
        }) as Promise<Record<string, unknown>>,
        client.readContract({
          address: contractAddress,
          functionName: "get_uptime_stats",
          args: [service.id, CHECKS_7D],
        }) as Promise<Record<string, unknown>>,
        client.readContract({
          address: contractAddress,
          functionName: "get_uptime_stats",
          args: [service.id, CHECKS_30D],
        }) as Promise<Record<string, unknown>>,
      ]);

      // Get latest check
      const latest = (await client.readContract({
        address: contractAddress,
        functionName: "get_latest_check",
        args: [service.id],
      })) as Record<string, unknown>;

      status.services[service.id] = {
        latest:
          latest && latest.timestamp
            ? {
                timestamp: Number(latest.timestamp),
                is_up: Boolean(latest.is_up),
                extra_data: String(latest.extra_data ?? ""),
              }
            : null,
        uptime_24h: Number(stats24h?.uptime_pct ?? 0),
        uptime_7d: Number(stats7d?.uptime_pct ?? 0),
        uptime_30d: Number(stats30d?.uptime_pct ?? 0),
        total_checks: total,
      };
    } catch (error) {
      console.error(`Sync error for ${service.id}:`, error);
      status.services[service.id] = {
        latest: null,
        uptime_24h: 0,
        uptime_7d: 0,
        uptime_30d: 0,
        total_checks: 0,
      };
    }
  }

  await setCachedStatus(status);

  return NextResponse.json({ synced: true, timestamp: status.last_sync });
}
