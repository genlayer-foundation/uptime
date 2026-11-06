"use client";

// "All jobs (admin)": every job, for operators in UPTIME_ADMIN_WALLETS. The
// gate is server-side (GET /api/jobs?all=1 answers 403 to anyone else); /api/me's
// isAdmin only decides whether to ask, so nothing renders for non-admins.

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageContainer, Section, StatusDot, TBody, THead, Table, Td, Th, Tr, EmptyRow } from "@/components/ui";
import { apiCall } from "@/lib/jobs/client";
import { jobPhase, PHASE, runVerdict } from "@/lib/jobs/display";
import type { Job, Run } from "@/lib/jobs/types";
import { shortHex, timeAgo } from "./format";
import { describeSchedule } from "./schedule";
import { useSession } from "./session";
import { ErrorAlert, Loading, NetworkBadge } from "./ui";

type AllJobs = { jobs: Job[]; meta: Record<string, { lastRun: Run | null } | undefined> };

export function AdminJobs() {
  const { me } = useSession();
  const admin = !!me?.wallet && me.isAdmin === true;
  const [data, setData] = useState<AllJobs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!admin) return;
    let live = true;
    apiCall<AllJobs>("GET", "/api/jobs?all=1")
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load all jobs."));
    return () => {
      live = false;
    };
  }, [admin]);

  if (!admin) return null;
  return (
    <PageContainer>
      <Section title="All jobs (admin)" subtitle="Every job on Uptime. Visible to operators only.">
        {error ? (
          <ErrorAlert error={error} />
        ) : !data ? (
          <Loading />
        ) : (
          <Table bordered minWidth={860}>
            <THead>
              <tr>
                <Th>Job</Th>
                <Th>Owner</Th>
                <Th>Network</Th>
                <Th>State</Th>
                <Th>Schedule</Th>
                <Th>Last run</Th>
              </tr>
            </THead>
            <TBody>
              {data.jobs.length === 0 && <EmptyRow colSpan={6}>No jobs.</EmptyRow>}
              {data.jobs.map((job) => {
                const phase = PHASE[jobPhase(job)];
                const last = data.meta[String(job.id)]?.lastRun ?? null;
                const verdict = last ? runVerdict(last) : null;
                return (
                  <Tr key={job.id}>
                    <Td>
                      <Link href={`/jobs/${encodeURIComponent(job.id)}`} className="font-medium text-foreground hover:text-purple">
                        {job.name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs text-muted" title={job.owner}>
                      {shortHex(job.owner, 4)}
                    </Td>
                    <Td>
                      <NetworkBadge network={job.network} />
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <StatusDot tone={phase.tone} />
                        {phase.label}
                      </span>
                    </Td>
                    <Td className="text-muted">{describeSchedule(job.schedule)}</Td>
                    <Td className="text-muted">
                      {last && verdict ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusDot tone={verdict.tone} pulse={verdict.pulse} />
                          {verdict.label} · {timeAgo(last.startedAt, now)}
                        </span>
                      ) : (
                        "never"
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>
    </PageContainer>
  );
}
