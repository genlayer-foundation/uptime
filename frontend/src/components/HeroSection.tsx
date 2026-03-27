"use client";

import { useStatus } from "@/lib/hooks/useStatus";
import { SERVICES } from "@/lib/utils/services";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function HeroSection() {
  const { data: status } = useStatus();

  const entries = Object.values(status?.services ?? {});
  const total = entries.length || SERVICES.length;
  const up = entries.filter((s) => s.latest?.is_up).length;
  const allUp = up === total && total > 0;
  const hasData = entries.length > 0;
  const totalChecks = entries.reduce((sum, s) => sum + (s.total_checks ?? 0), 0);

  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          The first uptime monitor{" "}
          <span className="text-muted">that can&apos;t lie.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Every health check verified by independent validators and stored
          on-chain. Integrate with{" "}
          <a
            href="https://internetcourt.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-purple transition-colors"
          >
            Internet Court
          </a>{" "}
          to create auto-payable SLAs, trustlessly enforced, with
          cryptographic evidence for every claim.
        </p>

        <div className="mt-8 flex items-center gap-6">
          <a
            href="https://github.com/genlayer-foundation/uptime"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground transition-colors hover:text-purple"
          >
            GitHub
          </a>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
          >
            How It Works
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Status strip */}
      <div className="mt-10 flex items-center gap-8 border-t border-border pt-6">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              hasData
                ? allUp
                  ? "bg-emerald-500"
                  : "bg-red-500"
                : "bg-zinc-300 animate-pulse"
            }`}
          />
          <span className="text-sm text-muted">
            {hasData
              ? allUp
                ? `${up}/${total} operational`
                : `${total - up} down`
              : "Loading..."}
          </span>
        </div>
        <span className="text-sm text-muted">
          {SERVICES.length} services
        </span>
        <span className="text-sm text-muted">
          {totalChecks.toLocaleString()} checks
        </span>
        <span className="text-sm text-muted">
          consensus-verified
        </span>
      </div>
    </section>
  );
}
