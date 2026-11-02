"use client";

// /notifications: the signed-in wallet's alert addresses. Add (one confirmation
// email), resend, set a per-address daily cap, remove. Which job mails which
// address is set per job, in the Alerts section of /jobs/[id].

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyRow, Field, Input, PageContainer, PageHeader, Section, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { useSession } from "@/components/jobs/session";
import { ErrorAlert, Loading, MockBadge, MoneyNotice, SignInGate } from "@/components/jobs/ui";
import { timeAgo } from "@/components/jobs/format";
import { alertsApi, alertsOff, type RecipientView } from "@/lib/alerts/client";
import { JOBS_MOCK } from "@/lib/jobs/client";
import { LIMITS, MAX_RECIPIENTS_PER_WALLET, validateRecipientCap } from "@/lib/mailer/limits";
import { formatGen, readPrices } from "@/lib/pricing";
import { AlertsOffNotice, boundHelp } from "./ui";

export function Notifications() {
  const { me, loading: sessionLoading } = useSession();
  const [recipients, setRecipients] = useState<RecipientView[] | null>(null);
  const [off, setOff] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  /** Children call this after a change; the effect below re-reads the list. */
  const load = useCallback(async () => setTick((t) => t + 1), []);

  useEffect(() => {
    if (sessionLoading || !me?.wallet) return;
    let live = true;
    alertsApi.listRecipients().then(
      (recs) => {
        if (!live) return;
        setRecipients(recs);
        setOff(false);
        setStatus(null);
        setLoadError(null);
      },
      (e) => {
        if (!live) return;
        if (alertsOff(e)) return setOff(true);
        setStatus((e as { status?: number }).status ?? null);
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      live = false;
    };
  }, [sessionLoading, me?.wallet, tick]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Account <MockBadge />
          </span>
        }
        title="Notifications"
        muted="where your alerts go."
        lede="Add up to three email addresses. Each one gets a single confirmation link and receives nothing else until you click it. Choose which jobs mail which address from each job's Alerts section."
      />
      <div className="grid gap-10">
        {sessionLoading ? (
          <Loading />
        ) : !me?.wallet ? (
          <SignInGate what="manage your alert addresses" />
        ) : off ? (
          <AlertsOffNotice />
        ) : status === 401 ? (
          <SignInGate what="manage your alert addresses" />
        ) : loadError ? (
          <ErrorAlert error={loadError} />
        ) : !recipients ? (
          <Loading />
        ) : (
          <>
            <Section title="Addresses" subtitle={`${recipients.length} of ${MAX_RECIPIENTS_PER_WALLET} used, bound to ${me.wallet}.`} divider={false}>
              <RecipientsTable recipients={recipients} onChange={load} />
            </Section>
            {recipients.length < MAX_RECIPIENTS_PER_WALLET && (
              <Section title="Add an address">
                <AddRecipient onAdded={load} />
              </Section>
            )}
            <Section title="What alerts cost">
              <Pricing />
            </Section>
          </>
        )}
      </div>
    </PageContainer>
  );
}

function AddRecipient({ onAdded }: { onAdded: () => Promise<void> }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await alertsApi.addRecipient(email.trim());
      setNotice(res.message);
      setEmail("");
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="grid gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Email address" htmlFor={`${id}-e`} className="min-w-64 flex-1" error={error ?? undefined}>
            <Input id={`${id}-e`} type="email" autoComplete="email" placeholder="you@example.com" value={email} aria-invalid={!!error} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send confirmation link"}
          </Button>
        </form>
        {notice && <Alert tone="success" title={notice}>The link is valid for 24 hours. Check your spam folder if it does not arrive.</Alert>}
        <p className="text-xs text-muted">
          Confirmation emails are free. The address is tied to your wallet; another wallet cannot mail it. Every email carries a one-click unsubscribe that stops
          all Uptime email to that address for good.
        </p>
      </CardBody>
    </Card>
  );
}

