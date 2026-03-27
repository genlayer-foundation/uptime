"use client";

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

  const avgUptime =
    total > 0
      ? Math.round(entries.reduce((sum, s) => sum + s.uptime_30d, 0) / total)
      : 0;

  const SLA_TARGET = 9950;
  const slaCompliant = avgUptime >= SLA_TARGET;

  if (!hasData) {
    return (
      <div className="border-b border-border/60 pb-6">
        <p className="text-sm text-muted">Waiting for first check...</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-6">
      <div className="flex items-center gap-3">
        <div
          className={`h-2.5 w-2.5 rounded-full ${allUp ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <div>
          <p className="text-sm font-medium text-foreground">
            {allUp
              ? "All Systems Operational"
              : `${total - up} Service${total - up > 1 ? "s" : ""} Down`}
          </p>
          <p className="text-xs text-muted">
            {up}/{total} services online
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-right">
        <div>
          <p className="font-mono text-sm text-foreground">
            {(avgUptime / 100).toFixed(2)}%
          </p>
          <p className="text-xs text-muted">30d avg</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${
            slaCompliant
              ? "border-emerald-500/30 text-emerald-400"
              : "border-red-500/30 text-red-400"
          }`}
        >
          {slaCompliant ? "SLA Met" : "Below SLA"}
        </span>
      </div>
    </div>
  );
}
