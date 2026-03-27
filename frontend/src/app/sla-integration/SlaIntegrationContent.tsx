"use client";

import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";

export function SlaIntegrationContent() {
  return (
    <div className="space-y-16">
      {/* Coming Soon Badge */}
      <div>
        <span className="inline-block rounded-full border border-purple/30 bg-purple/5 px-3 py-1 text-xs font-medium text-purple">
          Coming Soon
        </span>
      </div>

      {/* Hero */}
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          Auto-payable SLAs.{" "}
          <span className="text-muted">Trustlessly enforced.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Combine on-chain uptime evidence from this monitor with{" "}
          <a
            href="https://internetcourt.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-purple transition-colors"
          >
            Internet Court
          </a>{" "}
          to create service level agreements that enforce themselves. No
          lawyers, no screenshots, no trust required.
        </p>
      </div>

      {/* How It Works */}
      <Section title="How It Works">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <StepCard
            step={1}
            title="Define the SLA"
            description="Create a case in Internet Court with a clear statement: 'Service X maintained 99.5% uptime over the past 30 days.' Both parties agree on the evaluation criteria upfront."
          />
          <StepCard
            step={2}
            title="Evidence is automatic"
            description="The Uptime contract stores every health check result on-chain. When a dispute arises, submit the contract address as evidence. The data is already there, immutable and timestamped."
          />
          <StepCard
            step={3}
            title="Verdict & payout"
            description="Internet Court's AI validators independently evaluate the on-chain evidence against the SLA terms. The verdict triggers automatic payment or penalty. No human intervention needed."
          />
        </div>
      </Section>

      {/* Example Case */}
      <Section
        title="Example Case"
        subtitle="What an SLA dispute looks like in Internet Court"
      >
        <div className="rounded-lg border border-border">
          {/* Statement */}
          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Statement
            </p>
            <p className="mt-2 text-sm text-foreground">
              &quot;The Studionet RPC endpoint maintained at least 99.50% uptime
              between March 1 and March 31, 2026, as measured by the
              UptimeMonitor contract at{" "}
              <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">
                0x1AE5...2573
              </code>{" "}
              on Studionet.&quot;
            </p>
          </div>

          {/* Guidelines */}
          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Guidelines
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>
                Read <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">get_uptime_stats(&quot;studionet_rpc&quot;, 720)</code> from the contract
              </li>
              <li>
                The <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">uptime_pct</code> field returns basis points (9950 = 99.50%)
              </li>
              <li>
                Verdict is TRUE if uptime_pct &ge; 9950, FALSE otherwise
              </li>
            </ul>
          </div>

          {/* Evidence */}
          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Evidence
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted">Provider submits</p>
                <div className="mt-1.5 rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
                  <p>Contract: 0x1AE5...2573</p>
                  <p>Network: Studionet</p>
                  <p>Method: get_uptime_stats</p>
                  <p>Args: [&quot;studionet_rpc&quot;, 720]</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">Customer submits</p>
                <div className="mt-1.5 rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
                  <p>Same contract reference</p>
                  <p>Both parties read the same</p>
                  <p>immutable on-chain data.</p>
                  <p>no conflicting evidence possible</p>
                </div>
              </div>
            </div>
          </div>

          {/* Verdict */}
          <div className="p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Verdict
            </p>
            <div className="mt-3 flex items-center gap-4">
              <VerdictOption label="True" description="SLA Met" active />
              <VerdictOption label="False" description="SLA Breached" />
              <VerdictOption label="Undetermined" description="Insufficient Data" />
            </div>
            <p className="mt-3 text-xs text-muted">
              AI validators independently read the contract, verify the uptime
              percentage, and reach consensus on the verdict. Payment is
              released or penalty applied automatically.
            </p>
          </div>
        </div>
      </Section>

      {/* Why This Matters */}
      <Section title="Why This Matters">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">No he-said-she-said</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Both parties reference the same on-chain data. There are no
              conflicting monitoring dashboards or cherry-picked screenshots.
              The contract is the single source of truth.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Instant enforcement</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              When the verdict is reached, funds move automatically. No
              invoicing, no 30-day payment terms, no collections. The SLA
              enforces itself.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Works for agents</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              AI agents can create SLA agreements, submit evidence, and receive
              payouts without a human in the loop. Built for the agent economy.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Composable</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Any service monitored by Uptime can have an SLA enforced through
              Internet Court. Add new services, create new agreements. It
              scales without additional infrastructure.
            </p>
          </div>
        </div>
      </Section>

      {/* Implementation Outline */}
      <Section
        title="Implementation"
        subtitle="High-level architecture for the integration"
      >
        <div className="rounded-lg border border-border bg-surface p-6 font-mono text-xs leading-relaxed text-muted">
          <pre>{`┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  Uptime Monitor  │         │  SLA Contract    │         │  Internet Court  │
│  (on-chain)      │────────►│  (terms + stake) │────────►│  (dispute res.)  │
│                  │ evidence│                  │ if breach│                  │
│  stores checks   │         │  auto-triggers   │         │  AI jury decides │
│  per service     │         │  dispute on      │         │  reads contract  │
│                  │         │  threshold miss  │         │  releases funds  │
└──────────────────┘         └──────────────────┘         └──────────────────┘`}</pre>
        </div>

        <div className="mt-6 space-y-4 text-sm text-muted">
          <p>
            <strong className="text-foreground">1. SLA Contract:</strong> A new
            Intelligent Contract that holds both parties&apos; stakes and defines
            the SLA terms (service ID, target uptime, measurement period,
            penalty amount).
          </p>
          <p>
            <strong className="text-foreground">2. Auto-trigger:</strong> At the
            end of each measurement period, the SLA contract reads{" "}
            <code className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
              get_uptime_stats()
            </code>{" "}
            from the Uptime contract. If the target is missed, it automatically
            creates a case in Internet Court.
          </p>
          <p>
            <strong className="text-foreground">3. Evidence submission:</strong> The
            case references the Uptime contract address and the specific
            service ID. Internet Court validators read the same on-chain data
            to reach a verdict.
          </p>
          <p>
            <strong className="text-foreground">4. Settlement:</strong> Based on
            the verdict, the SLA contract releases payment to the provider
            (SLA met) or transfers the penalty to the customer (SLA breached).
          </p>
        </div>
      </Section>

      {/* Links */}
      <div className="flex flex-wrap items-center gap-6 border-t border-border pt-8">
        <a
          href="https://internetcourt.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          Internet Court
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Link
          href="/how-it-works"
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          How Uptime Works
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          Dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-background p-5">
      <span className="font-mono text-xs text-purple">{step}.</span>
      <h3 className="mt-2 text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
    </div>
  );
}

function VerdictOption({
  label,
  description,
  active,
}: {
  label: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-2.5 text-center ${
        active
          ? "border-emerald-200 bg-emerald-50"
          : "border-border"
      }`}
    >
      <p
        className={`text-sm font-medium ${
          active ? "text-emerald-600" : "text-muted"
        }`}
      >
        {label}
      </p>
      <p className="text-[10px] text-muted">{description}</p>
    </div>
  );
}
