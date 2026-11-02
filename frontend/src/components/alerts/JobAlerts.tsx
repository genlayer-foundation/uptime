"use client";

// The "Alerts" section of /jobs/[id]: the owner's self-serve rule for one job
// (triggers, recipients, limits) and, on Bradbury, the on-chain email allowance
// that makes the same limits a hard cap. Prices come from lib/pricing.ts.

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Input } from "@/components/ui";
import { MoneyNotice, ErrorAlert, Loading } from "@/components/jobs/ui";
import { readMailerAllowance, setMailerAllowance, poolContract, type MailerAllowance } from "@/components/jobs/pool";
import { shortHex } from "@/components/jobs/format";
import { alertsApi, alertsOff, type RecipientView } from "@/lib/alerts/client";
import { JOBS_MOCK } from "@/lib/jobs/client";
import type { Job } from "@/lib/jobs/types";
import { LIMITS, defaultRuleSettings, validateRuleSettings, type FieldErrors, type RuleSettings } from "@/lib/mailer/limits";
import { alertsMaxPerDayWei, formatGen, mailerAllowanceTerms, readPrices } from "@/lib/pricing";
import { AlertsOffNotice, CheckRow, boundHelp } from "./ui";

/** Number fields are edited as text so a half-typed value is not coerced. */
type Form = Omit<RuleSettings, "failAfter" | "perJobPerDay" | "cooldownMin"> & { failAfter: string; perJobPerDay: string; cooldownMin: string };

const toForm = (r: RuleSettings): Form => ({ ...r, failAfter: String(r.failAfter), perJobPerDay: String(r.perJobPerDay), cooldownMin: String(r.cooldownMin) });

const TRIGGERS = [
  { key: "onFailure", label: "A run fails", help: "A step did not reach Accepted: timeout, undetermined, submit failure or error." },
  { key: "onAssertion", label: "An assertion fails", help: "Every step was accepted, but one of the job's assertions did not hold." },
  { key: "onRecovery", label: "The job recovers", help: "The first passing run after a failure alert went out. Not held back by the cooldown." },
  { key: "digest", label: "Daily digest", help: "One summary per address per day: runs, passes, failures, last failure." },
] as const;

