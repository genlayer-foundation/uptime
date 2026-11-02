"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "@/components/ui";
import type { HeartbeatData } from "./types";
import { accuracy, dayLabel, duration, hourLabel, pct } from "./format";

interface Row {
  t: number;
  accuracy: number | null;
  agreement: number | null;
  p50: number | null;
}

// One point per hour across the whole window, so missing ticks show as gaps
// rather than being silently bridged.
function rows(d: HeartbeatData): Row[] {
  const byT = new Map(d.series.map((p) => [p.t, p]));
  const end = Math.floor(d.generatedAt / 3600) * 3600;
  const start = end - (d.hours - 1) * 3600;
  const out: Row[] = [];
  for (let t = start; t <= end; t += 3600) {
    const llm = byT.get(t)?.llm;
    out.push({
      t,
      accuracy: accuracy(llm) ?? null,
      agreement: llm?.agreement ?? null,
      p50: llm?.latencyP50 ?? null,
    });
  }
  return out;
}

interface TipEntry {
  dataKey?: unknown;
  value?: unknown;
  color?: string;
  name?: unknown;
}

function Tip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: readonly TipEntry[];
  label?: unknown;
  fmt: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="flex min-w-40 flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground shadow-sm">
      <span className="text-muted">{hourLabel(Number(label), true)}</span>
      {payload.map((p) => (
        <span className="flex items-center gap-2" key={String(p.dataKey)}>
          <Swatch color={p.color} />
          {String(p.name)}
          <span className="ml-auto font-mono">{typeof p.value === "number" ? fmt(p.value) : "no data"}</span>
        </span>
      ))}
    </div>
  );
}

function Swatch({ color }: { color?: string }) {
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const AXIS = { tickLine: false, axisLine: false } as const;
const LINE = { type: "linear", strokeWidth: 2, connectNulls: false, isAnimationActive: false } as const;

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-border-strong p-6 text-center text-xs text-muted">
      {text}
    </div>
  );
}

export function TrendCharts({ data }: { data: HeartbeatData | null }) {
  const hasData = !!data && data.series.some((p) => p.llm.total > 0);
  const r = hasData ? rows(data) : [];
  const short = (data?.hours ?? 24) <= 24;
  const tickFmt = (t: number) => (short ? hourLabel(t, false) : dayLabel(t));
  const dot = short ? { r: 3, strokeWidth: 0 } : false;
  const emptyText = "No LLM probes resolved in this window yet. Points appear once the first hourly tick is reconciled.";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Accuracy and agreement"
          subtitle="LLM probes, per hour"
          actions={
            <Legend
              items={[
                { label: "Accuracy", color: "var(--series-1)" },
                { label: "Agreement", color: "var(--series-2)" },
              ]}
            />
          }
        />
        <CardBody>
          {hasData ? (
            <div className="chart h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => pct(v)} width={48} />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)" }}
                    content={(p) => <Tip {...p} fmt={(v) => pct(v, 1)} />}
                  />
                  <Line {...LINE} dataKey="accuracy" name="Accuracy" stroke="var(--series-1)" dot={dot ? { ...dot, fill: "var(--series-1)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
                  <Line {...LINE} dataKey="agreement" name="Agreement" stroke="var(--series-2)" dot={dot ? { ...dot, fill: "var(--series-2)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={emptyText} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Time to decision, p50" subtitle="LLM probes, submit to last vote, per hour" />
        <CardBody>
          {hasData ? (
            <div className="chart h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} tickFormatter={(v: number) => duration(v)} width={68} domain={[0, "auto"]} />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)" }}
                    content={(p) => <Tip {...p} fmt={duration} />}
                  />
                  <Line {...LINE} dataKey="p50" name="p50" stroke="var(--series-1)" dot={dot ? { ...dot, fill: "var(--series-1)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={emptyText} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
