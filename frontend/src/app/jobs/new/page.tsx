import type { Metadata } from "next";
import { BackendGate } from "@/components/jobs/BackendGate";
import { JobWizard } from "@/components/jobs/JobWizard";

export const metadata: Metadata = { title: "New job" };

export default function NewJobPage() {
  return (
    <BackendGate>
      <JobWizard />
    </BackendGate>
  );
}
