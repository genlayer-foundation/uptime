import { NextResponse } from "next/server";
import { getReadClient, NETWORKS, type NetworkId } from "@/lib/genlayer/client";
import { SERVICES } from "@/lib/utils/services";
import { getCachedStatus, setCachedStatus } from "@/lib/cache/kv";

export const dynamic = "force-dynamic";

const CHECKS_24H = 24;
const CHECKS_7D = 168;
const CHECKS_30D = 720;

const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const MEMORY_CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

let memoryCache: { data: unknown; timestamp: number } | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryKvCache(): Promise<ReturnType<typeof getCachedStatus>> {
  try {
    const cached = await getCachedStatus();
    if (cached && cached.last_sync) {
      const age = Math.floor(Date.now() / 1000) - cached.last_sync;
      if (age < CACHE_TTL_SECONDS) {
        return cached;
      }
    }
  } catch {
    // KV not configured or unavailable — fall through to contract
  }
  return null;
}

async function fetchFromContract() {
  const networkId = (process.env.DEPLOY_NETWORK || "studionet") as NetworkId;
  const network = NETWORKS[networkId];

  if (!network?.contractAddress) {
    return { services: {}, last_sync: 0 };
  }

  const client = getReadClient(networkId);
  const addr = network.contractAddress;

  // First batch: get_all_latest (1 call) + all check counts (7 calls) = 8 calls
  const allLatest = (await client.readContract({
    address: addr,
    functionName: "get_all_latest",
    args: [],
  })) as Record<string, Record<string, unknown>>;

  const services: Record<string, unknown> = {};

  // Second batch: uptime stats — 3 calls per service, but stagger to avoid rate limits
  for (let i = 0; i < SERVICES.length; i++) {
    const service = SERVICES[i];
    try {
      // 3 calls per service, sequential to stay under rate limit
      const stats24h = (await client.readContract({
        address: addr,
        functionName: "get_uptime_stats",
        args: [service.id, CHECKS_24H],
      })) as Record<string, unknown>;

      const stats7d = (await client.readContract({
        address: addr,
        functionName: "get_uptime_stats",
        args: [service.id, CHECKS_7D],
      })) as Record<string, unknown>;

      const stats30d = (await client.readContract({
        address: addr,
        functionName: "get_uptime_stats",
        args: [service.id, CHECKS_30D],
      })) as Record<string, unknown>;

      const latest = allLatest[service.id];

      services[service.id] = {
        latest: latest
          ? {
              timestamp: Number(latest.timestamp),
              is_up: Boolean(latest.is_up),
              extra_data: String(latest.extra_data ?? ""),
            }
          : null,
        uptime_24h: Number(stats24h?.uptime_pct ?? 0),
        uptime_7d: Number(stats7d?.uptime_pct ?? 0),
        uptime_30d: Number(stats30d?.uptime_pct ?? 0),
        total_checks: Number(stats30d?.total ?? 0),
      };
    } catch (error) {
      console.error(`Error fetching ${service.id}:`, error);
      services[service.id] = {
        latest: null,
        uptime_24h: 0,
        uptime_7d: 0,
        uptime_30d: 0,
        total_checks: 0,
      };
    }

    // Rate limit: 20 calls per 10s. We do ~3 calls per iteration.
    // After every 6th call (2 services), pause 1s.
    if ((i + 1) % 2 === 0) {
      await delay(1000);
    }
  }

  const status = {
    services: services as Record<
      string,
      {
        latest: { timestamp: number; is_up: boolean; extra_data: string } | null;
        uptime_24h: number;
        uptime_7d: number;
        uptime_30d: number;
        total_checks: number;
      }
    >,
    last_sync: Math.floor(Date.now() / 1000),
  };

  // Warm KV cache
  try {
    await setCachedStatus(status);
  } catch {
    // KV not configured — ignore
  }

  return status;
}

async function fetchHistory(serviceId: string, limit: number) {
  const networkId = (process.env.DEPLOY_NETWORK || "studionet") as NetworkId;
  const network = NETWORKS[networkId];

  if (!network?.contractAddress) return [];

  const client = getReadClient(networkId);
  const count = (await client.readContract({
    address: network.contractAddress,
    functionName: "get_check_count",
    args: [serviceId],
  })) as number;

  const total = Number(count);
  const offset = Math.max(0, total - limit);
  const fetchLimit = Math.min(limit, total);

  if (fetchLimit === 0) return [];

  return (await client.readContract({
    address: network.contractAddress,
    functionName: "get_checks",
    args: [serviceId, offset, fetchLimit],
  })) as Array<Record<string, unknown>>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const serviceId = searchParams.get("service");
  const history = searchParams.get("history");
  const limit = parseInt(searchParams.get("limit") || "168", 10);

  try {
    if (serviceId && history === "true") {
      const checks = await fetchHistory(serviceId, limit);
      return NextResponse.json(checks);
    }

    // Try in-memory cache first (fastest)
    if (memoryCache && Date.now() - memoryCache.timestamp < MEMORY_CACHE_TTL_MS) {
      return NextResponse.json(memoryCache.data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Data-Source": "memory-cache",
        },
      });
    }

    // Try KV cache second
    const cached = await tryKvCache();
    if (cached) {
      memoryCache = { data: cached, timestamp: Date.now() };
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Data-Source": "kv-cache",
        },
      });
    }

    // Fall through to contract reads
    const status = await fetchFromContract();
    memoryCache = { data: status, timestamp: Date.now() };
    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Data-Source": "contract",
      },
    });
  } catch (error) {
    console.error("Status API error:", error);
    return NextResponse.json(
      { services: {}, last_sync: 0 },
      { status: 500 }
    );
  }
}
