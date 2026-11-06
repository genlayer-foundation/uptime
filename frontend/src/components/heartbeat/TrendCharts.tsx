"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "@/components/ui";
import type { HeartbeatData, TestType } from "./types";
import { dayLabel, duration, hourLabel, pct } from "./format";

// The three answer-bearing test types, charted against each other.
const LINES: Array<{ type: TestType; label: string; color: string }> = [
  { type: "llm", label: "AI", color: "var(--series-1)" },
  { type: "web", label: "Web", color: "var(--series-2)" },
  { type: "image", label: "Image", color: "var(--series-3)" },
];

type Row = { t: number } & Record<string, number | null>;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Each type runs only some hours (the rotating pool), so points are bucketed:
// 1 h for a 24 h window, 6 h for 7 d, 1 day for 30 d. Accuracy is summed
// counts over the bucket; latency is the median of the hourly p50s. Empty
// buckets stay gaps rather than being bridged.
function rows(d: HeartbeatData): { rows: Row[]; bucket: number } {
  const bucket = d.hours <= 24 ? 3600 : d.hours <= 168 ? 6 * 3600 : 24 * 3600;
  const end = Math.floor(d.generatedAt / bucket) * bucket;
  const start = Math.floor((d.generatedAt - d.hours * 3600) / bucket) * bucket + bucket;
  const out: Row[] = [];
  for (let t = start; t <= end; t += bucket) {
    const pts = d.series.filter((p) => p.t >= t && p.t < t + bucket);
    const row: Row = { t };
    for (const { type } of LINES) {
      let correct = 0;
      let graded = 0;
      const p50s: number[] = [];
      for (const p of pts) {
        correct += p[type].correct;
        graded += p[type].graded;
        if (p[type].latencyP50 !== undefined) p50s.push(p[type].latencyP50!);
      }
      row[`${type}Acc`] = graded > 0 ? correct / graded : null;
      row[`${type}P50`] = median(p50s);
    }
    out.push(row);
  }
  return { rows: out, bucket };
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
  const hasData = !!data && data.series.some((p) => LINES.some((l) => p[l.type].total > 0));
  const { rows: r, bucket } = hasData ? rows(data) : { rows: [], bucket: 3600 };
  const short = bucket < 24 * 3600;
  const tickFmt = (t: number) => (short && (data?.hours ?? 24) <= 24 ? hourLabel(t, false) : dayLabel(t));
  const dot = { r: 3, strokeWidth: 0 };
  const per = bucket === 3600 ? "per hour" : bucket === 6 * 3600 ? "per 6 hours" : "per day";
  const emptyText = "No AI, web or image answers decided in this window yet. Points appear once the first hourly run is decided.";
  const legend = <Legend items={LINES.map((l) => ({ label: l.label, color: l.color }))} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Accuracy by test type" subtitle={`Graded on-chain, ${per}`} actions={legend} />
        <CardBody>
          {hasData ? (
            <div className="chart h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => pct(v)} width={48} />
                  <Tooltip cursor={{ stroke: "var(--border-strong)" }} content={(p) => <Tip {...p} fmt={(v) => pct(v, 1)} />} />
                  {LINES.map((l) => (
                    <Line key={l.type} {...LINE} dataKey={`${l.type}Acc`} name={l.label} stroke={l.color} dot={{ ...dot, fill: l.color }} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={emptyText} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Time to decision, p50" subtitle={`Submit to last vote, ${per === "per hour" ? "per hour" : `median of hourly p50s, ${per}`}`} actions={legend} />
        <CardBody>
          {hasData ? (
            <div className="chart h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} tickFormatter={(v: number) => duration(v)} width={68} domain={[0, "auto"]} />
                  <Tooltip cursor={{ stroke: "var(--border-strong)" }} content={(p) => <Tip {...p} fmt={duration} />} />
                  {LINES.map((l) => (
                    <Line key={l.type} {...LINE} dataKey={`${l.type}P50`} name={l.label} stroke={l.color} dot={{ ...dot, fill: l.color }} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
                  ))}
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
