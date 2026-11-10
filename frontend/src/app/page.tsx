import Link from "next/link";
import { ArrowRight, CalendarClock, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { ButtonLink, PageContainer, Section, StatusDot } from "@/components/ui";
import { SHOWCASE } from "@/components/jobs/tasks";
import { Ago } from "@/components/heartbeat/Ago";
import { verdict } from "@/components/heartbeat/verdict";
import { getPending, getResults, storeConfigured } from "@/lib/heartbeat/store";
import { runsSummary, type RunsSummary } from "@/lib/heartbeat/summary";
import { formatGen, readPrices } from "@/lib/pricing";

// Server-rendered, refreshed at most once a minute. The live strip reads the
// Heartbeat's store directly (same data as GET /api/heartbeat); if that fails
// it falls back to a plain link, never to made-up numbers.
export const revalidate = 60;

const HEARTBEAT = "/examples/bradbury-heartbeat";

async function loadRuns(): Promise<RunsSummary | null> {
  if (!storeConfigured()) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const work = Promise.all([getResults(nowSec - 168 * 3600), getPending()]).then(([r, p]) => runsSummary(r, p, nowSec));
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** Live proof: our own hourly job. Misses on our side are always shown. */
function ProofStrip({ runs }: { runs: RunsSummary | null }) {
  const v = verdict(runs);
  const done = runs ? runs.passed + runs.failed + runs.missed : 0;
  return (
    <Link
      href={HEARTBEAT}
      className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border px-4 py-3 text-sm text-muted transition-colors hover:border-border-strong hover:bg-surface"
    >
      <span className="flex items-center gap-2 font-medium text-foreground">
        <StatusDot tone={v?.tone ?? "purple"} />
        Live example
      </span>
      {runs && done > 0 ? (
        <>
          <span>
            <span className="font-mono text-foreground">
              {runs.passed}/{done}
            </span>{" "}
            runs passed
          </span>
          <span>
            <span className="font-mono text-foreground">{runs.missed}</span> missed by us
          </span>
          {runs.lastRunAt ? (
            <span>
              last run <Ago sec={runs.lastRunAt} />
            </span>
          ) : null}
        </>
      ) : (
        <span>Our hourly check on GenLayer Testnet Bradbury</span>
      )}
    </Link>
  );
}

const STEPS: { icon: LucideIcon; title: string; line: string }[] = [
  { icon: CalendarClock, title: "Schedule a check", line: "A site, an API or a question." },
  { icon: Users, title: "Validators decide", line: "GenLayer's independent validators agree." },
  { icon: ShieldCheck, title: "You get proof", line: "Recorded on-chain for anyone to check." },
];

function faqs(runFee: string) {
  return [
    { q: "Does it replace my monitoring?", a: "No. It checks every 5 minutes at most. Use it for numbers others must trust." },
    { q: "Can Uptime fake a result?", a: "Not the votes: validators decide every transaction, on-chain. The pass or fail label is ours, computed from those transactions and a read from one node. Each run lists its transaction hashes, so you can check them yourself." },
    { q: "What does it cost?", a: `${runFee} per run plus network fees, within your limits. Charging is off during the beta.` },
    { q: "Is my GEN safe?", a: "Testnet only, not audited. Only you can withdraw your budget." },
  ];
}

export default async function Home() {
  const runs = await loadRuns();
  return (
    <PageContainer>
      <section className="py-12 sm:py-16">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Built on GenLayer</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">Uptime you can prove.</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted">
          Independent validators check your site or API and record the result for anyone to verify.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <ButtonLink href="/jobs/new">
            Start a check
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </ButtonLink>
          <MoreLink href={HEARTBEAT}>See a live check</MoreLink>
        </div>
      </section>

      <ProofStrip runs={runs} />

      <div className="mt-14 space-y-14">
        <Section id="how-it-works" title="How it works">
          <ol className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.title}>
                <s.icon className="h-8 w-8 text-purple" strokeWidth={1.5} aria-hidden />
                <h3 className="mt-4 text-sm font-medium text-foreground">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.line}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="What you can check">
          <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {SHOWCASE.map((c) => (
              <li key={c.title} className="bg-background">
                <Link href={`/jobs/new?task=${c.task}`} className="block h-full p-4 transition-colors hover:bg-surface">
                  <span className="text-sm font-medium text-foreground">{c.title}</span>
                  <span className="mt-1 block text-sm text-muted">{c.line}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">
            <span className="font-medium text-foreground">Next:</span> SLIs and SLAs your customers can verify.
          </p>
        </Section>

        <Section title="Questions">
          <dl className="grid gap-6 sm:grid-cols-2">
            {faqs(formatGen(readPrices().runFeeWei)).map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-medium text-foreground">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </PageContainer>
  );
}
