import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Job" };

// PLACEHOLDER: the jobs workstream replaces this page with the job detail
// (schedule, pool balance, runs table). Keep the back link and container.
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer>
      <Link
        href="/jobs"
        className="mt-8 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        All jobs
      </Link>
      <PageHeader eyebrow="Job" title={<span className="break-all font-mono text-2xl sm:text-3xl">{id}</span>} />
      <EmptyState title="Job details are on their way">
        This page will show the job&apos;s schedule, its pool balance and every run with its result.
      </EmptyState>
    </PageContainer>
  );
}
