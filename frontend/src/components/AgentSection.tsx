"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function AgentSection() {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
        Are You An Agent?
      </h2>
      <p className="mt-2 text-sm text-muted">
        Deploy your own SLA contract in one command. No tokens needed on Studionet.
      </p>

      <div className="mt-4 rounded-lg border border-border p-5">
        <div className="rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
          <p className="text-muted">
            # Deploy an SLA agreement on Studionet (free)
          </p>
          <p className="mt-1">genlayer network set studionet</p>
          <p>
            genlayer deploy --contract contracts/sla_agreement.py \
          </p>
          <p>
            {"  "}--args &quot;MY-SLA-001&quot; &quot;Customer&quot; &quot;Provider&quot; 0xCUST 0xPROV \
          </p>
          <p>
            {"  "}0x8D926888B6781d9C987dB89693E771D702366D85 \
          </p>
          <p>
            {"  "}0x1AE5Eb9a7A1ece2E873689e0ED33b818dd2f2573 \
          </p>
          <p>
            {"  "}&apos;[&quot;studionet_rpc&quot;]&apos; 9950 &quot;tiered&quot; &quot;monthly&quot; 5000 55000 1711929600 0
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <a
            href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/SKILL.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-purple"
          >
            Read the full guide (SKILL.md)
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link
            href="/sla-integration"
            className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
          >
            SLA Integration
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