export function JobAlerts({ job, wallet }: { job: Job; wallet: string | null }) {
  const id = useId();
  const prices = useMemo(() => readPrices(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<RuleSettings | null>(null);
  const [recipients, setRecipients] = useState<RecipientView[] | null>(null);
  const [off, setOff] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<null | "save" | "allowance">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<MailerAllowance | null | undefined>(undefined);
  const bradbury = job.network === "bradbury";

  const load = useCallback(async () => {
    try {
      const [rule, recs] = await Promise.all([alertsApi.getRule(job.id), alertsApi.listRecipients()]);
      const r: RuleSettings = { ...defaultRuleSettings(), ...rule };
      setSaved(r);
      setForm(toForm(r));
      setRecipients(recs);
      setOff(false);
      setLoadError(null);
    } catch (e) {
      if (alertsOff(e)) setOff(true);
      else setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [job.id]);

  const loadAllowance = useCallback(async () => {
    if (!bradbury || !job.poolId || !poolContract()) return setAllowance(null);
    try {
      setAllowance(await readMailerAllowance(job.poolId));
    } catch {
      setAllowance(null);
    }
  }, [bradbury, job.poolId]);

  useEffect(() => {
    void load();
    void loadAllowance();
  }, [load, loadAllowance]);

  const check = form ? validateRuleSettings(form as unknown as Record<string, unknown>) : null;
  const dirty = !!form && !!saved && JSON.stringify(toForm(saved)) !== JSON.stringify(form);
  const verified = recipients?.filter((r) => r.state === "verified") ?? [];

  // What the saved rule can cost, and the allowance that caps it on-chain.
  const effective = check?.ok ? check.value : saved;
  const costArgs = effective ? { perJobPerDay: effective.perJobPerDay, digest: effective.digest, recipients: effective.recipientIds.length } : null;
  const maxPerDay = costArgs ? alertsMaxPerDayWei(prices, costArgs) : 0n;
  const needed = costArgs ? mailerAllowanceTerms(prices, costArgs) : null;
  const allowanceOk = !!allowance?.active && !allowance.paused && !!needed && allowance.perDayWei >= needed.periodAmount && allowance.perChargeWei >= needed.maxPerCharge;

  async function save() {
    if (!form || !check) return;
    setNotice(null);
    setActionError(null);
    if (!check.ok) return setFields(check.errors);
    setFields({});
    setBusy("save");
    try {
      const r = await alertsApi.putRule(job.id, check.value);
      const next: RuleSettings = { ...defaultRuleSettings(), ...r };
      setSaved(next);
      setForm(toForm(next));
      setNotice(next.enabled ? "Alert settings saved." : "Alerts are off for this job.");
    } catch (e) {
      const body = (e as { body?: { fields?: FieldErrors } }).body;
      if (body?.fields) setFields(body.fields);
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function grantAllowance() {
    if (!job.poolId || !needed) return;
    setBusy("allowance");
    setNotice(null);
    setActionError(null);
    try {
      const { hash } = await setMailerAllowance(job.poolId, needed);
      setNotice(hash === "mock" ? "Email allowance set (simulated by the mock, no transaction sent)." : `Email allowance set. Tx ${shortHex(hash)}.`);
      await loadAllowance();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      setActionError(/rejected|denied/i.test(msg) ? "The wallet request was rejected." : msg);
    } finally {
      setBusy(null);
    }
  }

  if (off) return <AlertsOffNotice />;
  if (loadError) return <ErrorAlert error={loadError} />;
  if (!form || !recipients) return <Loading label="Loading alert settings…" />;

  const set = (p: Partial<Form>) => setForm({ ...form, ...p });
  const toggleRecipient = (rid: number, on: boolean) =>
    set({ recipientIds: on ? [...new Set([...form.recipientIds, rid])] : form.recipientIds.filter((x) => x !== rid) });

  return (
    <Card>
      <CardHeader
        title="Email alerts"
        subtitle={saved?.enabled ? "On for this job" : "Off for this job"}
        actions={
          <>
            {bradbury && <MoneyNotice />}
            <Badge tone={saved?.enabled ? "success" : "neutral"}>{saved?.enabled ? "on" : "off"}</Badge>
          </>
        }
      />
      <CardBody className="grid gap-6">
        <CheckRow
          id={`${id}-enabled`}
          checked={form.enabled}
          onChange={(v) => set({ enabled: v })}
          label={<span className="font-medium">Send email alerts for this job</span>}
          help="Only to addresses you confirmed. Every email has a one-click unsubscribe."
        />

        <fieldset className="grid gap-3" disabled={!form.enabled}>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Email me when</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {TRIGGERS.map((t, i) => (
              <CheckRow
                key={t.key}
                id={`${id}-t${i}`}
                checked={form[t.key]}
                disabled={!form.enabled}
                onChange={(v) => set({ [t.key]: v } as Partial<Form>)}
                label={t.label}
                help={t.help}
                error={t.key === "onFailure" ? fields.onFailure : undefined}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-3" disabled={!form.enabled}>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Send to</legend>
          {recipients.length === 0 ? (
            <p className="text-sm text-muted">
              You have no alert addresses yet.{" "}
              <Link href="/notifications" className="text-foreground underline underline-offset-2 hover:text-purple">
                Add one on Notifications
              </Link>
              , confirm it from your inbox, then pick it here.
            </p>
          ) : (
            <div className="grid gap-2">
              {recipients.map((r, i) => (
                <CheckRow
                  key={r.id}
                  id={`${id}-r${i}`}
                  checked={form.recipientIds.includes(r.id)}
                  disabled={!form.enabled || r.state !== "verified"}
                  onChange={(v) => toggleRecipient(r.id, v)}
                  label={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{r.email}</span>
                      {r.state === "verified" ? <Badge tone="success">confirmed</Badge> : <Badge tone="warn">waiting for confirmation</Badge>}
                    </span>
                  }
                  help={`Up to ${r.dailyCap} emails a day to this address, all jobs together.`}
                />
              ))}
              <p className="text-xs text-muted">
                <Link href="/notifications" className="underline underline-offset-2 hover:text-foreground">
                  Manage addresses
                </Link>
                {verified.length === 0 ? " · confirm an address before you can pick it" : ""}
              </p>
            </div>
          )}
          {fields.recipientIds && <p className="text-xs text-danger-fg">{fields.recipientIds}</p>}
        </fieldset>

        <fieldset className="grid gap-3" disabled={!form.enabled}>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Limits</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Alerts per day" htmlFor={`${id}-cap`} error={fields.perJobPerDay} help={boundHelp(LIMITS.perJobPerDay)}>
              <Input
                id={`${id}-cap`}
                inputMode="numeric"
                className="font-mono"
                aria-invalid={!!fields.perJobPerDay}
                value={form.perJobPerDay}
                onChange={(e) => set({ perJobPerDay: e.target.value })}
              />
            </Field>
            <Field label="Cooldown (minutes)" htmlFor={`${id}-cd`} error={fields.cooldownMin} help={boundHelp(LIMITS.cooldownMin, " min")}>
              <Input
                id={`${id}-cd`}
                inputMode="numeric"
                className="font-mono"
                aria-invalid={!!fields.cooldownMin}
                value={form.cooldownMin}
                onChange={(e) => set({ cooldownMin: e.target.value })}
              />
            </Field>
            <Field label="After consecutive failures" htmlFor={`${id}-fa`} error={fields.failAfter} help={boundHelp(LIMITS.failAfter)}>
              <Input
                id={`${id}-fa`}
                inputMode="numeric"
                className="font-mono"
                aria-invalid={!!fields.failAfter}
                value={form.failAfter}
                onChange={(e) => set({ failAfter: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted">
            Alerts per day counts every failure and recovery email for this job, all addresses together, over a rolling 24 hours. The cooldown is the
            shortest gap between two failure alerts. The operator also keeps a global daily ceiling for the whole service.
          </p>
        </fieldset>

        <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
          {bradbury ? (
            <>
              <p>
                Each alert or digest email costs <span className="font-mono">{formatGen(prices.emailWei)}</span>, charged to this job&apos;s pool{" "}
                <em>before</em> it is sent. At these limits, alerts cost at most{" "}
                <span className="font-mono font-medium">{formatGen(maxPerDay)}</span> a day
                {effective?.digest ? ` (${effective.perJobPerDay} alerts + ${effective.recipientIds.length} digest${effective.recipientIds.length === 1 ? "" : "s"})` : ` (${effective?.perJobPerDay ?? 0} alerts)`}.
                Confirmation emails are free.
              </p>
              {!job.poolId || !poolContract() ? (
                <p className="text-xs text-warn-fg">This job has no pool yet, so Bradbury alerts are refused until it is funded.</p>
              ) : allowance === undefined ? (
                <p className="text-xs text-muted">Reading the email allowance…</p>
              ) : allowance === null ? (
                <p className="text-xs text-warn-fg">No pool found for this job yet: fund it first, then set the email allowance.</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    On-chain email allowance:{" "}
                    {allowance.active ? (
                      <span className="font-mono text-foreground">
                        {formatGen(allowance.perDayWei)}/day, {formatGen(allowance.perChargeWei)} per email{allowance.paused ? " (paused)" : ""}
                      </span>
                    ) : (
                      <span className="text-warn-fg">none. Alerts are refused on-chain until you set one.</span>
                    )}
                    {allowance.active && !allowanceOk && needed ? (
                      <span className="text-warn-fg"> Below what these limits need ({formatGen(needed.periodAmount)}/day): extra emails will be refused.</span>
                    ) : null}
                  </p>
                  {needed && !allowanceOk && (
                    <Button size="sm" variant="secondary" disabled={!!busy || needed.periodAmount === 0n} onClick={grantAllowance}>
                      {busy === "allowance" ? "Confirm in your wallet…" : `Allow alerts up to ${formatGen(needed.periodAmount)}/day`}
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted">
                The allowance is the hard cap: even a faulty mailer cannot draw more. Your wallet signs <code className="text-foreground">setAllowance(uptimeId, 2, terms)</code>;
                pause or withdraw from Funding at any time.
              </p>
            </>
          ) : (
            <p>
              Studio emails are free, under a daily quota per wallet, for allowlisted wallets only. Nothing is charged.
            </p>
          )}
        </div>

        {notice && <Alert tone="success" title={notice} />}
        {actionError && (
          <Alert tone="danger" title="Could not save">
            {actionError}
          </Alert>
        )}
        {JOBS_MOCK && <p className="text-xs text-muted">Mock mode: settings live in this browser and no email is sent.</p>}
      </CardBody>
      <CardFooter className="justify-between">
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setForm(toForm({ ...defaultRuleSettings(), enabled: form.enabled, recipientIds: form.recipientIds }))}>
          Reset limits to defaults
        </Button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
          <Button onClick={save} disabled={!!busy || !dirty || !wallet}>
            {busy === "save" ? "Saving…" : "Save alert settings"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
