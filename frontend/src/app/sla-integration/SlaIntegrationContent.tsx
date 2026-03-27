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
          Combine on-chain uptime evidence with{" "}
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

      {/* The Entities */}
      <Section title="Who's Involved">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <div className="bg-background p-5">
            <p className="text-xs text-purple font-mono">Provider</p>
            <h3 className="mt-1 text-sm font-medium text-foreground">Matter Labs</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Provides ZKSync bridge infrastructure. GenLayer Labs pays
              them for maintaining bridge uptime.
            </p>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">
              Services covered
            </p>
            <p className="text-xs text-foreground">ZKSync Bridge</p>
          </div>
          <div className="bg-background p-5">
            <p className="text-xs text-purple font-mono">Provider + Customer</p>
            <h3 className="mt-1 text-sm font-medium text-foreground">GenLayer Labs</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Operates the Asimov, Bradbury, and Studionet networks.
              Pays Matter Labs. Gets paid by GenLayer Foundation.
            </p>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">
              Services covered
            </p>
            <p className="text-xs text-foreground">
              Asimov RPC, Bradbury RPC, Studionet Node
            </p>
          </div>
          <div className="bg-background p-5">
            <p className="text-xs text-purple font-mono">Customer</p>
            <h3 className="mt-1 text-sm font-medium text-foreground">GenLayer Foundation</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Pays GenLayer Labs for infrastructure uptime across all
              RPC endpoints and block explorers.
            </p>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">
              Services covered
            </p>
            <p className="text-xs text-foreground">
              All RPCs + Explorers
            </p>
          </div>
        </div>
      </Section>

      {/* Deployed Contracts */}
      <Section
        title="Deployed Contracts"
        subtitle="SLA Verifier and two agreements on Studionet"
      >
        <div className="space-y-2">
          <ContractRow
            label="SLA Verifier"
            address="0x8D926888B6781d9C987dB89693E771D702366D85"
            description="Base verification contract (10% protocol fee)"
          />
          <ContractRow
            label="SLA-001"
            address="0x2A3139E97262F25DFd0B039D55cdD99c1C192B36"
            description="GenLayer Labs → Matter Labs (ZKSync bridge)"
          />
          <ContractRow
            label="SLA-002"
            address="0x90287aec8e7028EF57Ad58fb9060a7Bdb3D5d548"
            description="GenLayer Foundation → GenLayer Labs (RPCs + Explorers)"
          />
        </div>
      </Section>

      {/* The Two Agreements */}
      <Section
        title="Agreement Details"
        subtitle="Terms for each SLA contract"
      >
        <div className="space-y-4">
          <AgreementCard
            id="SLA-001"
            customer="GenLayer Labs"
            provider="Matter Labs"
            services={["zksync_bridge"]}
            target="99.50%"
            payment="5,000 USDC/month"
            penalty="Tiered"
            description="GenLayer Labs pays Matter Labs for ZKSync bridge availability.
              Tiered penalties: 10% for minor breach (< 0.5% shortfall),
              25% for major (0.5-2%), 50% for critical (2-5%), 100% for severe (> 5%)."
          />
          <AgreementCard
            id="SLA-002"
            customer="GenLayer Foundation"
            provider="GenLayer Labs"
            services={[
              "studionet_rpc",
              "asimov_rpc",
              "bradbury_rpc",
              "explorer_studio",
              "explorer_asimov",
              "explorer_bradbury",
            ]}
            target="99.90%"
            payment="20,000 USDC/month"
            penalty="Linear"
            description="GenLayer Foundation pays GenLayer Labs for all RPC and
              Explorer infrastructure. Linear penalty: payment reduced
              proportionally to the shortfall of the worst-performing service."
          />
        </div>
      </Section>

      {/* How Settlement Works */}
      <Section title="How Settlement Works">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <StepCard
            step={1}
            title="Period ends"
            description="At the end of each billing period, either party can call
              settle_period() on the SLA Agreement contract. The contract
              reads uptime data directly from the UptimeMonitor."
          />
          <StepCard
            step={2}
            title="Penalty calculated"
            description="The SLA Verifier calculates the penalty based on the
              agreed model (linear, tiered, or full). A 10% protocol fee
              is taken from any penalty amount."
          />
          <StepCard
            step={3}
            title="Dispute or accept"
            description="If either party disagrees, they open a case in Internet
              Court. The court reads internet_court_summary() from the
              SLA contract and evaluates the on-chain evidence."
          />
        </div>
      </Section>

      {/* Penalty Models */}
      <Section
        title="Penalty Models"
        subtitle="Each agreement chooses one model at creation"
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="p-4 text-left text-xs font-medium text-muted">Model</th>
                <th className="p-4 text-left text-xs font-medium text-muted">How it works</th>
                <th className="p-4 text-left text-xs font-medium text-muted">Example</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="p-4 text-sm font-medium text-foreground">Linear</td>
                <td className="p-4 text-sm text-muted">
                  Penalty scales proportionally to the shortfall
                </td>
                <td className="p-4 font-mono text-xs text-muted">
                  Target 99.50%, measured 99.00% = 0.50% shortfall.
                  Penalty = payment x 50/9950 = ~0.5%
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="p-4 text-sm font-medium text-foreground">Tiered</td>
                <td className="p-4 text-sm text-muted">
                  Fixed penalty brackets based on severity
                </td>
                <td className="p-4 font-mono text-xs text-muted">
                  {'< 0.50% shortfall: 10% penalty'}
                  <br />
                  {'0.50-2.00%: 25% penalty'}
                  <br />
                  {'2.00-5.00%: 50% penalty'}
                  <br />
                  {'> 5.00%: 100% penalty'}
                </td>
              </tr>
              <tr>
                <td className="p-4 text-sm font-medium text-foreground">Full</td>
                <td className="p-4 text-sm text-muted">
                  Any breach = full payment withheld
                </td>
                <td className="p-4 font-mono text-xs text-muted">
                  Target 99.50%, measured 99.49% = full refund
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Internet Court Dispute Example */}
      <Section
        title="Dispute Example"
        subtitle="What happens when GenLayer Foundation disputes SLA-002"
      >
        <div className="rounded-lg border border-border">
          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Statement
            </p>
            <p className="mt-2 text-sm text-foreground">
              &quot;GenLayer Labs failed to maintain 99.90% uptime on Asimov RPC
              during March 2026, as defined in SLA Agreement SLA-002 deployed at{" "}
              <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">
                0x90287aec...D5d548
              </code>{" "}
              on Studionet.&quot;
            </p>
          </div>

          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Guidelines
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>
                Call <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">check_compliance(720)</code> on
                the SLA Agreement contract (720 checks = 30 days at 1/hour)
              </li>
              <li>
                Read <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">internet_court_summary()</code> for
                full terms and settlement history
              </li>
              <li>
                Verdict is TRUE (breach occurred) if any covered service measured below 9990 bps
              </li>
            </ul>
          </div>

          <div className="border-b border-border p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Evidence
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted">Foundation submits</p>
                <div className="mt-1.5 rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
                  <p>SLA Contract: 0x90287aec...D5d548</p>
                  <p>Method: check_compliance(720)</p>
                  <p>Asimov RPC uptime: 98.75%</p>
                  <p>Target: 99.90%</p>
                  <p>Shortfall: 1.15%</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">GenLayer Labs responds</p>
                <div className="mt-1.5 rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
                  <p>Same contract, same data.</p>
                  <p>Both parties read identical</p>
                  <p>immutable on-chain records.</p>
                  <p>No conflicting evidence.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Verdict
            </p>
            <div className="mt-3 flex items-center gap-4">
              <VerdictOption label="True" description="Breach occurred" active />
              <VerdictOption label="False" description="SLA met" />
              <VerdictOption label="Undetermined" description="Insufficient data" />
            </div>
            <p className="mt-3 text-xs text-muted">
              Linear penalty applied: $20,000 x (115/9990) = $230.23 penalty.
              10% protocol fee: $23.02. Net payout to GenLayer Labs: $19,769.77.
            </p>
          </div>
        </div>
      </Section>

      {/* Contract Architecture */}
      <Section
        title="Contract Architecture"
        subtitle="Two contracts work together"
      >
        <div className="rounded-lg border border-border bg-surface p-6 font-mono text-xs leading-relaxed text-muted">
          <pre>{`┌──────────────────┐
│  UptimeMonitor   │  Source of truth for all health checks
│  (existing)      │  get_uptime_stats(service_id, last_n)
└────────┬─────────┘
         │ reads
         v
┌──────────────────┐
│  SLA Verifier    │  Base contract that verifies uptime claims
│  (new)           │  calculate_penalty(payment, measured, target, model)
│                  │  Takes 10% protocol fee on penalties
└────────┬─────────┘
         │ used by
         v
┌──────────────────┐     ┌──────────────────┐
│  SLA Agreement   │     │  SLA Agreement   │
│  SLA-001         │     │  SLA-002         │
│  GL Labs -> ML   │     │  GL Found -> Labs│
│  ZKSync bridge   │     │  All RPCs + Expl │
│  Tiered penalty  │     │  Linear penalty  │
└──────────────────┘     └──────────────────┘
         │                        │
         └───── settleable by ────┘
                     │
              ┌──────v──────────┐
              │ Internet Court  │  Reads internet_court_summary()
              │ (dispute res.)  │  AI jury verifies on-chain data
              └─────────────────┘`}</pre>
        </div>
      </Section>

      {/* Future: SLA Templates */}
      <Section
        title="Future Work"
        subtitle="Planned features for the SLA system"
      >
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">SLA Templates</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Standardized SLA templates, similar to software licenses (MIT, BSD, Apache).
              Pick a template for your use case: Public API, Infrastructure, Data Pipeline,
              Bridge. Each comes with reasonable defaults for target uptime, penalty model,
              and payment curves.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Composable verification</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              The SLA Verifier is the base layer. Any contract can call it to verify uptime
              claims. Build custom SLA logic on top: multi-party agreements, escrow with
              auto-release, insurance pools. The verifier takes a 10% fee, creating a
              sustainable revenue model for developers.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Payment curves</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Beyond linear and tiered: exponential penalties, grace periods, bonus
              payments for exceeding SLA targets, time-weighted penalties (downtime
              during peak hours costs more), and rolling window calculations.
            </p>
          </div>
          <div className="bg-background p-5">
            <h3 className="text-sm font-medium text-foreground">Auto-settlement</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Automatic period settlement via cron. At the end of each billing cycle,
              the contract settles itself: reads uptime, calculates penalties, and
              triggers payment. Disputes go to Internet Court automatically if the
              penalty exceeds a configurable threshold.
            </p>
          </div>
        </div>
      </Section>

      {/* How to Create Your Own */}
      <Section title="Create Your Own SLA">
        <div className="space-y-4 text-sm text-muted">
          <p>
            Deploy an SLA Agreement contract with your terms. You need:
          </p>
          <div className="rounded-lg border border-border bg-surface p-4 font-mono text-xs">
            <p className="text-muted">// Constructor arguments</p>
            <p>agreement_id: &quot;MY-SLA-001&quot;</p>
            <p>customer_name: &quot;Your Company&quot;</p>
            <p>provider_name: &quot;Service Provider&quot;</p>
            <p>customer_address: 0x...</p>
            <p>provider_address: 0x...</p>
            <p>sla_verifier_address: 0x8D926888...66D85</p>
            <p>uptime_monitor_address: 0x1AE5Eb9a...f2573</p>
            <p>service_ids_json: &apos;[&quot;studionet_rpc&quot;, &quot;asimov_rpc&quot;]&apos;</p>
            <p>target_uptime_bps: 9950  // 99.50%</p>
            <p>penalty_model: &quot;tiered&quot;</p>
            <p>payment_schedule: &quot;monthly&quot;</p>
            <p>base_payment_monthly: 10000  // in smallest unit</p>
            <p>base_payment_yearly: 100000</p>
            <p>effective_from: 1711929600  // Unix timestamp</p>
            <p>effective_until: 0  // 0 = no end date</p>
          </div>
          <p>
            Once deployed, both parties can call{" "}
            <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">settle_period()</code>{" "}
            at the end of each billing cycle. If there is a dispute, either party opens a case
            in Internet Court pointing to the contract address.
          </p>
        </div>
      </Section>

      {/* Are You An Agent? */}
      <Section
        title="Are You An Agent?"
        subtitle="Deploy your own SLA contract programmatically"
      >
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-muted">
            If you are an AI agent or developer tool, read the full deployment
            guide with step-by-step CLI commands, constructor arguments, and
            examples.
          </p>
          <a
            href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/SKILL.md"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-purple"
          >
            Read SKILL.md
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <div className="mt-4 rounded border border-border bg-surface p-3 font-mono text-xs text-muted">
            <p className="text-muted">
              # Quick start: deploy an SLA agreement on Studionet (free, no tokens needed)
            </p>
            <p className="mt-1">genlayer network set studionet</p>
            <p>genlayer account create --name sla-deployer --password &quot;&quot;</p>
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
        <a
          href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/sla_verifier.py"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          SLA Verifier source
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/sla_agreement.py"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          SLA Agreement source
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
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

function AgreementCard({
  id,
  customer,
  provider,
  services,
  target,
  payment,
  penalty,
  description,
}: {
  id: string;
  customer: string;
  provider: string;
  services: string[];
  target: string;
  payment: string;
  penalty: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{id}</h3>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">
              Active
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {customer} pays {provider}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-foreground">{payment}</p>
          <p className="text-xs text-muted">Target: {target}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {services.map((s) => (
          <span
            key={s}
            className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-mono text-muted"
          >
            {s}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{description}</p>
      <p className="mt-2 text-[10px] uppercase tracking-wider text-muted">
        Penalty model: {penalty}
      </p>
    </div>
  );
}

function ContractRow({
  label,
  address,
  description,
}: {
  label: string;
  address: string;
  description: string;
}) {
  const explorerUrl = `https://explorer-studio.genlayer.com/contracts/${address}`;
  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-surface"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <code className="font-mono text-xs text-muted">
            {address.slice(0, 8)}...{address.slice(-4)}
          </code>
        </div>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-muted" />
    </a>
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
