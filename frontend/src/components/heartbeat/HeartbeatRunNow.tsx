"use client";

// "Run now" on the Bradbury Heartbeat page: the public Heartbeat job, run once
// from the visitor's wallet. Its graded probes are operator-only on the frozen
// contract, so a visitor's run is the canary deploy (lib/jobs/manualPlan.ts).
// The run lands in the job's history, linked below the button.

import Link from "next/link";
import { useEffect, useState } from "react";
import { RunNow } from "@/components/jobs/RunNow";
import { jobsApi } from "@/lib/jobs/client";
import type { Job } from "@/lib/jobs/types";

export function HeartbeatRunNow() {
  const [job, setJob] = useState<Job | null>(null);
  const [ran, setRan] = useState(false);
  useEffect(() => {
    jobsApi
      .listPublicJobs()
      .then((jobs) => setJob(jobs.find((j) => j.preset === "heartbeat") ?? null))
      .catch(() => setJob(null));
  }, []);
  if (!job) return null;
  return (
    <div className="grid gap-1">
      <RunNow job={job} heartbeat onDone={() => setRan(true)} />
      {ran && (
        <Link href={`/jobs/${job.id}`} className="text-xs text-muted underline hover:text-foreground">
          See it in the run history
        </Link>
      )}
    </div>
  );
}
