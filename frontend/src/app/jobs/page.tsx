import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink, EmptyState, PageContainer, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Jobs" };

// PLACEHOLDER: the jobs workstream replaces this page with the signed-in
// user's job list (use Table/THead/Tr/Th/Td from @/components/ui).
export default function JobsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Your jobs."
        muted="Every schedule you pay for."
        actions={
          <ButtonLink href="/jobs/new">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New job
          </ButtonLink>
        }
      />
      <EmptyState
        title="No jobs yet"
        action={
          <ButtonLink href="/jobs/new" variant="secondary">
            Create your first job →
          </ButtonLink>
        }
      >
        Sign in to see your jobs. A job runs a call, a deploy or a read on a GenLayer contract on the schedule you set.
      </EmptyState>
    </PageContainer>
  );
}
