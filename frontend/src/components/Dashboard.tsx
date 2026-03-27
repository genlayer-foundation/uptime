"use client";

import { useStatus } from "@/lib/hooks/useStatus";
import { SERVICES } from "@/lib/utils/services";
import { StatusCard } from "./StatusCard";
import { OverallStatus } from "./OverallStatus";

export function Dashboard() {
  const { data: status, isLoading, dataUpdatedAt } = useStatus();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-lg bg-zinc-900" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg bg-zinc-900"
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
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
          Services
        </h2>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-muted">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
