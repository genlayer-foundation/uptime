"use client";

import Link from "next/link";
import { getServiceById } from "@/lib/utils/services";
import { formatUptime, timeAgo, uptimeColor } from "@/lib/utils/format";

interface ServiceStatus {
  latest: { timestamp: number; is_up: boolean; extra_data: string } | null;
  uptime_24h: number;
  uptime_7d: number;
  uptime_30d: number;
  total_checks: number;
}

interface StatusCardProps {
  serviceId: string;
  status: ServiceStatus;
}

export function StatusCard({ serviceId, status }: StatusCardProps) {
  const service = getServiceById(serviceId);
  if (!service) return null;

  const isUp = status.latest?.is_up ?? false;
  const hasData = status.latest !== null;

  return (
    <Link
      href={`/service/${serviceId}`}
      className="block rounded-lg border border-border p-5 transition-colors hover:border-zinc-300 hover:bg-surface"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`h-2 w-2 rounded-full ${hasData ? (isUp ? "bg-emerald-500" : "bg-red-500") : "bg-zinc-300"}`}
          />
          <div>
            <h3 className="text-sm font-medium text-foreground">{service.name}</h3>
            <p className="text-xs text-muted">{service.description}</p>
          </div>
        </div>
        {hasData && (
          <span className="text-xs text-muted">
            {timeAgo(status.latest!.timestamp)}
          </span>
        )}
      </div>

      {hasData ? (
        <div className="mt-4 flex items-baseline gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">24h</p>
            <p className={`font-mono text-sm ${uptimeColor(status.uptime_24h)}`}>
              {formatUptime(status.uptime_24h)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">7d</p>
            <p className={`font-mono text-sm ${uptimeColor(status.uptime_7d)}`}>
              {formatUptime(status.uptime_7d)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">30d</p>
            <p className={`font-mono text-sm ${uptimeColor(status.uptime_30d)}`}>
              {formatUptime(status.uptime_30d)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">No data yet</p>
      )}

      {hasData && !isUp && status.latest?.extra_data && (
        <p className="mt-3 truncate text-xs text-red-500">
          {status.latest.extra_data}
        </p>
      )}
    </Link>
  );
}
