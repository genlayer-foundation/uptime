"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "@/components/ui";
import type { Run } from "@/lib/jobs/types";
import { pct, runLatencyMs, seconds } from "./format";

const HOUR = 3_600_000;

/** Bucket width: hourly for short histories, daily beyond 3 days. */
function bucketMs(runs: Run[]): number {
  if (runs.length < 2) return HOUR;
  const span = Date.parse(runs[0].startedAt) - Date.parse(runs[runs.length - 1].startedAt);
  return span > 3 * 24 * HOUR ? 24 * HOUR : span > 24 * HOUR ? 6 * HOUR : HOUR;
}

function label(t: number, b: number) {
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return b >= 24 * HOUR ? day : `${day} ${String(d.getHours()).padStart(2, "0")}:00`;
}

function Tip({ active, payload, fmt, label: l }: { active?: boolean; payload?: readonly { value?: unknown; payload?: { n?: number } }[]; fmt: (v: number) => string; label?: unknown }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  const n = payload[0].payload?.n;
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="text-muted">{String(l)}</p>
      <p className="font-mono text-foreground">
        {typeof v === "number" ? fmt(v) : "no data"}
        {n != null ? <span className="text-muted"> · {n} runs</span> : null}
      </p>
    </div>
  );
}

export function RunCharts({ runs }: { runs: Run[] }) {
  const b = bucketMs(runs);
  const buckets = new Map<number, { pass: number; n: number }>();
  for (const r of runs) {
    if (r.pass === null) continue;
    const k = Math.floor(Date.parse(r.startedAt) / b) * b;
    const x = buckets.get(k) ?? { pass: 0, n: 0 };
    x.n++;
    if (r.pass) x.pass++;
    buckets.set(k, x);
  }
  const passData = [...buckets.entries()].sort((a, z) => a[0] - z[0]).map(([t, x]) => ({ t: label(t, b), rate: x.pass / x.n, n: x.n }));
  const latData = runs
    .slice()
    .reverse()
    .map((r) => ({ t: new Date(r.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), ms: runLatencyMs(r) }))
    .filter((x) => x.ms != null);

  const empty = <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border-strong text-xs text-muted">No decided runs yet</div>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader title="Pass rate" subtitle={`Per ${b >= 24 * HOUR ? "day" : b >= 6 * HOUR ? "6 hours" : "hour"}, decided runs only`} />
        <CardBody>
          {passData.length === 0 ? (
            empty
          ) : (
            <div className="chart h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={passData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} width={48} />
                  <Tooltip cursor={{ fill: "var(--surface)" }} content={(p) => <Tip {...(p as object)} fmt={pct} />} />
                  <Bar dataKey="rate" fill="var(--series-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Time to accepted" subtitle="Slowest step of each run" />
        <CardBody>
          {latData.length === 0 ? (
            empty
          ) : (
            <div className="chart h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={latData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}s`} tickLine={false} axisLine={false} width={48} />
                  <Tooltip content={(p) => <Tip {...(p as object)} fmt={(v) => seconds(v)} />} />
                  <Line type="monotone" dataKey="ms" stroke="var(--series-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
