"use client";

// New job, in three screens: pick a task → set it up (2-3 plain fields, how
// often, a "Passes when…" sentence) → fund & start. Every plain field edits
// the same draft the Advanced editors show (./simple.ts), so nothing a power
// user could do before is lost: network, actions, rules, cron and raw args
// all live behind "Advanced".

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Input, PageContainer, PageHeader, Select, Textarea, cn } from "@/components/ui";
import { JOBS_MOCK, jobsApi, presetTemplate, type Preset } from "@/lib/jobs/client";
import type { Network } from "@/lib/jobs/types";
import { alertsApi, alertsOff } from "@/lib/alerts/client";
import { defaultRuleSettings } from "@/lib/mailer/limits";
import { useSession } from "./session";
import { AssertionsEditor } from "./AssertionsEditor";
import { ScheduleInput } from "./ScheduleInput";
import { StepsEditor } from "./StepsEditor";
import { MockBadge, MoneyNotice, networkName } from "./ui";
import { assertionErrors, blankStep, draftFromTemplate, stepErrors, toNewJob, uid, type Draft } from "./draft";
import { runsPerDay, scheduleError } from "./schedule";
import { depositPool, parseGen, poolContract, setReportedPoolAddress } from "./pool";
import { gen } from "./format";
import { TASKS, taskById, type Task, type TaskId } from "./tasks";
import {
  API_OPS,
  args,
  argsToLines,
  expectedAnswer,
  hostOf,
  linesToArgs,
  mainStep,
  passesWhen,
  secondStep,
  withArg,
  withExpectedAnswer,
  withStep,
} from "./simple";
import { daysCovered, estimateJobPerDayWei, estimateRunWei, formatGen, readPrices } from "@/lib/pricing";

type Screen = "task" | "setup" | "fund";

const FREQS = [
  { min: 5, label: "5 min" },
  { min: 15, label: "15 min" },
  { min: 60, label: "1 hour" },
  { min: 360, label: "6 hours" },
  { min: 1440, label: "1 day" },
];

function freqLabel(min: number | undefined): string {
  const f = FREQS.find((x) => x.min === min);
  return f ? (f.min === 60 ? "hourly" : f.min === 1440 ? "daily" : `every ${f.label}`) : "";
}

function presetOk(p: Preset, n: Network) {
  if (p.systemOnly) return { ok: false, reason: "Run by the Foundation" };
  if (p.networks && !p.networks.includes(n)) return { ok: false, reason: `${networkName(n)} not supported` };
  return p.availability?.[n] ?? { ok: true };
}

function tryGen(s: string): bigint | null {
  try {
    return parseGen(s);
  } catch {
    return null;
  }
}

function fundingErrors(d: Draft): Partial<Record<"deposit" | "perRun" | "perDay", string>> {
  const e: ReturnType<typeof fundingErrors> = {};
  const dep = tryGen(d.funding.depositGen);
  const run = tryGen(d.funding.perRunGen);
  const day = tryGen(d.funding.perDayGen);
  if (dep == null) e.deposit = "A GEN amount, e.g. 1 or 0.5";
  else if (dep === 0n) e.deposit = "Deposit more than 0 GEN.";
  if (run == null) e.perRun = "A GEN amount";
  if (day == null || day === 0n) e.perDay = "A GEN amount above 0";
  if (run != null && day != null && run > day) e.perRun = "The cap per run cannot exceed the daily limit.";
  return e;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/;

/** A selectable card used for tasks and networks. */
function Choice({ selected, disabled, onClick, children, title }: { selected?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border bg-background p-5 text-left transition-colors",
        selected ? "border-purple ring-1 ring-purple" : "border-border hover:border-border-strong hover:bg-surface",
        disabled && "cursor-not-allowed opacity-50 hover:border-border hover:bg-background",
      )}
    >
      {children}
    </button>
  );
}

/** A disclosure for everything a first-time user does not need. */
function Advanced({ open, onToggle, children }: { open: boolean; onToggle: (o: boolean) => void; children: React.ReactNode }) {
  return (
    <details open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)} className="rounded-lg border border-border">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground hover:bg-surface">Advanced</summary>
      <div className="grid gap-6 border-t border-border p-4">{children}</div>
    </details>
  );
}

