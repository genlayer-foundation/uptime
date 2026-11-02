"use client";

import { useEffect, useState } from "react";
import { Database, ExternalLink } from "lucide-react";
import { Alert, PageContainer, PageHeader, Segmented, StatusDot } from "@/components/ui";
import { KpiRow } from "./KpiRow";
import { TrendCharts } from "./TrendCharts";
import { Breakdown } from "./Breakdown";
import { RecentProbes } from "./RecentProbes";
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

  return (
    <PageContainer>
      <DataSourceSwitch shown={shownSource} onChange={setSource} />

      <PageHeader
        eyebrow="Example job"
        title="Bradbury Heartbeat."
        muted="A job we run ourselves."
        lede={
          <>
            Every hour this job runs five kinds of test on Testnet {network}, each one way real contracts depend on
            the network: a canary deploy, a plain state write, a web fetch, and two rotating probes that ask an LLM,
            read a page or read an image. The contract grades every answer itself against an on-chain key, and every
            fifth hour one probe is appealed.
          </>
        }
      >
        {/* the old status strip */}
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <span className="flex items-center gap-2">
            <StatusDot tone={error ? "danger" : shown ? "success" : "neutral"} pulse={loading} />
            {loading ? "Loading..." : error ? "Data unavailable" : `Testnet ${network}`}
          </span>
          <span>every hour</span>
          {shown?.source === "demo" ? (
            <span>Synthetic demo contract, not on any network</span>
          ) : shown?.contract ? (
            <a
              className="inline-flex items-center gap-1 break-all font-mono text-xs transition-colors hover:text-foreground"
              href={`${shown.explorerUrl}/address/${shown.contract}`}
              target="_blank"
              rel="noreferrer"
            >
              {shown.contract}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : shown ? (
            <span>Contract not deployed yet</span>
          ) : null}
          {shown ? <span>{shown.pending} probes awaiting a decision</span> : null}
        </div>
      </PageHeader>

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
        <Alert tone="info" className="mb-6" title="No probes recorded in this window">
          {shown?.contract
            ? "Results appear here after the next hourly tick is reconciled."
            : "The Bradbury Heartbeat contract is not deployed yet. Results appear here once the hourly cron starts probing it."}
        </Alert>
      ) : null}

      <div className="space-y-10">
        <section aria-label="Key figures">
          <KpiRow data={shown} />
        </section>

        <section aria-label="Trends">
          <TrendCharts data={shown} />
        </section>

        <section aria-label="Breakdown by test type and probe">
          <Breakdown data={shown} />
        </section>

        <section aria-label="Recent probes">
          <RecentProbes data={shown} />
        </section>

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
