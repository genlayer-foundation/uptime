import { Redis } from "@upstash/redis";

export interface CachedCheck {
  timestamp: number;
  is_up: boolean;
  extra_data: string;
  txHash?: string;
}

export interface CachedStatus {
  services: Record<
    string,
    {
      latest: CachedCheck | null;
      uptime_24h: number; // basis points
      uptime_7d: number;
      uptime_30d: number;
      total_checks: number;
    }
  >;
  last_sync: number;
}

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

export async function getLastSyncedIndex(
  serviceId: string
): Promise<number> {
  const redis = getRedis();
  const val = await redis.get<number>(`last_synced_index:${serviceId}`);
  return val ?? 0;
}

export async function setLastSyncedIndex(
  serviceId: string,
  index: number
): Promise<void> {
  const redis = getRedis();
  await redis.set(`last_synced_index:${serviceId}`, index);
}

export async function appendChecks(
  serviceId: string,
  checks: CachedCheck[]
): Promise<void> {
  if (checks.length === 0) return;
  const redis = getRedis();
  const key = `checks:${serviceId}`;
  for (const check of checks) {
    await redis.rpush(key, JSON.stringify(check));
  }
}

export async function getChecks(
  serviceId: string,
  offset: number,
  limit: number
): Promise<CachedCheck[]> {
  const redis = getRedis();
  const key = `checks:${serviceId}`;
  const items = await redis.lrange<string>(key, offset, offset + limit - 1);
  return items.map((item) =>
    typeof item === "string" ? JSON.parse(item) : (item as unknown as CachedCheck)
  );
}

export async function getCheckCount(serviceId: string): Promise<number> {
  const redis = getRedis();
  const key = `checks:${serviceId}`;
  return await redis.llen(key);
}

export async function getCachedStatus(): Promise<CachedStatus | null> {
  const redis = getRedis();
  return await redis.get<CachedStatus>("cached_status");
}

export async function setCachedStatus(status: CachedStatus): Promise<void> {
  const redis = getRedis();
  await redis.set("cached_status", JSON.stringify(status));
}

export async function storeTxHash(
  networkId: string,
  timestamp: number,
  txHash: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(`tx:${networkId}:${timestamp}`, txHash, { ex: 60 * 60 * 24 * 90 });
}

export async function getTxHash(
  networkId: string,
  timestamp: number
): Promise<string | null> {
  const redis = getRedis();
  return await redis.get<string>(`tx:${networkId}:${timestamp}`);
}

export async function getLatestTxHash(
  networkId: string
): Promise<{ txHash: string; timestamp: number } | null> {
  const redis = getRedis();
  const val = await redis.get<string>(`latest_tx:${networkId}`);
  if (!val) return null;
  const parsed = JSON.parse(val);
  return parsed;
}

export async function setLatestTxHash(
  networkId: string,
  txHash: string,
  timestamp: number
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    `latest_tx:${networkId}`,
    JSON.stringify({ txHash, timestamp })
  );
}
