"use client";

import {
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import {
  CONTRACT_DEPLOYMENTS,
  getContractExplorerLink,
} from "@/lib/utils/contracts";

export function HowItWorksContent() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          Trustless uptime monitoring.{" "}
          <span className="text-muted">No single point of failure.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Traditional monitoring relies on a single provider you have to trust.
          GenLayer replaces trust with cryptographic proof. Every health
          check is independently verified by multiple validators and stored
          permanently on-chain.
        </p>
      </div>

      {/* Comparison Table */}
      <Section title="How It Compares">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="p-4 text-left text-xs font-medium text-muted">Feature</th>
                <th className="p-4 text-left text-xs font-medium text-muted">Pingdom / UptimeRobot</th>
                <th className="p-4 text-left text-xs font-medium text-purple">GenLayer</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Single point of failure", "Yes", "No, multiple validators"],
                ["Tamper-proof results", "No", "Yes, consensus-verified"],
                ["On-chain proof", "No", "Yes, immutable storage"],
                ["Open source", "No", "Yes"],
                ["Decentralized checking", "No", "Yes, geographic distribution"],
                ["SLA disputes", "Screenshots", "Cryptographic evidence"],
              ].map(([feature, traditional, genlayer]) => (
                <tr key={feature} className="border-b border-border/50 last:border-0">
                  <td className="p-4 text-sm text-foreground">{feature}</td>
                  <td className="p-4 text-sm text-muted">{traditional}</td>
                  <td className="p-4 text-sm text-emerald-600">{genlayer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* What it does */}
      <Section title="What does this monitor?">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          This system monitors 7 critical infrastructure services across the
          GenLayer ecosystem: RPC endpoints, block explorers, and the ZKSync
          bridge. Every hour, a cron job triggers the on-chain{" "}
          <strong className="text-foreground">UptimeMonitor</strong> contract.
          The contract makes HTTP and JSON-RPC calls to each service, records
          whether it responded correctly, and stores the result on-chain as an
          immutable record.
        </p>
      </Section>

      {/* The Consensus Process */}
      <Section
        title="The Consensus Process"
        subtitle="How validators reach agreement on each check"
      >
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <StepCard
            step={1}
            title="Leader Proposes"
            description="A randomly selected validator executes the health check by pinging the service via HTTP or JSON-RPC, then proposes the result to the network."
          />
          <StepCard
            step={2}
            title="Validators Verify"
            description="Other validators independently repeat the exact same check. They compare their result to the leader's using strict equality: the response must match exactly."
          />
          <StepCard
            step={3}
            title="Majority Decides"
            description="If the majority agrees, the transaction is accepted and the check result is stored on-chain. If not, a new leader is rotated in and the process repeats."
          />
        </div>

        <div className="mt-6 rounded-lg border border-border p-4">
          <p className="text-sm text-muted">
            <strong className="text-purple">Why strict equality?</strong>{" "}
            Health checks are factual: a service is either responding or it
            isn&apos;t. Unlike subjective tasks, there&apos;s no room for interpretation.
            This makes{" "}
            <code className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
              strict_eq
            </code>{" "}
            the right consensus mode.
          </p>
        </div>
      </Section>

      {/* Why Trustless */}
      <Section
        title="Why Trustless Monitoring?"
        subtitle="What makes this different"
      >
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <BenefitCard
            title="Tamper-proof SLA proof"
            description="No single party can fake uptime data. Results are verified by independent validators and stored immutably on-chain."
          />
          <BenefitCard
            title="Transparent & auditable"
            description="Anyone can read the smart contract directly and verify every historical check result. No black box."
          />
          <BenefitCard
            title="Decentralized checking"
            description="Checks come from multiple geographic locations via independent validators, reducing false positives."
          />
          <BenefitCard
            title="On-chain accountability"
            description="SLA violations are provable on-chain, useful for dispute resolution backed by cryptographic evidence."
          />
        </div>
      </Section>

      {/* Technical Architecture */}
      <Section title="Architecture">
        <div className="rounded-lg border border-border bg-surface p-6 font-mono text-xs leading-relaxed text-muted">
          <pre>{`┌─────────────┐   cron    ┌──────────────────┐   writeContract   ┌─────────────────────┐
│   Vercel    │ ────────► │  Next.js API      │ ────────────────► │  UptimeMonitor.py   │
│   Cron Job  │           │  /api/cron/check  │                   │  (on-chain)         │
└─────────────┘           └──────────────────┘                   └─────────────────────┘
                                                                    │ stores CheckResult
                                                                    │ (after consensus)
                                                                    ▼
┌─────────────┐  reads    ┌──────────────────┐   cache sync      ┌─────────────────────┐
│  Dashboard  │ ◄──────── │  Vercel KV       │ ◄──────────────── │  Contract storage   │
│  (React)    │           │  (off-chain)     │   incremental     │  (source of truth)  │
└─────────────┘           └──────────────────┘                   └─────────────────────┘`}</pre>
        </div>

        <div className="mt-6 space-y-4 text-sm text-muted">
          <p>
            <strong className="text-foreground">1. Cron trigger:</strong> A Vercel
            cron job calls{" "}
            <code className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
              /api/cron/check
            </code>{" "}
            every hour, sending a{" "}
            <code className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
              run_checks()
            </code>{" "}
            transaction to the contract.
          </p>
          <p>
            <strong className="text-foreground">2. Consensus:</strong> Multiple
            validators independently check all 7 services and vote on results
            using strict equality.
          </p>
          <p>
            <strong className="text-foreground">3. On-chain storage:</strong> Once
            consensus is reached, each CheckResult is stored in the contract&apos;s
            TreeMap storage.
          </p>
          <p>
            <strong className="text-foreground">4. Dashboard reads:</strong> The
            dashboard reads from on-chain state through a KV cache layer.
          </p>
        </div>
      </Section>

      {/* The Contract */}
      <Section title="The Smart Contract">
        <div className="space-y-2">
          {CONTRACT_DEPLOYMENTS.map((d) => (
            <a
              key={d.networkId}
              href={getContractExplorerLink(d)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-border px-5 py-4 transition-colors hover:bg-surface"
            >
              <div>
                <p className="text-sm text-foreground">{d.networkName}</p>
                <code className="font-mono text-xs text-muted">
                  {d.address}
                </code>
              </div>
              <ExternalLink className="h-4 w-4 text-muted" />
            </a>
          ))}
        </div>

        <div className="mt-4">
          <a
            href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/uptime_monitor.py"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            View source code on GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </Section>

      {/* GenLayer */}
      <Section title="What is GenLayer?">
        <div className="max-w-2xl space-y-3 text-sm leading-relaxed text-muted">
          <p>
            <a
              href="https://genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-purple transition-colors"
            >
              GenLayer
            </a>{" "}
            is a blockchain that runs{" "}
            <strong className="text-foreground">Intelligent Contracts</strong>,
            smart contracts that can access the internet, call APIs, and use AI,
            all verified through decentralized consensus.
          </p>
          <p>
            This uptime monitor is a real-world example: a decentralized
            application that reads live data from external services and stores
            verified results on-chain. Something impossible with traditional
            smart contracts.
          </p>
        </div>
      </Section>
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

function BenefitCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="bg-background p-5">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
    </div>
  );
}
