"use client";

import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";

interface OverallStatusProps {
  services: Record<
    string,
    {
      latest: { is_up: boolean } | null;
      uptime_30d: number;
    }
  >;
}

export function OverallStatus({ services }: OverallStatusProps) {
  const entries = Object.values(services);
  const total = entries.length;
  const up = entries.filter((s) => s.latest?.is_up).length;
  const allUp = up === total && total > 0;
  const hasData = total > 0 && entries.some((s) => s.latest !== null);

  // Average 30d uptime
  const avgUptime =
    total > 0
      ? Math.round(entries.reduce((sum, s) => sum + s.uptime_30d, 0) / total)
      : 0;

  const SLA_TARGET = 9950; // 99.50%
  const slaCompliant = avgUptime >= SLA_TARGET;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
        <Shield className="mx-auto h-8 w-8 text-gray-500" />
        <p className="mt-2 text-gray-400">Waiting for first check...</p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-6 ${
        allUp
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/30 bg-red-500/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {allUp ? (
            <ShieldCheck className="h-8 w-8 text-emerald-400" />
          ) : (
            <ShieldAlert className="h-8 w-8 text-red-400" />
          )}
          <div>
            <h2 className="text-lg font-semibold text-white">
              {allUp ? "All Systems Operational" : `${total - up} Service${total - up > 1 ? "s" : ""} Down`}
            </h2>
            <p className="text-sm text-gray-400">
              {up}/{total} services online
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">SLA Target: 99.50%</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                slaCompliant
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {slaCompliant ? "Compliant" : "Below Target"}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-gray-300">
            Avg: {(avgUptime / 100).toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  );
}
