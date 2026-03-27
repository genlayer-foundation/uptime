"use client";

import {
  Shield,
  Server,
  Users,
  CheckCircle,
  Vote,
  Eye,
  Zap,
  ArrowRight,
  ExternalLink,
  GitCompare,
  Lock,
  Globe,
  FileCode,
} from "lucide-react";
import {
  CONTRACT_DEPLOYMENTS,
  getContractExplorerLink,
  shortenAddress,
} from "@/lib/utils/contracts";

export function HowItWorksContent() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div>
        <h1
          className="text-3xl font-bold text-white sm:text-4xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Trustless Uptime Monitoring
        </h1>
        <p className="mt-3 text-lg text-gray-400">
          Traditional monitoring relies on a single provider you have to trust.
          GenLayer Uptime replaces trust with cryptographic proof — every health
          check is independently verified by multiple validators and stored
          permanently on-chain.
        </p>
      </div>

      {/* Comparison Table */}
      <Section
        title="How It Compares"
        subtitle="Traditional monitoring vs GenLayer"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="pb-3 pr-6 text-xs font-medium text-gray-500">Feature</th>
                <th className="pb-3 pr-6 text-xs font-medium text-gray-500">Pingdom / UptimeRobot</th>
                <th className="pb-3 text-xs font-medium text-purple">GenLayer</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {[
                ["Single point of failure", "Yes", "No — multiple validators"],
                ["Tamper-proof results", "No", "Yes — consensus-verified"],
                ["On-chain proof", "No", "Yes — immutable storage"],
                ["Open source", "No", "Yes"],
                ["Decentralized checking", "No", "Yes — geographic distribution"],
                ["SLA disputes", "Screenshots", "Cryptographic evidence"],
              ].map(([feature, traditional, genlayer]) => (
                <tr key={feature} className="border-b border-white/5">
                  <td className="py-2.5 pr-6 font-medium text-gray-300">{feature}</td>
                  <td className="py-2.5 pr-6 text-gray-500">{traditional}</td>
                  <td className="py-2.5 text-emerald-400">{genlayer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* What it does */}
      <Section title="What does this monitor?">
        <p className="text-sm leading-relaxed text-gray-400">
          GenLayer Uptime monitors 7 critical infrastructure services across the
          GenLayer ecosystem — RPC endpoints, block explorers, and the ZKSync
          bridge. Every hour, a cron job triggers the on-chain{" "}
          <strong className="text-gray-300">UptimeMonitor</strong> contract.
          The contract makes HTTP and JSON-RPC calls to each service, records
          whether it responded correctly, and stores the result on-chain as an
          immutable record.
        </p>
      </Section>

      {/* The Consensus Process */}
      <Section
        title="The Consensus Process"
        subtitle="How validators reach agreement on each check"
        icon={<Vote className="h-5 w-5 text-purple" />}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <StepCard
            step={1}
            icon={<Eye className="h-5 w-5" />}
            title="Leader Proposes"
            description="A randomly selected validator (the 'leader') executes the health check — pinging the service via HTTP or JSON-RPC — and proposes the result to the network."
          />
          <StepCard
            step={2}
            icon={<Users className="h-5 w-5" />}
            title="Validators Verify"
            description="Other validators independently repeat the exact same check. They compare their result to the leader's using strict equality — the response must match exactly."
          />
          <StepCard
            step={3}
            icon={<CheckCircle className="h-5 w-5" />}
            title="Majority Decides"
            description="If the majority of validators agree with the leader's result, the transaction is accepted and the check result is stored on-chain. If not, a new leader is rotated in and the process repeats."
          />
        </div>

        <div className="mt-6 rounded-lg border border-purple/20 bg-purple/5 p-4">
          <p className="text-sm text-gray-400">
            <strong className="text-purple">Why &quot;strict equality&quot;?</strong>{" "}
            Health checks are factual — a service is either responding or it
            isn&apos;t. Unlike subjective tasks (like content moderation), there&apos;s no
            room for interpretation. If the leader says a service returned HTTP
            200, every validator checking that same service should get the same
            result. This makes{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
              strict_eq
            </code>{" "}
            the right consensus mode.
          </p>
        </div>
      </Section>

      {/* Why Trustless */}
      <Section
        title="Why Trustless Monitoring?"
        subtitle="What makes this different from Pingdom or UptimeRobot"
        icon={<Shield className="h-5 w-5 text-purple" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <BenefitCard
            icon={<Lock className="h-5 w-5" />}
            title="Tamper-proof SLA proof"
            description="No single party — not even the service operator — can fake uptime data. Results are verified by independent validators and stored immutably on-chain. This creates provable SLA compliance records."
          />
          <BenefitCard
            icon={<Eye className="h-5 w-5" />}
            title="Transparent & auditable"
            description="Anyone can read the smart contract directly and verify every historical check result. There's no black box — the monitoring logic, the data, and the verification process are all public."
          />
          <BenefitCard
            icon={<Globe className="h-5 w-5" />}
            title="Decentralized checking"
            description="Checks come from multiple geographic locations via independent validators, reducing false positives from network partitions. If one validator has a connectivity issue, the majority still gets the right answer."
          />
          <BenefitCard
            icon={<GitCompare className="h-5 w-5" />}
            title="On-chain accountability"
            description="SLA violations are provable on-chain — useful for dispute resolution, automated penalties, and service-level agreements backed by cryptographic evidence rather than screenshots."
          />
        </div>
      </Section>

      {/* Technical Architecture */}
      <Section
        title="Technical Architecture"
        icon={<Server className="h-5 w-5 text-purple" />}
      >
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 font-mono text-xs leading-relaxed text-gray-500">
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

        <div className="mt-4 space-y-3 text-sm text-gray-400">
          <p>
            <strong className="text-gray-300">1. Cron trigger:</strong> A Vercel
            cron job calls{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
              /api/cron/check
            </code>{" "}
            every hour. This sends a{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
              run_checks()
            </code>{" "}
            transaction to the UptimeMonitor contract.
          </p>
          <p>
            <strong className="text-gray-300">2. Consensus:</strong> The
            transaction enters GenLayer consensus. Multiple validators
            independently check all 7 services and vote on the results using
            strict equality.
          </p>
          <p>
            <strong className="text-gray-300">3. On-chain storage:</strong> Once
            consensus is reached, each{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
              CheckResult
            </code>{" "}
            (timestamp, is_up, extra_data) is stored in the contract&apos;s{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
              TreeMap
            </code>{" "}
            storage.
          </p>
          <p>
            <strong className="text-gray-300">4. Dashboard reads:</strong> This
            dashboard reads from the on-chain contract state. The data you see is
            the same data any validator or user can read by querying the contract
            directly.
          </p>
        </div>
      </Section>

      {/* The Contract */}
      <Section
        title="The Smart Contract"
        subtitle="UptimeMonitor.py — deployed on multiple networks"
        icon={<FileCode className="h-5 w-5 text-purple" />}
      >
        <div className="space-y-3">
          {CONTRACT_DEPLOYMENTS.map((d) => (
            <a
              key={d.networkId}
              href={getContractExplorerLink(d)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 transition-colors hover:border-purple/30"
            >
              <div>
                <p className="font-medium text-gray-300">{d.networkName}</p>
                <code className="font-mono text-sm text-gray-500">
                  {d.address}
                </code>
              </div>
              <ExternalLink className="h-4 w-4 text-gray-500" />
            </a>
          ))}
        </div>

        <div className="mt-4">
          <a
            href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/uptime_monitor.py"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-purple/30 bg-purple/10 px-4 py-2 text-sm text-purple transition-colors hover:bg-purple/20"
          >
            View source code on GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </Section>

      {/* GenLayer */}
      <Section title="What is GenLayer?">
        <p className="text-sm leading-relaxed text-gray-400">
          <a
            href="https://genlayer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple hover:underline"
          >
            GenLayer
          </a>{" "}
          is a blockchain that runs{" "}
          <strong className="text-gray-300">Intelligent Contracts</strong> —
          smart contracts that can access the internet, call APIs, and use AI,
          all verified through a decentralized consensus process. Unlike
          traditional smart contracts that are limited to on-chain data,
          Intelligent Contracts can interact with the real world while
          maintaining the trust guarantees of a blockchain.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          This uptime monitor is a real-world example of what Intelligent
          Contracts make possible: a decentralized application that reads live
          data from external services and stores verified results on-chain — something impossible with traditional smart contracts.
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        {icon}
        <div>
          <h2
            className="text-xl font-semibold text-white"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-gray-500">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple/20 text-xs font-bold text-purple">
          {step}
        </span>
        <span className="text-purple">{icon}</span>
      </div>
      <h3 className="mb-2 text-sm font-semibold text-gray-300">{title}</h3>
      <p className="text-xs leading-relaxed text-gray-500">{description}</p>
    </div>
  );
}

function BenefitCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 text-purple">{icon}</div>
      <h3 className="mb-2 text-sm font-semibold text-gray-300">{title}</h3>
      <p className="text-xs leading-relaxed text-gray-500">{description}</p>
    </div>
  );
}
