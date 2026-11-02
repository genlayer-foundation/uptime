"use client";

// Renders the jobs pages only when this server can serve them. Until the jobs
// API is deployed and configured, every jobs page shows a plain notice instead
// of erroring, and nothing that could sign or send a transaction is rendered.

import { useEffect, useState, type ReactNode } from "react";
import { ButtonLink, EmptyState, PageContainer } from "@/components/ui";
import { jobsBackendState, type BackendState } from "@/lib/jobs/client";
import { Loading } from "./ui";

const COPY: Record<Exclude<BackendState, "ready">, { title: string; body: string }> = {
  missing: {
    title: "Jobs are coming soon",
    body: "Scheduling your own jobs needs the Uptime backend, which is not deployed yet.",
  },
  not_configured: {
    title: "Jobs are not configured yet",
    body: "The Uptime backend is deployed but this server has no database or session key configured yet, so sign-in and jobs are switched off.",
  },
};

export function BackendGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState | null>(null);
  useEffect(() => {
    let live = true;
    jobsBackendState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  if (state === null) {
    return (
      <PageContainer className="pt-10">
        <Loading />
      </PageContainer>
    );
  }
  if (state !== "ready") {
    const c = COPY[state];
    return (
      <PageContainer className="pt-16">
        <EmptyState
          title={c.title}
          action={
            <ButtonLink href="/examples/bradbury-heartbeat" variant="secondary">
              See the example job
            </ButtonLink>
          }
        >
          {c.body} Until then you can follow the Bradbury Heartbeat example job.
        </EmptyState>
      </PageContainer>
    );
  }
  return <>{children}</>;
}
