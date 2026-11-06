"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { ButtonLink, CardGrid, EmptyRow, EmptyState, PageContainer, PageHeader, Section, Stat, StatusDot, TBody, THead, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { HeartbeatExampleCard } from "@/components/marketing/HeartbeatExampleCard";
import { jobsApi } from "@/lib/jobs/client";
import type { Job, Run } from "@/lib/jobs/types";
import { useSession } from "./session";
import { ErrorAlert, Loading, MockBadge, NetworkBadge, SignInGate } from "./ui";
import { cnRate, pct, passRate, runsSince, timeAgo, timeUntil } from "./format";
import { describeSchedule, nextRun } from "./schedule";

type Row = { job: Job; runs: Run[] | null };

function useJobs(kind: "mine" | "public", enabled: boolean) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      try {
        const jobs = kind === "mine" ? await jobsApi.listJobs() : await jobsApi.listPublicJobs();
        if (!live) return;
        setRows(jobs.map((job) => ({ job, runs: null })));
        // Recent runs per job for last run / pass rate. Few jobs per user; fetched in parallel.
        const runs = await Promise.all(jobs.map((j) => jobsApi.listRuns(j.id, 300).catch(() => [] as Run[])));
        if (live) setRows(jobs.map((job, i) => ({ job, runs: runs[i] })));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load jobs.");
      }
    })();
    return () => {
      live = false;
    };
  }, [kind, enabled]);
  return { rows, error };
}

function jobState(job: Job, last: Run | undefined): { tone: Tone; label: string } {
  if (job.paused) return { tone: "neutral", label: "Paused" };
  if (!last) return { tone: "neutral", label: "Waiting" };
  if (last.pass === null) return { tone: "warn", label: "Running" };
  return last.pass ? { tone: "success", label: "Passing" } : { tone: "danger", label: "Failing" };
}

function JobsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  return (
    <Table bordered minWidth={760}>
      <THead>
        <tr>
          <Th>Job</Th>
          <Th>Status</Th>
          <Th>Last run</Th>
          <Th num>Pass 24h</Th>
          <Th num>Pass 7d</Th>
          <Th>Next run</Th>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={6}>No jobs.</EmptyRow>}
        {rows.map(({ job, runs }) => {
          const last = runs?.[0];
          const r24 = runs ? passRate(runsSince(runs, 86_400_000, now)) : null;
          const r7 = runs ? passRate(runsSince(runs, 7 * 86_400_000, now)) : null;
          const next = job.paused ? null : nextRun(job.schedule, new Date(now));
          const st = jobState(job, last);
          const href = `/jobs/${encodeURIComponent(job.id)}`;
          return (
            <Tr key={job.id} className="cursor-pointer transition-colors hover:bg-surface" onClick={() => router.push(href)}>
              <Td>
                <Link href={href} className="font-medium text-foreground hover:text-purple" onClick={(e) => e.stopPropagation()}>
                  {job.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <NetworkBadge network={job.network} />
                  <span>
                    {describeSchedule(job.schedule)} · {job.steps.length} step{job.steps.length === 1 ? "" : "s"}
                  </span>
                </div>
              </Td>
              <Td>
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone={st.tone} pulse={st.label === "Running"} />
                  {st.label}
                </span>
              </Td>
              <Td className="text-muted">{runs === null ? "…" : last ? timeAgo(last.startedAt, now) : "never"}</Td>
              <Td num className={cnRate(r24, runs === null)}>
                {runs === null ? "…" : pct(r24)}
              </Td>
              <Td num className={cnRate(r7, runs === null)}>
                {runs === null ? "…" : pct(r7)}
              </Td>
              <Td className="text-muted">{next ? timeUntil(next, now) : "—"}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

export function JobsList() {
  const { me, loading } = useSession();
  const signedIn = !!me?.wallet;
  const mine = useJobs("mine", signedIn);
  const pub = useJobs("public", !loading && !signedIn);

  const all = mine.rows ?? [];
  const active = all.filter((r) => !r.job.paused).length;
  const failing = all.filter((r) => !r.job.paused && r.runs?.[0]?.pass === false).length;
  const allRuns = all.flatMap((r) => r.runs ?? []);
  const last24 = runsSince(allRuns, 86_400_000);
  const overall = passRate(last24);

  return (
    <PageContainer>
      <PageHeader
        title="Your jobs."
        muted="Every schedule you pay for."
        lede="Scheduled calls, deploys and reads on Intelligent Contracts on GenLayer, with every run recorded."
        actions={
          <>
            <MockBadge />
            {signedIn && (
              <ButtonLink href="/jobs/new">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New job
              </ButtonLink>
            )}
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : !signedIn ? (
        <div className="grid gap-10">
          <SignInGate what="see and create your jobs" />
          <Section title="Public jobs" subtitle="Jobs their owners chose to share.">
            {pub.error ? <ErrorAlert error={pub.error} /> : !pub.rows ? <Loading /> : <JobsTable rows={pub.rows} />}
          </Section>
        </div>
      ) : mine.error ? (
        <ErrorAlert error={mine.error} />
      ) : !mine.rows ? (
        <Loading />
      ) : mine.rows.length === 0 ? (
        <div className="grid gap-10">
          <EmptyState
            title="No jobs yet"
            action={
              <ButtonLink href="/jobs/new" variant="secondary">
                Create your first job →
              </ButtonLink>
            }
          >
            This wallet has no jobs yet. A job calls, deploys or reads an Intelligent Contract on GenLayer on the schedule
            you set, and records every run here.
          </EmptyState>
          <Section title="Example job" subtitle="Run by Uptime itself, with every result in public.">
            <HeartbeatExampleCard />
          </Section>
        </div>
      ) : (
        <div className="grid gap-8">
          <CardGrid className="grid-cols-1 sm:grid-cols-3">
            <Stat label="Jobs" value={all.length} sub={`${active} active`} />
            <Stat label="Failing now" value={failing} sub={failing ? "last run failed" : "none"} />
            <Stat label="Pass rate 24h" value={pct(overall)} sub={`${last24.length} runs`} empty={overall == null} />
          </CardGrid>
          <JobsTable rows={mine.rows} />
        </div>
      )}
    </PageContainer>
  );
}
