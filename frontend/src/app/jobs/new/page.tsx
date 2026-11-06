import type { Metadata } from "next";
import { Suspense } from "react";
import { BackendGate } from "@/components/jobs/BackendGate";
import { JobWizard } from "@/components/jobs/JobWizard";

export const metadata: Metadata = { title: "Start a check" };

export default function NewJobPage() {
  return (
    <BackendGate>
      {/* useSearchParams (?task=website) needs a boundary */}
      <Suspense>
        <JobWizard />
      </Suspense>
    </BackendGate>
  );
}
