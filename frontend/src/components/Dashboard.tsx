"use client";

import { useStatus } from "@/lib/hooks/useStatus";
import { SERVICES } from "@/lib/utils/services";
import { StatusCard } from "./StatusCard";
import { OverallStatus } from "./OverallStatus";
import { UptimeChart } from "./UptimeChart";
import { RefreshCw } from "lucide-react";

export function Dashboard() {
  const { data: status, isLoading, dataUpdatedAt } = useStatus();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl bg-white/5"
            />
          ))}
        </div>
      </div>
    );
  }

  const services = status?.services ?? {};

  return (
    <div className="space-y-6">
      <OverallStatus services={services} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-400">Service Status</h2>
        {dataUpdatedAt > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-gray-600">
            <RefreshCw className="h-3 w-3" />
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((service) => (
          <StatusCard
            key={service.id}
            serviceId={service.id}
            status={
              services[service.id] ?? {
                latest: null,
                uptime_24h: 0,
                uptime_7d: 0,
                uptime_30d: 0,
                total_checks: 0,
              }
            }
          />
        ))}
      </div>

      <div>
        <h2 className="mb-4 text-sm font-medium text-gray-400">
          Uptime History
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SERVICES.map((service) => (
            <div
              key={service.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <UptimeChart serviceId={service.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
