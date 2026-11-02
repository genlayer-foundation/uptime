import type { Metadata } from "next";
import { Card, CardBody, CardFooter, CardHeader, Button, ButtonLink, Field, Input, PageContainer, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "New job" };

// PLACEHOLDER: the jobs workstream replaces this page with the job wizard.
// The disabled form below only shows the primitives (Field, Input, Select,
// Card, Button) in place so the wizard can reuse them.
export default function NewJobPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="New job"
        title="Schedule a job."
        muted="Pick what runs, how often, and fund it."
      />
      <Card className="max-w-2xl">
        <CardHeader title="Step 1 of 3 · What to run" subtitle="The job wizard is on its way." />
        <CardBody className="grid gap-5">
          <Field label="Network" htmlFor="network">
            <Select id="network" disabled defaultValue="bradbury">
              <option value="studio">Studio</option>
              <option value="bradbury">Testnet Bradbury</option>
            </Select>
          </Field>
          <Field label="Contract address" htmlFor="address" help="The contract the job calls, deploys or reads.">
            <Input id="address" disabled placeholder="0x…" className="font-mono" />
          </Field>
        </CardBody>
        <CardFooter>
          <ButtonLink href="/jobs" variant="ghost">
            Cancel
          </ButtonLink>
          <Button disabled>Continue →</Button>
        </CardFooter>
      </Card>
    </PageContainer>
  );
}
