"use client";

// Renders the jobs pages only when this server has the jobs backend. Until it
// is deployed, every jobs page shows a plain "coming soon" state instead of
// erroring, and nothing that could sign or send a transaction is rendered.

import { useEffect, useState, type ReactNode } from "react";
import { ButtonLink, EmptyState, PageContainer } from "@/components/ui";
import { jobsBackendDeployed } from "@/lib/jobs/client";
import { Loading } from "./ui";

export function BackendGate({ children }: { children: ReactNode }) {
  const [deployed, setDeployed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    jobsBackendDeployed().then((d) => live && setDeployed(d));
    return () => {
      live = false;
    };
  }, []);
  if (deployed === null) {
    return (
      <PageContainer className="pt-10">
        <Loading />
      </PageContainer>
    );
  }
  if (!deployed) {
    return (
      <PageContainer className="pt-16">
        <EmptyState
          title="Jobs are coming soon"
          action={
            <ButtonLink href="/examples/bradbury-heartbeat" variant="secondary">
              See the example job
            </ButtonLink>
          }
        >
          Scheduling your own jobs needs the Uptime backend, which is not deployed yet. Until then you can follow the
          Bradbury Heartbeat example job.
        </EmptyState>
      </PageContainer>
    );
  }
  return <>{children}</>;
}
