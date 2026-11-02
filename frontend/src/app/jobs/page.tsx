import type { Metadata } from "next";
import { BackendGate } from "@/components/jobs/BackendGate";
import { JobsList } from "@/components/jobs/JobsList";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <BackendGate>
      <JobsList />
    </BackendGate>
  );
}
