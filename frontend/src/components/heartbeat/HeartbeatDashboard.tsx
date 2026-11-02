"use client";

import { useEffect, useState } from "react";
import { Database, ExternalLink, FolderGit2, Info, TriangleAlert } from "lucide-react";
import { KpiRow } from "./KpiRow";
import { TrendCharts } from "./TrendCharts";
import { Breakdown } from "./Breakdown";
import { RecentProbes } from "./RecentProbes";
import { WINDOWS, type HeartbeatData } from "./types";

const POLL_MS = 60_000;
const REPO = "https://github.com/genlayer-foundation/uptime";

function useHeartbeat(hours: number) {
  const [data, setData] = useState<HeartbeatData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let ctrl: AbortController | null = null;
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`/api/heartbeat?hours=${hours}`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`The data endpoint answered ${res.status}.`);
        const json = (await res.json()) as HeartbeatData;
        if (live) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!live || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "The data endpoint could not be reached.");
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      ctrl?.abort();
      clearInterval(id);
    };
  }, [hours]);

  return { data, error };
}

function ThemeToggle() {
  // theme.js (loaded in layout) wires every [data-theme-toggle] button.
  return (
    <button className="gl-theme-toggle" data-theme-toggle aria-label="Toggle dark / light theme" title="Toggle theme">
      <svg className="icon-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M11.38 2.02A10 10 0 1022 12.5 8 8 0 0111.38 2.02z" />
      </svg>
      <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
      </svg>
    </button>
  );
}

export function HeartbeatDashboard() {
  const [hours, setHours] = useState<number>(168);
  const { data, error } = useHeartbeat(hours);
  const shown = data && data.hours === hours ? data : null;
  const loading = !shown && !error;
  const empty = !!shown && Object.values(shown.byKind).every((s) => s.total === 0);
  const network = data?.network ?? "Bradbury";

  return (
    <div className="gl-page hb">
      <div className="gl-page__bloom gl-page__bloom--1" />
      <div className="gl-page__bloom gl-page__bloom--2" />

      <nav className="gl-nav">
        <div className="gl-nav__inner">
          <a className="gl-nav__brand" href="https://genlayer.foundation" aria-label="GenLayer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gl/assets/GenLayer_Logo_Black.svg" alt="GenLayer" />
          </a>
          <span className="hb-nav__title">Heartbeat</span>
          <div className="gl-nav__right">
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <main className="gl-wrap">
        <header className="hb-head">
          <div>
            <span className="gl-eyebrow">
              <span className="gl-dot" />
              Testnet {network}
            </span>
          </div>
          <h1>Heartbeat</h1>
          <p className="hb-head__lede">
            Every hour a canary Intelligent Contract on Testnet {network} is deployed, fetches a page, and answers
            questions with known answers, so we can watch whether consensus stays correct over time.
          </p>
          <div className="hb-head__meta">
            {data?.contract ? (
              <span>
                Contract{" "}
                <a className="mono" href={`${data.explorerUrl}/address/${data.contract}`} target="_blank" rel="noreferrer">
                  {data.contract}
                </a>
              </span>
            ) : (
              <span>Contract not deployed yet</span>
            )}
            {data ? <span>{data.pending} probes awaiting a decision</span> : null}
          </div>
        </header>

        <div className="hb-toolbar">
          <div className="gl-seg" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                className={`gl-seg__item${w.hours === hours ? " gl-seg__item--active" : ""}`}
                aria-pressed={w.hours === hours}
                onClick={() => setHours(w.hours)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className="hb-toolbar__info" aria-live="polite">
            {loading
              ? "Loading…"
              : data
                ? `Updated ${new Date(data.generatedAt * 1000).toLocaleTimeString()} · refreshes every minute`
                : ""}
          </span>
        </div>

        {error ? (
          <div className="hb-alert-wrap">
            <div className="gl-alert gl-alert--warn" role="status">
              <TriangleAlert className="gl-alert__icon" size={18} aria-hidden />
              <div>
                <strong>Heartbeat data is unavailable</strong>
                {error} The page will retry every minute.
              </div>
            </div>
          </div>
        ) : empty ? (
          <div className="hb-alert-wrap">
            <div className="gl-alert gl-alert--info" role="status">
              <Info className="gl-alert__icon" size={18} aria-hidden />
              <div>
                <strong>No probes recorded in this window</strong>
                {shown?.contract
                  ? "Results appear here after the next hourly tick is reconciled."
                  : "The heartbeat contract is not deployed yet. Results appear here once the hourly cron starts probing it."}
              </div>
            </div>
          </div>
        ) : null}

        <section className="hb-section" aria-label="Key figures">
          <KpiRow data={shown} />
        </section>

        <section className="hb-section" aria-label="Trends">
          <TrendCharts data={shown} />
        </section>

        <section className="hb-section" aria-label="Breakdown by question">
          <Breakdown data={shown} />
        </section>

        <section className="hb-section" aria-label="Recent probes">
          <RecentProbes data={shown} />
        </section>

        <footer className="gl-footer hb-footer">
          <a href={`/api/heartbeat?format=rows&hours=${hours}`}>
            <Database size={16} aria-hidden />
            Raw data for Grafana →
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            <FolderGit2 size={16} aria-hidden />
            genlayer-foundation/uptime
            <ExternalLink size={12} aria-hidden />
          </a>
          <span className="spacer" />
          <span>GenLayer Foundation</span>
        </footer>
      </main>
    </div>
  );
}
