// Client-side view of GET /api/heartbeat. Types are imported (type-only) from
// the backend so the page cannot drift from what the route returns.
import type { ProbeKind, ProbeRecord } from "@/lib/heartbeat/store";
import type { RunsSummary, Stat, latestRun } from "@/lib/heartbeat/summary";
import type { DataSource } from "@/lib/heartbeat/source";
import type { TestType } from "@/lib/heartbeat/probes";

export type { DataSource, ProbeKind, ProbeRecord, RunsSummary, Stat, TestType };
export type LatestRun = NonNullable<ReturnType<typeof latestRun>>;

export type SeriesPoint = { t: number; appeal: Stat } & Record<TestType, Stat>;

export interface HeartbeatData {
  network: string;
  contract: string | null;
  explorerUrl: string;
  generatedAt: number;
  hours: number;
  byKind: Record<ProbeKind, Stat>;
  byType: Record<TestType, Stat>;
  byProbe: Record<string, Stat>;
  appeals: Stat;
  appealsByProbe: Record<string, Stat>;
  series: SeriesPoint[];
  pending: number;
  runs: RunsSummary;
  latestRun: LatestRun | null;
  recent: ProbeRecord[];
  // Present only from a dev server (`next dev`): which source answered.
  source?: DataSource;
}

export const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;
