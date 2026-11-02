import Link from "next/link";
import { ArrowRight, Activity } from "lucide-react";
import { ButtonLink, Card, CardGrid, CardGridCell, PageContainer, Section, StatusDot } from "@/components/ui";
import { PRESETS } from "@/components/marketing/presets";

const REPO = "https://github.com/genlayer-foundation/uptime";

const STEPS = [
  {
    title: "Pick what to run",
    description:
      "Choose a preset or point at your own contract on Studio or Testnet Bradbury, then set how often it runs.",
  },
  {
    title: "Fund it in GEN",
    description:
      "Lock GEN in the job's pool and set a per-run cap and a per-period allowance. The scheduler can draw only within them.",
  },
  {
    title: "Track every result",
    description:
      "Each run is recorded with its status, transaction and returned value, so you can see when something changes.",
  },
];

const BUILD_YOUR_OWN = [
  {
    title: "Developer Docs",
    description: "Write your own Intelligent Contract, then put it on a schedule here.",
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
          A cron job for Intelligent Contracts.{" "}
          <span className="text-muted">You pay in GEN.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Schedule any call, deploy or read on any GenLayer contract, on Studio or Testnet Bradbury, and track every
          result. Your GEN stays in a pool you own: pause it or withdraw it at any time.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-6">
          <ButtonLink href="/jobs/new">
            Create a job
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </ButtonLink>
          <Link
            href="/examples/bradbury-heartbeat"
            className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
          >
            See an example job
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
          Studio and Testnet Bradbury
        </span>
        <span className="text-sm text-muted">{PRESETS.length} job types</span>
        <span className="text-sm text-muted">paid in GEN</span>
        <span className="text-sm text-muted">every result tracked</span>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <PageContainer>
      <Hero />

      <div className="space-y-12">
        <Section title="What you can schedule" subtitle="Any GenLayer contract, any method, on the schedule you choose.">
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
                <h3 className="text-sm font-medium text-foreground">Something else?</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  If it is a call, a deploy or a read on a GenLayer contract, it can run on a schedule.
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

        <Section id="how-it-works" title="How It Works" subtitle="Three steps, and you can stop at any time.">
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
              <strong className="text-purple">Your GEN, your switch.</strong> Only you can top up, pause or withdraw a
              job&apos;s pool, and a withdrawal works even while it is paused. The scheduler is a spender with an
              allowance you set, never an owner. Runs are signed by the Uptime relayer, so an owner-gated contract has to
              allow the relayer address.
            </p>
          </Card>
        </Section>

        <Section title="Example job" subtitle="One job we run ourselves, with its results in public.">
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

        <Section title="Build Your Own" subtitle="Intelligent Contracts to put on a schedule.">
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
