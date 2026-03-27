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
      <div className="h-32 animate-pulse rounded-lg bg-surface" />
    );
  }

  if (!checks || checks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted">
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
      <h4 className="mb-3 text-xs text-muted">
        {service?.name ?? serviceId} · Last {checks.length} checks
      </h4>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`gradient-${serviceId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9B6AF6" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#9B6AF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis domain={[0, 1]} hide />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: "6px",
              fontSize: "12px",
              color: "#71717a",
            }}
            formatter={(value) => [Number(value) === 1 ? "Up" : "Down", "Status"]}
          />
          <Area
            type="stepAfter"
            dataKey="up"
            stroke="#9B6AF6"
            fill={`url(#gradient-${serviceId})`}
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
