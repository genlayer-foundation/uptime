"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useHistory } from "@/lib/hooks/useHistory";
import { getServiceById } from "@/lib/utils/services";

interface UptimeChartProps {
  serviceId: string;
}

export function UptimeChart({ serviceId }: UptimeChartProps) {
  const { data: checks, isLoading } = useHistory(serviceId, 168);
  const service = getServiceById(serviceId);

  if (isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-lg bg-white/5" />
    );
  }

  if (!checks || checks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] text-xs text-gray-600">
        No history
      </div>
    );
  }

  const data = checks.map((c) => ({
    time: new Date(c.timestamp * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    up: c.is_up ? 1 : 0,
  }));

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-gray-400">
        {service?.name ?? serviceId} — Last {checks.length} checks
      </h4>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`gradient-${serviceId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9B6AF6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#9B6AF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#666" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis domain={[0, 1]} hide />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1a2e",
              border: "1px solid rgba(155,106,246,0.3)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value) => [Number(value) === 1 ? "Up" : "Down", "Status"]}
          />
          <Area
            type="stepAfter"
            dataKey="up"
            stroke="#9B6AF6"
            fill={`url(#gradient-${serviceId})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
