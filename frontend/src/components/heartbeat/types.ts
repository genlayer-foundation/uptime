// Client-side view of GET /api/heartbeat. Types are imported (type-only) from
// the backend so the page cannot drift from what the route returns.
import type { ProbeKind, ProbeRecord } from "@/lib/heartbeat/store";
import type { Stat } from "@/lib/heartbeat/summary";

export type { ProbeKind, ProbeRecord, Stat };

export type SeriesPoint = { t: number } & Record<ProbeKind, Stat>;

export interface HeartbeatData {
  network: string;
  contract: string | null;
  explorerUrl: string;
  generatedAt: number;
  hours: number;
  byKind: Record<ProbeKind, Stat>;
  byQuestionKind: Record<string, Stat>;
  byQuestion: Record<string, Stat>;
  series: SeriesPoint[];
  pending: number;
  recent: ProbeRecord[];
}

export const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;
