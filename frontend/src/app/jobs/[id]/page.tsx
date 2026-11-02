import type { Metadata } from "next";
import { BackendGate } from "@/components/jobs/BackendGate";
import { JobDetail } from "@/components/jobs/JobDetail";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <BackendGate>
      <JobDetail id={decodeURIComponent(id)} />
    </BackendGate>
  );
}
