import Link from "next/link";
import { ArrowRight, Activity } from "lucide-react";
import { ButtonLink, Card, CardGrid, CardGridCell, PageContainer, Section, StatusDot } from "@/components/ui";
import { PRESETS } from "@/components/marketing/presets";

const REPO = "https://github.com/genlayer-foundation/uptime";

const STEPS = [
  {
    title: "Each check is an Intelligent Contract",
    description:
      "You choose what to check and how often. Website, API and AI checks run as Intelligent Contracts on GenLayer, not as a script on our server.",
  },
  {
    title: "Many validators must agree",
    description:
      "A set of independent validators each run the check themselves and must reach consensus on the result before it counts.",
  },
  {
    title: "Recorded on-chain",
    description:
      "The agreed result lands on-chain with its transaction, and Uptime tracks the status and value of every run, so you see when something changes.",
  },
];

const BUILD_YOUR_OWN = [
  {
    title: "Developer Docs",
    description: "Write your own Intelligent Contract, then monitor or schedule it here.",
    links: [{ label: "Docs", href: "https://docs.genlayer.com/" }],
  },
  {
    title: "Boilerplate",
    description: "Start from the GenLayer project boilerplate: contract, tests and a frontend.",
    links: [{ label: "Boilerplate", href: "https://github.com/genlayerlabs/genlayer-project-boilerplate" }],
  },
  {
    title: "This Repo",
    description: "The scheduler, the pool contract and this site are open source.",
    links: [{ label: "GitHub", href: REPO }],
  },
];

function Hero() {
  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          The uptime monitor{" "}
          <span className="text-muted">that can&apos;t lie.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Monitor websites, APIs and smart contracts. Every check is verified independently by many validators, not by
          one server you have to trust.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-6">
          <ButtonLink href="/jobs/new">
            Start monitoring
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </ButtonLink>
          <Link
            href="/examples/bradbury-heartbeat"
            className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
          >
            See a live example
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground transition-colors hover:text-purple"
          >
            GitHub
          </a>
        </div>
      </div>

      {/* the old status strip */}
      <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border pt-6">
        <span className="flex items-center gap-2 text-sm text-muted">
          <StatusDot tone="purple" />
          Testnet Bradbury and Studio
        </span>
        <span className="text-sm text-muted">{PRESETS.length} check types</span>
        <span className="text-sm text-muted">verified by validator consensus</span>
        <span className="text-sm text-muted">results recorded on-chain</span>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <PageContainer>
      <Hero />

      <div className="space-y-12">
        <Section title="What you can monitor" subtitle="Websites, APIs, smart contracts and AI answers, on the schedule you choose.">
          <CardGrid className="sm:grid-cols-2 lg:grid-cols-3">
            {PRESETS.map((p) => (
              <CardGridCell key={p.title}>
                <h3 className="text-sm font-medium text-foreground">{p.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{p.description}</p>
                <p className="mt-4 text-[10px] uppercase tracking-wider text-subtle">{p.networks}</p>
              </CardGridCell>
            ))}
            <CardGridCell className="flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">Schedule anything</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  For power users: schedule any contract call or deploy on GenLayer, and track what it returns.
                </p>
              </div>
              <Link
                href="/jobs/new"
                className="mt-4 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
              >
                Create a job
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </CardGridCell>
          </CardGrid>
        </Section>

        <Section
          id="how-it-works"
          title="How It Works"
          subtitle="Built on GenLayer. Think of it as cron, except no single server decides the result."
        >
          <CardGrid className="sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <CardGridCell key={s.title}>
                <span className="flex h-6 w-6 items-center justify-center rounded border border-border text-xs font-medium text-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-sm font-medium text-foreground">{s.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{s.description}</p>
              </CardGridCell>
            ))}
          </CardGrid>

          <Card className="mt-6 p-4">
            <p className="text-sm text-muted">
              <strong className="text-purple">You fund it, you control it.</strong> On Testnet Bradbury, checks are
              paid in GEN from a pool only you control. Top it up, pause it or withdraw it at any time, even while it is
              paused. The scheduler can spend only within the per-run cap and daily allowance you set, and is never an
              owner. Runs are signed by the Uptime relayer, so an owner-gated contract has to allow the relayer address.
            </p>
          </Card>
        </Section>

        <Section title="Live example" subtitle="A monitor we run ourselves, with every result in public.">
          <Link href="/examples/bradbury-heartbeat" className="block">
            <Card interactive className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Activity className="mt-0.5 h-4 w-4 text-purple" aria-hidden />
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Bradbury Heartbeat</h3>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                      Every hour: deploy a canary contract, fetch a page, and ask questions with known answers on Testnet
                      Bradbury. Graded for correctness, validator agreement and time to decision.
                    </p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                  View results
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </span>
              </div>
            </Card>
          </Link>
        </Section>

        <Section title="Build Your Own" subtitle="Write an Intelligent Contract, then monitor it here.">
          <CardGrid className="sm:grid-cols-3">
            {BUILD_YOUR_OWN.map((card) => (
              <CardGridCell key={card.title}>
                <h3 className="text-sm font-medium text-foreground">{card.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{card.description}</p>
                <div className="mt-4 flex flex-wrap gap-4">
                  {card.links.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
                    >
                      {link.label}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </a>
                  ))}
                </div>
              </CardGridCell>
            ))}
          </CardGrid>
        </Section>
      </div>
    </PageContainer>
  );
}