function RecipientsTable({ recipients, onChange }: { recipients: RecipientView[]; onChange: () => Promise<void> }) {
  return (
    <Table bordered minWidth={720}>
      <THead>
        <tr>
          <Th>Address</Th>
          <Th>Status</Th>
          <Th>Emails per day</Th>
          <Th>Actions</Th>
        </tr>
      </THead>
      <TBody>
        {recipients.length === 0 && <EmptyRow colSpan={4}>No addresses yet. Add one below.</EmptyRow>}
        {recipients.map((r) => (
          <RecipientRow key={r.id} r={r} onChange={onChange} />
        ))}
      </TBody>
    </Table>
  );
}

function RecipientRow({ r, onChange }: { r: RecipientView; onChange: () => Promise<void> }) {
  const id = useId();
  const [cap, setCap] = useState(String(r.dailyCap));
  const [busy, setBusy] = useState<null | "cap" | "resend" | "remove" | "confirm">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const capCheck = validateRecipientCap(cap);
  const capChanged = capCheck.ok && capCheck.value !== r.dailyCap;

  async function run(kind: Exclude<typeof busy, null>, fn: () => Promise<unknown>, ok?: string) {
    setBusy(kind);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: "ok", text: ok });
      await onChange();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Tr>
      <Td>
        <span className="break-all font-mono text-xs">{r.email}</span>
        <p className="text-xs text-muted">added {timeAgo(r.createdAt)}</p>
      </Td>
      <Td>{r.state === "verified" ? <Badge tone="success">confirmed</Badge> : <Badge tone="warn">waiting for confirmation</Badge>}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-cap`} className="sr-only">
            Emails per day to {r.email}
          </label>
          <Input
            id={`${id}-cap`}
            inputMode="numeric"
            className="h-8 w-20 font-mono"
            aria-invalid={!capCheck.ok}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          {capChanged && (
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("cap", () => alertsApi.setRecipientCap(r.id, capCheck.ok ? capCheck.value : null), "Daily cap saved.")}>
              {busy === "cap" ? "…" : "Save"}
            </Button>
          )}
        </div>
        <p className={capCheck.ok ? "mt-1 text-xs text-muted" : "mt-1 text-xs text-danger-fg"}>
          {capCheck.ok ? `${r.dailyCapDefault ? "Default. " : ""}${boundHelp(LIMITS.perRecipientPerDay)}` : capCheck.error}
        </p>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          {r.state === "pending" && (
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("resend", () => alertsApi.addRecipient(r.email), "If the last link is over 10 minutes old, a new one is on its way.")}>
              {busy === "resend" ? "…" : "Resend link"}
            </Button>
          )}
          {r.state === "pending" && JOBS_MOCK && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => run("confirm", async () => (await import("@/lib/alerts/mock")).mockConfirmRecipient(r.id), "Confirmed (mock).")}
            >
              Simulate the link
            </Button>
          )}
          {confirmRemove ? (
            <>
              <Button size="sm" variant="danger" disabled={!!busy} onClick={() => run("remove", () => alertsApi.removeRecipient(r.id))}>
                {busy === "remove" ? "Removing…" : "Remove, and drop from every job"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" aria-label={`Remove ${r.email}`} onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
            </Button>
          )}
        </div>
        {msg && <p className={msg.tone === "ok" ? "mt-1 text-xs text-success-fg" : "mt-1 text-xs text-danger-fg"}>{msg.text}</p>}
      </Td>
    </Tr>
  );
}

function Pricing() {
  const p = useMemo(() => readPrices(), []);
  const perJobMax = p.emailWei * BigInt(LIMITS.perJobPerDay.default);
  return (
    <Card>
      <CardHeader title="Prices" subtitle="Set by the operator. Shown before anything is charged." actions={<MoneyNotice />} />
      <CardBody className="grid gap-2 text-sm">
        <p>
          <span className="font-mono">{formatGen(p.emailWei)}</span> per alert or digest email on Bradbury, charged to that job&apos;s pool before the email goes out.
          At the default of {LIMITS.perJobPerDay.default} alerts a day, one job&apos;s alerts cost at most <span className="font-mono">{formatGen(perJobMax)}</span> a day.
        </p>
        <p className="text-muted">Studio emails are free, under a daily quota, for allowlisted wallets. Confirmation emails are always free.</p>
        <p className="text-muted">
          Set per-job alert limits and the matching on-chain email allowance from each job&apos;s Alerts section.{" "}
          <Link href="/jobs" className="underline underline-offset-2 hover:text-foreground">
            Your jobs
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
