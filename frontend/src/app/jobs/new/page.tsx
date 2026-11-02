import type { Metadata } from "next";
import { JobWizard } from "@/components/jobs/JobWizard";

export const metadata: Metadata = { title: "New job" };

export default function NewJobPage() {
  return <JobWizard />;
}
