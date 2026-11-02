"use client";

// Dev-only data-source switch + badge. Rendered only when the bundle was built
// by `next dev`; the server ignores the choice in any other build (see
// lib/heartbeat/source.ts), so this is convenience, not the guard.

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

const BADGE: Record<DataSource, { tone: string; label: string; note: string }> = {
  demo: { tone: "gl-badge--warn", label: "Demo data", note: "Synthetic, generated locally. Not a measurement." },
  production: { tone: "gl-badge--success", label: "Production data", note: "Proxied from uptime.genlayer.foundation." },
  local: { tone: "gl-badge--validator", label: "Local KV", note: "Read from the KV store this dev server is configured with." },
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
    <div className="hb-devbar" role="region" aria-label="Development data source">
      <span className="hb-devbar__label">Dev · data source</span>
      <div className="gl-seg" role="group" aria-label="Data source">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`gl-seg__item${c.value === shown ? " gl-seg__item--active" : ""}`}
            aria-pressed={c.value === shown}
            onClick={() => pick(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {badge ? (
        <>
          <span className={`gl-badge ${badge.tone}`}>{badge.label}</span>
          <span className="hb-devbar__note">{badge.note}</span>
        </>
      ) : null}
    </div>
  );
}
