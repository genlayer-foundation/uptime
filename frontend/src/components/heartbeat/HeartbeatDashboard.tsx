"use client";

import { useEffect, useState } from "react";
import { Database, ExternalLink } from "lucide-react";
import { Alert, PageContainer, PageHeader, Segmented, StatusDot } from "@/components/ui";
import { KpiRow } from "./KpiRow";
import { TrendCharts } from "./TrendCharts";
import { Breakdown } from "./Breakdown";
import { RecentProbes } from "./RecentProbes";
import { RunSteps } from "./RunSteps";
import { HeartbeatRunNow } from "./HeartbeatRunNow";
import { Ago } from "./Ago";
import { verdict } from "./verdict";
import { DataSourceSwitch, DEV_BUILD } from "./DataSourceSwitch";
import { WINDOWS, type DataSource, type HeartbeatData } from "./types";

const POLL_MS = 60_000;
const REPO = "https://github.com/genlayer-foundation/uptime";

// `source` is sent only by the dev-only switch; the server ignores it outside
// `next dev`, and without it the server picks the default.
function query(hours: number, source: DataSource | null): string {
  return `hours=${hours}${source ? `&source=${source}` : ""}`;
}

function useHeartbeat(hours: number, source: DataSource | null) {
  const [data, setData] = useState<HeartbeatData | null>(null);
  const [error, setError] = useState<{ message: string; source?: DataSource } | null>(null);

  useEffect(() => {
    let live = true;
    let ctrl: AbortController | null = null;
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`/api/heartbeat?${query(hours, source)}`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) {
          // The route explains itself in { error, source } when it can.
          const body = (await res.json().catch(() => null)) as { error?: string; source?: DataSource } | null;
          if (live) setError({ message: body?.error ?? `The data endpoint answered ${res.status}.`, source: body?.source });
          return;
        }
        const json = (await res.json()) as HeartbeatData;
        if (live) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!live || (e instanceof DOMException && e.name === "AbortError")) return;
        setError({ message: e instanceof Error ? e.message : "The data endpoint could not be reached." });
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      ctrl?.abort();
      clearInterval(id);
    };
  }, [hours, source]);

  return { data, error };
}

const WINDOW_OPTIONS = WINDOWS.map((w) => ({ value: w.hours as number, label: w.label }));

export function HeartbeatDashboard() {
  const [hours, setHours] = useState<number>(168);
  const [source, setSource] = useState<DataSource | null>(null);
  const { data, error } = useHeartbeat(hours, source);
  // Never show one source's numbers under another source's label.
  const shown = data && data.hours === hours && (!source || data.source === source) ? data : null;
  const shownSource = DEV_BUILD ? (error?.source ?? source ?? data?.source) : undefined;
  const loading = !shown && !error;
  const empty = !!shown && Object.values(shown.byKind).every((s) => s.total === 0);
  const network = data?.network ?? "Bradbury";
  const v = verdict(shown?.runs);

  return (
    <PageContainer>
      <DataSourceSwitch shown={shownSource} onChange={setSource} />

      <PageHeader
        eyebrow="Live example"
        title="Bradbury Heartbeat."
        lede={`Our own job: five actions every hour on GenLayer Testnet ${network}, with answers we know in advance.`}
      >
        <p className="mt-8 flex items-center gap-3 text-lg font-medium text-foreground sm:text-xl" aria-live="polite">
          <StatusDot size="md" tone={error ? "danger" : (v?.tone ?? "neutral")} pulse={loading} />
          <span>
            {loading
              ? "Loading the latest run…"
              : error
                ? "Live data is unavailable right now"
                : v
                  ? (
                      <>
                        {v.text}
                        {shown?.runs.lastRunAt ? (
                          <span className="text-muted">
                            {" "}
                            — last run <Ago sec={shown.runs.lastRunAt} />
                          </span>
                        ) : null}
                      </>
                    )
                  : "No runs in this window yet"}
          </span>
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border pt-6 text-sm text-muted">
                    {shown?.source === "demo" ? (
            <span>Synthetic demo contract, not on any network</span>
          ) : shown?.contract ? (
            <a
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              href={`${shown.explorerUrl}/address/${shown.contract}`}
              target="_blank"
              rel="noreferrer"
            >
              Heartbeat contract <span className="font-mono text-xs">{`${shown.contract.slice(0, 6)}…${shown.contract.slice(-4)}`}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : shown ? (
            <span>Heartbeat contract not deployed yet</span>
          ) : null}
          {shown?.source !== "demo" && <HeartbeatRunNow />}
        </div>
      </PageHeader>

      <section aria-label="One run, step by step" className="mb-10">
        <RunSteps data={shown} />
      </section>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Segmented label="Time window" options={WINDOW_OPTIONS} value={hours} onChange={setHours} />
        <span className="text-xs text-muted" aria-live="polite">
          {loading
            ? "Loading…"
            : shown
              ? `Updated ${new Date(shown.generatedAt * 1000).toLocaleTimeString()} · refreshes every minute`
              : ""}
        </span>
      </div>

      {error ? (
        <Alert tone="warn" className="mb-6" title="Bradbury Heartbeat data is unavailable">
          {error.message} The page will retry every minute.
        </Alert>
      ) : empty ? (
        <Alert tone="info" className="mb-6" title="No runs recorded in this window">
          {shown?.contract
            ? "Results appear here once the next hourly run is decided."
            : "The Heartbeat contract is not deployed yet. Results appear here once the hourly runs start."}
        </Alert>
      ) : null}

      <div className="space-y-10">
        <section aria-label="Key figures">
          <KpiRow data={shown} />
        </section>

        <section aria-label="Trends">
          <TrendCharts data={shown} />
        </section>

        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground hover:bg-surface">Details</summary>
          <div className="space-y-10 border-t border-border p-4">
            <Breakdown data={shown} />
            <RecentProbes data={shown} />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border pt-6 text-xs text-muted">
          <a
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            href={`/api/heartbeat?format=rows&${query(hours, DEV_BUILD ? (shownSource ?? null) : null)}`}
          >
            <Database className="h-3.5 w-3.5" aria-hidden />
            Raw data for Grafana →
          </a>
          <a
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            href={`${REPO}/blob/main/contracts/heartbeat.py`}
            target="_blank"
            rel="noreferrer"
          >
            heartbeat.py
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>
    </PageContainer>
  );
}
