import type { Metadata } from "next";
import { JobsList } from "@/components/jobs/JobsList";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return <JobsList />;
}