export function JobWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, signIn, busy: signingIn } = useSession();
  const fid = useId();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("task");
  const [task, setTask] = useState<TaskId | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // The pool id is the SERVER's (derived from the job id, returned by POST /api/jobs).
  // The scheduler only funds runs from that pool, so never invent one here.
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);
  const [poolAddr, setPoolAddr] = useState<string | null>(null);
  const [sender, setSender] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [wantEmail, setWantEmail] = useState(false);
  const [alertsAvailable, setAlertsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    jobsApi
      .presets()
      .then((r) => {
        setReportedPoolAddress(r.pool?.bradbury);
        setPoolAddr(poolContract());
        setPresets(r.presets);
      })
      .catch((e) => {
        setPoolAddr(poolContract());
        setPresetsError(e instanceof Error ? e.message : "Could not load the job templates.");
        setPresets([]);
      });
    // The address runs are sent from: owner-gated contracts must allow it.
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { relayers?: Record<Network, string | null> } | null) => setSender(m?.relayers?.bradbury ?? null))
      .catch(() => setSender(null));
  }, []);

  // Email alerts are offered only where the server has them switched on.
  useEffect(() => {
    if (!me?.wallet) return;
    alertsApi
      .listRecipients()
      .then(() => setAlertsAvailable(true))
      .catch((e) => setAlertsAvailable(alertsOff(e) ? false : null));
  }, [me?.wallet]);

  const studioAllowed = !!me?.studioAllowed;
  const presetFor = (t: Task) => presets?.find((p) => p.id === t.preset);

  function start(t: Task | null) {
    const p = t ? presetFor(t) : undefined;
    const net: Network = p && !presetOk(p, "bradbury").ok && studioAllowed ? "studio" : "bradbury";
    let d = p ? draftFromTemplate({ name: (p as Preset & { jobName?: string }).jobName ?? p.name, preset: p.id, ...presetTemplate(p, net) }, net) : draftFromTemplate({ name: "Untitled job" }, net);
    if (d.steps.length === 0) d.steps = [blankStep("write", [])];
    // "Call a contract" starts as just the call; a follow-up read and rules live in Advanced.
    if (t?.id === "call") d = { ...d, steps: d.steps.filter((s) => s.kind === "write").slice(0, 1), assertions: [] };
    d.schedule = { everyMinutes: 60 };
    setTask(t?.id ?? null);
    setDraft(d);
    setNameTouched(false);
    setAdvanced(!t);
    setShowErrors(false);
    setCreatedId(null);
    setScreen("setup");
  }

  // Deep link from the home page: /jobs/new?task=website
  const linked = taskById(params.get("task"));
  useEffect(() => {
    if (linked && presets && !draft) start(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, linked?.id]);

  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });

  // Prefill the name from what is being checked, until the user types one.
  function update(d: Draft) {
    if (!nameTouched && task) {
      const step = mainStep(task, d);
      const a = step ? args(step) : [];
      const f = freqLabel(d.schedule.everyMinutes);
      const what =
        task === "website" || task === "api"
          ? hostOf(a[2])
          : task === "ai"
            ? `Ask: ${String(a[2] ?? "").slice(0, 32)}`
            : task === "call" && step
              ? `${step.method || "call"} on ${step.contract ? `${step.contract.slice(0, 6)}…` : "my contract"}`
              : d.name;
      d = { ...d, name: `${what}${f && (task === "website" || task === "api") ? `, ${f}` : ""}`.slice(0, 60) };
    }
    setDraft(d);
  }

  // Switching network on a template job re-fills its actions from that network's
  // template (the hosted contracts live at different addresses per network).
  function setNetwork(n: Network) {
    if (!draft) return;
    const p = draft.preset ? presets?.find((x) => x.id === draft.preset) : undefined;
    const t = p ? presetTemplate(p, n) : undefined;
    if (!p || !t) return set({ network: n });
    const d = draftFromTemplate({ name: draft.name, preset: p.id, ...t }, n);
    setDraft({ ...d, schedule: draft.schedule, funding: draft.funding, public: draft.public });
  }

  function setupErrors(d: Draft): string[] {
    const out: string[] = [];
    const step = task ? mainStep(task, d) : null;
    if (task && step) {
      const a = args(step);
      if ((task === "website" || task === "api") && !URL_RE.test(String(a[2] ?? ""))) out.push("Enter a URL that starts with https://");
      if (task === "ai" && !String(a[2] ?? "").trim()) out.push("Type the question to ask.");
      if (task === "ai" && a[3] && !URL_RE.test(String(a[3]))) out.push("The page to read must start with https://");
    }
    if (d.network === "studio" && !studioAllowed) out.push("GenLayer Studio is limited to Foundation and Labs wallets.");
    if (!d.steps.length) out.push("Add at least one action (Advanced).");
    out.push(...d.steps.flatMap((s) => Object.values(stepErrors(s, d.steps)).map((m) => `${s.id || "action"}: ${m}`)));
    const se = scheduleError(d.schedule);
    if (se) out.push(se);
    out.push(...d.assertions.map((a) => assertionErrors(a, d.steps)).filter((x): x is string => !!x));
    if (!d.name.trim()) out.push("Give the job a name.");
    return out;
  }

  const errorsHere = draft && screen === "setup" ? setupErrors(draft) : draft && screen === "fund" && draft.network === "bradbury" && poolAddr ? Object.values(fundingErrors(draft)) : [];
  if (draft && screen === "fund" && wantEmail && !EMAIL.test(email.trim())) errorsHere.push("Enter the email address for alerts.");

  function next() {
    if (errorsHere.length) return setShowErrors(true);
    setShowErrors(false);
    setScreen("fund");
  }

  async function create(fund: boolean) {
    if (!draft) return;
    if (fund && errorsHere.length) return setShowErrors(true);
    setSubmitError(null);
    let id = createdId;
    let poolId = createdPoolId;
    try {
      if (!id) {
        setSubmitting("Creating the job…");
        const job = await jobsApi.createJob(toNewJob(draft));
        id = job.id;
        poolId = job.poolId ?? null;
        setCreatedId(id);
        setCreatedPoolId(poolId);
      }
      if (fund && draft.network === "bradbury" && poolAddr) {
        if (!poolId) throw new Error("The server did not assign a budget to this job.");
        setSubmitting(JOBS_MOCK ? "Funding (simulated)…" : "Confirm the deposit in your wallet…");
        await depositPool(
          poolId,
          parseGen(draft.funding.depositGen),
          { perRunWei: parseGen(draft.funding.perRunGen), perDayWei: parseGen(draft.funding.perDayGen) },
          me?.wallet ?? undefined,
        );
        // Funded: start it, so a paid job is never left waiting. If the server
        // says no, the job page shows why and offers Start.
        setSubmitting("Starting the job…");
        await jobsApi.resumeJob(id).catch(() => undefined);
      }
      if (wantEmail && alertsAvailable && EMAIL.test(email.trim())) {
        setSubmitting("Setting up email alerts…");
        try {
          const { recipient } = await alertsApi.addRecipient(email.trim());
          await alertsApi.putRule(id, { ...defaultRuleSettings(), enabled: true, recipientIds: [recipient.id] });
        } catch {
          // Alerts can be set up from the job page; never block the job on them.
        }
      }
      router.push(`/jobs/${encodeURIComponent(id)}`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      setSubmitError(id ? `The job was created, but funding failed: ${msg} You can fund it from the job page, or retry here.` : msg);
    } finally {
      setSubmitting(null);
    }
  }

  const rpd = draft ? runsPerDay(draft.schedule) : null;
  const txSteps = draft?.steps.filter((s) => s.kind !== "read").length ?? 0;
  const funded = draft?.network === "bradbury" && !!poolAddr;
  const screens: { id: Screen; label: string }[] = [
    { id: "task", label: "What to check" },
    { id: "setup", label: "Set it up" },
    { id: "fund", label: funded ? "Fund & start" : "Start" },
  ];
  const at = screens.findIndex((s) => s.id === screen);

  return (
    <PageContainer>
      <Link href="/jobs" className="mt-8 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground">
        <ArrowLeft className="h-3 w-3" aria-hidden />
        All jobs
      </Link>
      <PageHeader eyebrow="New job" title="Start a check." actions={<MockBadge />} />

      <nav aria-label="Progress" className="mb-6 flex flex-wrap gap-1">
        {screens.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => (i < at || (s.id === "setup" && draft) ? setScreen(s.id) : undefined)}
            disabled={i > at && !(s.id === "setup" && draft)}
            aria-current={s.id === screen ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              s.id === screen ? "bg-surface font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]",
                s.id === screen ? "border-purple text-purple" : i < at ? "border-border bg-surface text-foreground" : "border-border",
              )}
            >
              {i + 1}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <Card>
        {screen === "task" && (
          <>
            <CardHeader title="What should it check?" />
            <CardBody className="grid gap-4">
              {presetsError && (
                <Alert tone="warn" title="Job templates are unavailable">
                  {presetsError}. You can still start from scratch.
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TASKS.map((t) => {
                  const p = presetFor(t);
                  const ok = !!p && (presetOk(p, "bradbury").ok || (studioAllowed && presetOk(p, "studio").ok));
                  const reason = !p ? (presets ? "Not available on this server" : undefined) : (presetOk(p, "bradbury").reason ?? undefined);
                  return (
                    <Choice key={t.id} disabled={!ok} onClick={() => start(t)} title={!ok ? reason : undefined}>
                      <span className="text-sm font-medium text-foreground">{t.title}</span>
                      <span className="text-xs text-muted">{t.line}</span>
                      {!ok && presets ? <Badge>{reason ?? "Unavailable"}</Badge> : null}
                    </Choice>
                  );
                })}
              </div>
              {presets === null && <p className="text-xs text-muted">Loading…</p>}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                <span>On GenLayer Testnet Bradbury</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href="/examples/bradbury-heartbeat" className="transition-colors hover:text-foreground">
                    See a live example →
                  </Link>
                  <button type="button" onClick={() => start(null)} className="transition-colors hover:text-foreground">
                    Start from scratch →
                  </button>
                </span>
              </div>
            </CardBody>
          </>
        )}

        {draft && screen === "setup" && (
          <>
            <CardHeader title={task ? (taskById(task)?.title ?? "Set it up") : "Start from scratch"} />
            <CardBody className="grid gap-6">
              <PlainFields task={task} draft={draft} onChange={update} sender={sender} />

              <div className="grid gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted">How often</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="How often">
                  {FREQS.map((f) => (
                    <button
                      key={f.min}
                      type="button"
                      aria-pressed={draft.schedule.everyMinutes === f.min}
                      onClick={() => update({ ...draft, schedule: { everyMinutes: f.min } })}
                      className={cn(
                        "h-8 rounded-lg border px-3 text-xs transition-colors",
                        draft.schedule.everyMinutes === f.min ? "border-purple text-purple ring-1 ring-purple" : "border-border text-muted hover:border-border-strong hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground">{passesWhen(task, draft)}</div>

              <Field label="Name" htmlFor={`${fid}-name`}>
                <Input
                  id={`${fid}-name`}
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => {
                    setNameTouched(true);
                    set({ name: e.target.value });
                  }}
                />
              </Field>

              <Advanced open={advanced} onToggle={setAdvanced}>
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Network</h3>
                  {studioAllowed ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["bradbury", "studio"] as Network[]).map((n) => (
                        <Choice key={n} selected={draft.network === n} onClick={() => setNetwork(n)}>
                          <span className="text-sm font-medium text-foreground">{networkName(n)}</span>
                          <span className="text-xs text-muted">
                            {n === "bradbury"
                              ? "Real GenLayer validators. You fund the job's budget from your wallet."
                              : "GenLayer's hosted Studio network. GEN is free here, so there is no budget."}
                          </span>
                        </Choice>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{networkName(draft.network)}.</p>
                  )}
                </div>
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Actions</h3>
                  <StepsEditor steps={draft.steps} onChange={(steps) => set({ steps })} showErrors={showErrors} />
                </div>
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Rules</h3>
                  <AssertionsEditor assertions={draft.assertions} steps={draft.steps} onChange={(assertions) => set({ assertions })} showErrors={showErrors} />
                </div>
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Schedule</h3>
                  <ScheduleInput value={draft.schedule} onChange={(schedule) => set({ schedule })} />
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Request JSON</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs">{JSON.stringify(toNewJob(draft), null, 2)}</pre>
                </details>
              </Advanced>
            </CardBody>
          </>
        )}

        {draft && screen === "fund" && (
          <>
            <CardHeader
              title={funded ? "Fund & start" : "Start"}
              subtitle={funded ? "Only you can withdraw it." : undefined}
              actions={funded ? <MoneyNotice /> : undefined}
            />
            <CardBody className="grid gap-6">
              {!me?.wallet && (
                <Alert tone="info" title="Sign in with your wallet first">
                  No transaction is sent.
                  <div>
                    <Button size="sm" className="mt-2" onClick={signIn} disabled={signingIn}>
                      {signingIn ? "Check your wallet…" : "Connect wallet & sign in"}
                    </Button>
                  </div>
                </Alert>
              )}
              {draft.network === "bradbury" && !poolAddr && (
                <Alert tone="warn" title="Funding is not available yet">
                  You can still create the job; it runs once funded.
                </Alert>
              )}
              {funded && <FundingFields draft={draft} set={set} showErrors={showErrors} rpd={rpd} txSteps={txSteps} />}

              <div className="grid gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted">Email alerts</span>
                {alertsAvailable ? (
                  <>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="accent-purple" checked={wantEmail} onChange={(e) => setWantEmail(e.target.checked)} />
                      Email me when it fails
                    </label>
                    {wantEmail && (
                      <Field label="Email" htmlFor={`${fid}-email`} help="We send one confirmation link.">
                        <Input id={`${fid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                      </Field>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    {alertsAvailable === false ? "Not switched on yet. Failures show on the job page." : "Set up on the job page."}
                  </p>
                )}
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="accent-purple" checked={draft.public} onChange={(e) => set({ public: e.target.checked })} />
                Public results
              </label>

              {submitError && (
                <Alert tone="danger" title="Could not finish">
                  {submitError}
                </Alert>
              )}
            </CardBody>
          </>
        )}

        {draft && screen !== "task" && (
          <CardFooter className="flex-wrap justify-between">
            <Button variant="ghost" onClick={() => setScreen(screen === "fund" ? "setup" : "task")} disabled={!!submitting}>
              ← Back
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {showErrors && errorsHere.length > 0 && <span className="text-xs text-danger-fg">{errorsHere[0]}</span>}
              {screen === "setup" ? (
                <Button onClick={next}>Continue →</Button>
              ) : (
                <>
                  {funded && (
                    <Button variant="secondary" onClick={() => create(false)} disabled={!!submitting || !me?.wallet || !!createdId} title="Create it now, fund it later from the job page">
                      Save as draft
                    </Button>
                  )}
                  <Button onClick={() => create(true)} disabled={!!submitting || !me?.wallet}>
                    {submitting ?? (funded ? (createdId ? "Retry funding" : "Fund & start") : "Create job")}
                  </Button>
                </>
              )}
            </div>
          </CardFooter>
        )}
      </Card>
    </PageContainer>
  );
}

/** The 2-3 fields a task needs. Each one is an argument of the task's action. */
function PlainFields({ task, draft, onChange, sender }: { task: TaskId | null; draft: Draft; onChange: (d: Draft) => void; sender: string | null }) {
  const id = useId();
  const step = task ? mainStep(task, draft) : null;
  if (!task) return <p className="text-sm text-muted">Build it under Advanced.</p>;
  if (!step) return <p className="text-sm text-muted">Edited under Advanced.</p>;
  const a = args(step);
  const arg = (i: number, v: unknown) => onChange(withArg(draft, step.id, i, v));
  const f = (n: string) => `${id}-${n}`;

  switch (task) {
    case "website":
      return (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="URL" htmlFor={f("url")}>
            <Input id={f("url")} className="font-mono" value={String(a[2] ?? "")} placeholder="https://example.com" onChange={(e) => arg(2, e.target.value.trim())} />
          </Field>
          <Field label="Expected status" htmlFor={f("status")} help="Empty means any 2xx">
            <Input
              id={f("status")}
              className="font-mono"
              inputMode="numeric"
              value={Number(a[3]) ? String(a[3]) : ""}
              placeholder="200"
              onChange={(e) => arg(3, Number(e.target.value.replace(/\D/g, "")) || 0)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Page must contain (optional)" htmlFor={f("contains")} help="Exact text, case-sensitive">
              <Input id={f("contains")} value={String(a[4] ?? "")} placeholder="Sign in" onChange={(e) => arg(4, e.target.value)} />
            </Field>
          </div>
        </div>
      );
    case "api":
      return (
        <div className="grid gap-4">
          <Field label="URL" htmlFor={f("url")} help="Must return JSON">
            <Input id={f("url")} className="font-mono" value={String(a[2] ?? "")} placeholder="https://api.example.com/health" onChange={(e) => arg(2, e.target.value.trim())} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Value at" htmlFor={f("path")} help="Dot path, e.g. data.status">
              <Input id={f("path")} className="font-mono" value={String(a[3] ?? "")} placeholder="data.status" onChange={(e) => arg(3, e.target.value.trim())} />
            </Field>
            <Field label="Should" htmlFor={f("op")}>
              <Select id={f("op")} value={String(a[4] ?? "eq")} onChange={(e) => arg(4, e.target.value)}>
                {API_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Value" htmlFor={f("exp")}>
              <Input id={f("exp")} className="font-mono" value={String(a[5] ?? "")} disabled={a[4] === "exists"} placeholder="ok" onChange={(e) => arg(5, e.target.value)} />
            </Field>
          </div>
          <Field label="Allowed difference (optional)" htmlFor={f("tol")} help="For values that move, like prices">
            <Input id={f("tol")} className="max-w-48 font-mono" value={String(a[6] ?? "")} placeholder="0" onChange={(e) => arg(6, e.target.value.trim())} />
          </Field>
        </div>
      );
    case "ai":
      return (
        <div className="grid gap-4">
          <Field label="Question" htmlFor={f("q")} help="Short, factual questions work best.">
            <Textarea id={f("q")} rows={2} value={String(a[2] ?? "")} placeholder="Does example.com list a Pro plan? yes or no" onChange={(e) => arg(2, e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Read this page first (optional)" htmlFor={f("url")}>
              <Input id={f("url")} className="font-mono" value={String(a[3] ?? "")} placeholder="https://example.com/pricing" onChange={(e) => arg(3, e.target.value.trim())} />
            </Field>
            <Field label="Expected answer (optional)" htmlFor={f("exp")} help="Empty: any agreed answer passes">
              <Input id={f("exp")} value={expectedAnswer(draft)} placeholder="yes" onChange={(e) => onChange(withExpectedAnswer(draft, e.target.value, uid))} />
            </Field>
          </div>
        </div>
      );
    case "call":
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Contract address" htmlFor={f("addr")}>
              <Input
                id={f("addr")}
                className="font-mono"
                value={/^0x0{40}$/.test(step.contract) ? "" : step.contract}
                placeholder="0x…"
                onChange={(e) => onChange(withStep(draft, step.id, { contract: e.target.value.trim() }))}
              />
            </Field>
            <Field label="Method" htmlFor={f("m")}>
              <Input id={f("m")} className="font-mono" value={step.method} placeholder="settle" onChange={(e) => onChange(withStep(draft, step.id, { method: e.target.value.trim() }))} />
            </Field>
          </div>
          <Field label="Inputs (optional)" htmlFor={f("in")} help="One per line">
            <Textarea
              id={f("in")}
              rows={2}
              className="font-mono"
              value={argsToLines(a)}
              onChange={(e) => onChange(withStep(draft, step.id, { argsText: JSON.stringify(linesToArgs(e.target.value)) }))}
            />
          </Field>
          {sender && (
            <p className="text-xs text-muted">
              Sent from <code className="break-all text-foreground">{sender}</code>. Allow it if your method checks the caller.
            </p>
          )}
        </div>
      );
    case "deploy":
    case "deploy-call": {
      const second = task === "deploy-call" ? secondStep(draft) : null;
      return (
        <div className="grid gap-4">
          <Field label="Contract to deploy" htmlFor={f("src")}>
            <Select id={f("src")} value={step.deploySource} onChange={(e) => onChange(withStep(draft, step.id, { deploySource: e.target.value as typeof step.deploySource }))}>
              <option value="preset">Our Canary test contract</option>
              <option value="code">Paste my own code</option>
            </Select>
          </Field>
          {step.deploySource === "code" && (
            <>
              <Field label="Intelligent Contract code (Python)" htmlFor={f("code")} help="Fixed when the job is created">
                <Textarea id={f("code")} rows={8} className="font-mono" value={step.code} onChange={(e) => onChange(withStep(draft, step.id, { code: e.target.value }))} />
              </Field>
              <Field label="Constructor inputs (optional)" htmlFor={f("in")} help="One per line.">
                <Textarea
                  id={f("in")}
                  rows={2}
                  className="font-mono"
                  value={argsToLines(a)}
                  onChange={(e) => onChange(withStep(draft, step.id, { argsText: JSON.stringify(linesToArgs(e.target.value)) }))}
                />
              </Field>
            </>
          )}
          {second && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Then call this method on the newest copy" htmlFor={f("m2")}>
                <Input id={f("m2")} className="font-mono" value={second.method} onChange={(e) => onChange(withStep(draft, second.id, { method: e.target.value.trim() }))} />
              </Field>
              <Field label="Call every" htmlFor={f("e2")} help="Deploys follow “How often”">
                <Select
                  id={f("e2")}
                  value={String(second.schedule.everyMinutes ?? 5)}
                  onChange={(e) => onChange(withStep(draft, second.id, { ownSchedule: true, schedule: { everyMinutes: Number(e.target.value) } }))}
                >
                  {FREQS.map((x) => (
                    <option key={x.min} value={x.min}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      );
    }
  }
}

function FundingFields({
  draft,
  set,
  showErrors,
  rpd,
  txSteps,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  showErrors: boolean;
  rpd: number | null;
  txSteps: number;
}) {
  const id = useId();
  const e = showErrors ? fundingErrors(draft) : {};
  const f = draft.funding;
  const setF = (p: Partial<Draft["funding"]>) => set({ funding: { ...f, ...p } });
  const dep = tryGen(f.depositGen);
  const day = tryGen(f.perDayGen);
  const run = tryGen(f.perRunGen);
  const prices = readPrices();
  const perRunEst = estimateRunWei(prices, txSteps);
  const perDayEst = rpd != null ? estimateJobPerDayWei(prices, rpd, txSteps) : null;
  const estDays = dep != null && perDayEst ? daysCovered(dep, perDayEst) : null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Deposit (GEN)"
          htmlFor={`${id}-dep`}
          error={e.deposit}
          help={estDays != null ? `Lasts about ${estDays} days` : undefined}
        >
          <Input id={`${id}-dep`} aria-invalid={!!e.deposit} className="font-mono" value={f.depositGen} onChange={(x) => setF({ depositGen: x.target.value })} />
        </Field>
        <Field label="Daily limit (GEN)" htmlFor={`${id}-day`} error={e.perDay} help="Runs pause for the day after this">
          <Input id={`${id}-day`} aria-invalid={!!e.perDay} className="font-mono" value={f.perDayGen} onChange={(x) => setF({ perDayGen: x.target.value })} />
        </Field>
      </div>
      {day != null && perDayEst != null && day < perDayEst && (
        <Alert tone="warn" title="The daily limit is below the estimate">
          At about {formatGen(perDayEst)} a day, runs stop for the rest of the day once {gen(day)} is spent.
        </Alert>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Advanced</summary>
        <div className="mt-3 grid gap-3">
          <Field label="Cap per run (GEN)" htmlFor={`${id}-run`} error={e.perRun} help="One run can never cost more">
            <Input id={`${id}-run`} aria-invalid={!!e.perRun} className="max-w-48 font-mono" value={f.perRunGen} onChange={(x) => setF({ perRunGen: x.target.value })} />
          </Field>
          {run != null && run < perRunEst && (
            <Alert tone="warn" title="The cap per run is below the estimated cost of one run">
              Runs that would cost more than {gen(run)} are refused, so this job may never run. The estimate is {formatGen(perRunEst)} per run.
            </Alert>
          )}
          <p className="text-xs text-muted">
            Each run is priced at a flat <span className="font-mono">{formatGen(prices.runFeeWei)}</span> plus the network fee it actually used. The estimate assumes{" "}
            <span className="font-mono">{formatGen(prices.gasPerTxEstimateWei)}</span> per transaction × {txSteps} transaction{txSteps === 1 ? "" : "s"} per run; network fees on
            GenLayer Testnet Bradbury are not measured yet, so the real figure may differ.
          </p>
        </div>
      </details>
    </div>
  );
}
