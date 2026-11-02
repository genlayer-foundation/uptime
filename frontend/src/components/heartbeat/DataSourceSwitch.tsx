"use client";

// Dev-only data-source switch + badge. Rendered only when the bundle was built
// by `next dev`; the server ignores the choice in any other build (see
// lib/heartbeat/source.ts), so this is convenience, not the guard.

import { Badge, Segmented, type Tone } from "@/components/ui";
import type { DataSource } from "./types";

export const DEV_BUILD = process.env.NODE_ENV === "development";
const COOKIE = "hb-source"; // SOURCE_COOKIE in lib/heartbeat/source.ts

// Remembered across reloads; the server reads it (dev only) when no ?source= is sent.
function remember(s: DataSource): void {
  document.cookie = `${COOKIE}=${s}; path=/; max-age=31536000; samesite=lax`;
}

const CHOICES: Array<{ value: DataSource; label: string }> = [
  { value: "demo", label: "Demo" },
  { value: "production", label: "Production" },
];

const BADGE: Record<DataSource, { tone: Tone; label: string; note: string }> = {
  demo: { tone: "warn", label: "Demo data", note: "Synthetic, generated locally. Not a measurement." },
  production: { tone: "success", label: "Production data", note: "Proxied from uptime.genlayer.foundation." },
  local: { tone: "purple", label: "Local store", note: "Read from the Postgres (or KV fallback) this dev server is configured with." },
};

export function DataSourceSwitch({
  shown,
  onChange,
}: {
  shown: DataSource | undefined;
  onChange: (s: DataSource) => void;
}) {
  if (!DEV_BUILD) return null;
  const badge = shown ? BADGE[shown] : null;
  const pick = (s: DataSource) => {
    remember(s);
    onChange(s);
  };
  return (
    <div
      role="region"
      aria-label="Development data source"
      className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-dashed border-border-strong bg-surface px-4 py-3 text-sm"
    >
      <span className="text-xs font-medium uppercase tracking-wider text-muted">Dev · data source</span>
      <Segmented label="Data source" options={CHOICES} value={shown} onChange={pick} />
      {badge ? (
        <>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <span className="text-xs text-muted">{badge.note}</span>
        </>
      ) : null}
    </div>
  );
}
