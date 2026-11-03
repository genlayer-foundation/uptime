"use client";

// Jobs-specific bits on top of the shared primitives in @/components/ui.

import { TriangleAlert } from "lucide-react";
import { Alert, Badge, Button, EmptyState, StatusDot, type Tone } from "@/components/ui";
import type { Network, StepRun } from "@/lib/jobs/types";
import { JOBS_MOCK } from "@/lib/jobs/client";
import { useSession } from "./session";
import { statusTone } from "./format";

/** Required on every surface that moves GEN. */
export function MoneyNotice() {
  return (
    <p role="note" className="inline-flex items-center gap-1.5 rounded-lg border border-warn-border bg-banner-bg/40 px-2.5 py-1 text-xs font-medium text-warn-fg">
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      Not audited — testnet only.
    </p>
  );
}

/** The user-facing name of a GenLayer network. */
export function networkName(network: Network): string {
  return network === "bradbury" ? "GenLayer Testnet Bradbury" : "GenLayer Studio";
}

export function NetworkBadge({ network }: { network: Network }) {
  return <Badge tone={network === "bradbury" ? "purple" : "neutral"}>{networkName(network)}</Badge>;
}

export function MockBadge() {
  if (!JOBS_MOCK) return null;
  return (
    <Badge tone="warn" title="NEXT_PUBLIC_JOBS_MOCK=1: data is generated in the browser">
      Mock data
    </Badge>
  );
}

const TONE: Record<ReturnType<typeof statusTone>, Tone> = { ok: "success", bad: "danger", warn: "warn", muted: "neutral" };

export function StepStatus({ s }: { s: StepRun }) {
  const t = TONE[statusTone(s.status)];
  return (
    <span className="mr-2 inline-flex items-center gap-1 whitespace-nowrap text-xs" title={s.error ?? s.status}>
      <StatusDot tone={t} pulse={s.status === "PENDING"} />
      <span className="font-mono text-muted">{s.stepId}</span>
      <span className={t === "danger" ? "text-danger-fg" : t === "warn" ? "text-warn-fg" : "text-foreground"}>{s.status.toLowerCase()}</span>
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted">
      <StatusDot pulse /> {label}
    </p>
  );
}

export function ErrorAlert({ error }: { error: string }) {
  return (
    <Alert tone="danger" title="Something went wrong">
      {error}
    </Alert>
  );
}

/** Shown in place of a page that needs a session. */
export function SignInGate({ what }: { what: string }) {
  const { me, busy, error, signIn } = useSession();
  return (
    <EmptyState
      title="Sign in to continue"
      action={
        <Button onClick={signIn} disabled={busy || me?.ready === false}>
          {busy ? "Check your wallet…" : "Connect wallet & sign in"}
        </Button>
      }
    >
      Connect a wallet and sign a message to {what}. Signing sends no transaction.
      {me?.ready === false && <p className="mt-2 text-warn-fg">Sign-in is not configured on this server yet.</p>}
      {error && <p className="mt-2 text-danger-fg">{error}</p>}
    </EmptyState>
  );
}
