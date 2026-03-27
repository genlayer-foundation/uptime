"use client";

import { useStatus } from "@/lib/hooks/useStatus";
import { SERVICES } from "@/lib/utils/services";
import { ArrowRight, BookOpen, GitFork } from "lucide-react";
import Link from "next/link";

export function HeroSection() {
  const { data: status } = useStatus();

  const entries = Object.values(status?.services ?? {});
  const total = entries.length || SERVICES.length;
  const up = entries.filter((s) => s.latest?.is_up).length;
  const allUp = up === total && total > 0;
  const hasData = entries.length > 0;
  const totalChecks = entries.reduce((sum, s) => sum + (s.total_checks ?? 0), 0);
  const avgUptime = hasData
    ? entries.reduce((sum, s) => sum + (s.uptime_30d ?? 0), 0) / total
    : 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-8 sm:p-10">
      {/* Subtle grid background */}
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />

      <div className="relative flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h1
            className="text-3xl font-bold leading-tight text-white sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            The First Uptime Monitor
            <br />
            That Can&apos;t Lie.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-gray-400">
            Every health check independently verified by multiple validators and
            stored permanently on-chain.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://docs.genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-purple px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple/90"
            >
              <BookOpen className="h-4 w-4" />
              Read Docs
            </a>
            <a
              href="https://github.com/genlayer-foundation/uptime"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <GitFork className="h-4 w-4" />
              View on GitHub
            </a>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:text-white"
            >
              How It Works
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Live status badge */}
        <div className="flex-shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center backdrop-blur-sm sm:min-w-[160px]">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                hasData
                  ? allUp
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                    : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                  : "bg-gray-500 animate-pulse"
              }`}
            />
            <span
              className={`text-sm font-semibold ${
                hasData
                  ? allUp
                    ? "text-emerald-400"
                    : "text-red-400"
                  : "text-gray-400"
              }`}
            >
              {hasData ? (allUp ? "ALL UP" : `${total - up} DOWN`) : "Loading"}
            </span>
          </div>
          <p className="font-mono text-2xl font-bold text-white">
            {up}/{total}
          </p>
          {hasData && avgUptime > 0 && (
            <p className="mt-1 font-mono text-sm text-gray-400">
              {(avgUptime / 100).toFixed(2)}%
            </p>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="relative mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-5 text-xs text-gray-500">
        <span>{SERVICES.length} services</span>
        <span className="text-white/10">|</span>
        <span>2 networks</span>
        <span className="text-white/10">|</span>
        <span>{totalChecks.toLocaleString()} checks</span>
        <span className="text-white/10">|</span>
        <span>consensus-verified</span>
      </div>
    </section>
  );
}
