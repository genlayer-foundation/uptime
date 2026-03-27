"use client";

import { Activity, Globe, Server } from "lucide-react";
import Link from "next/link";
import { getServiceById } from "@/lib/utils/services";
import { formatUptime, timeAgo, uptimeColor, statusColor } from "@/lib/utils/format";

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

function CategoryIcon({ category }: { category: string }) {
  switch (category) {
    case "rpc":
      return <Server className="h-4 w-4" />;
    case "explorer":
      return <Globe className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

export function StatusCard({ serviceId, status }: StatusCardProps) {
  const service = getServiceById(serviceId);
  if (!service) return null;

  const isUp = status.latest?.is_up ?? false;
  const hasData = status.latest !== null;

  return (
    <Link
      href={`/service/${serviceId}`}
      className="block rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition-all hover:border-purple-500/30 hover:bg-white/[0.07]"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${hasData ? statusColor(isUp) : "bg-gray-500"} ${isUp ? "shadow-[0_0_8px_rgba(16,185,129,0.6)]" : ""}`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">{service.name}</h3>
              <span className="text-xs text-gray-500">
                <CategoryIcon category={service.category} />
              </span>
            </div>
            <p className="text-xs text-gray-500">{service.description}</p>
          </div>
        </div>
        {hasData && (
          <span className="text-xs text-gray-500">
            {timeAgo(status.latest!.timestamp)}
          </span>
        )}
      </div>

      {hasData ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              24h
            </p>
            <p className={`text-sm font-mono font-semibold ${uptimeColor(status.uptime_24h)}`}>
              {formatUptime(status.uptime_24h)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              7d
            </p>
            <p className={`text-sm font-mono font-semibold ${uptimeColor(status.uptime_7d)}`}>
              {formatUptime(status.uptime_7d)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              30d
            </p>
            <p className={`text-sm font-mono font-semibold ${uptimeColor(status.uptime_30d)}`}>
              {formatUptime(status.uptime_30d)}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-sm text-gray-500">No data yet</div>
      )}

      {hasData && (
        <div className="mt-3 flex items-center justify-between text-[10px] text-gray-600">
          <span>{status.total_checks} total checks</span>
          {!isUp && status.latest?.extra_data && (
            <span className="text-red-400 truncate ml-2 max-w-[60%]">
              {status.latest.extra_data}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
