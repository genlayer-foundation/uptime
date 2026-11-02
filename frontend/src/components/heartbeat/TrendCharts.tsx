"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
    <div className="hb-tip">
      <span className="hb-tip__time">{hourLabel(Number(label), true)}</span>
      {payload.map((p) => (
        <span className="hb-tip__row" key={String(p.dataKey)}>
          <span className="gl-legend__swatch" style={{ background: p.color }} />
          {String(p.name)}
          <span className="val">{typeof p.value === "number" ? fmt(p.value) : "no data"}</span>
        </span>
      ))}
    </div>
  );
}

const AXIS = { tickLine: false, axisLine: false } as const;
const LINE = { type: "linear", strokeWidth: 2, connectNulls: false, isAnimationActive: false } as const;

function Empty({ text }: { text: string }) {
  return <div className="hb-chart-empty">{text}</div>;
}

export function TrendCharts({ data }: { data: HeartbeatData | null }) {
  const hasData = !!data && data.series.some((p) => p.llm.total > 0);
  const r = hasData ? rows(data) : [];
  const short = (data?.hours ?? 24) <= 24;
  const tickFmt = (t: number) => (short ? hourLabel(t, false) : dayLabel(t));
  const dot = short ? { r: 3, strokeWidth: 0 } : false;
  const emptyText = "No LLM probes resolved in this window yet. Points appear once the first hourly tick is reconciled.";

  return (
    <div className="hb-charts">
      <div className="gl-card">
        <div className="gl-card__header">
          <div>
            <h3 className="gl-card__title">Accuracy and agreement</h3>
            <p className="gl-card__sub">LLM probes, per hour</p>
          </div>
          <div className="gl-legend">
            <span className="gl-legend__item">
              <span className="gl-legend__swatch" style={{ background: "var(--hb-series-1)" }} />
              Accuracy
            </span>
            <span className="gl-legend__item">
              <span className="gl-legend__swatch" style={{ background: "var(--hb-series-2)" }} />
              Agreement
            </span>
          </div>
        </div>
        <div className="gl-card__body">
          {hasData ? (
            <div className="hb-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => pct(v)} width={48} />
                  <Tooltip
                    cursor={{ stroke: "var(--c-border-strong)" }}
                    content={(p) => <Tip {...p} fmt={(v) => pct(v, 1)} />}
                  />
                  <Line {...LINE} dataKey="accuracy" name="Accuracy" stroke="var(--hb-series-1)" dot={dot ? { ...dot, fill: "var(--hb-series-1)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--c-bg)" }} />
                  <Line {...LINE} dataKey="agreement" name="Agreement" stroke="var(--hb-series-2)" dot={dot ? { ...dot, fill: "var(--hb-series-2)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--c-bg)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={emptyText} />
          )}
        </div>
      </div>

      <div className="gl-card">
        <div className="gl-card__header">
          <div>
            <h3 className="gl-card__title">Time to decision, p50</h3>
            <p className="gl-card__sub">LLM probes, submit to last vote, per hour</p>
          </div>
        </div>
        <div className="gl-card__body">
          {hasData ? (
            <div className="hb-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" {...AXIS} tickFormatter={tickFmt} minTickGap={32} />
                  <YAxis {...AXIS} tickFormatter={(v: number) => duration(v)} width={56} domain={[0, "auto"]} />
                  <Tooltip
                    cursor={{ stroke: "var(--c-border-strong)" }}
                    content={(p) => <Tip {...p} fmt={duration} />}
                  />
                  <Line {...LINE} dataKey="p50" name="p50" stroke="var(--hb-series-1)" dot={dot ? { ...dot, fill: "var(--hb-series-1)" } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--c-bg)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={emptyText} />
          )}
        </div>
      </div>
    </div>
  );
}
