"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, FileCode2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Input, PageContainer, PageHeader, cn } from "@/components/ui";
import { JOBS_MOCK, jobsApi, type Preset } from "@/lib/jobs/client";
import type { Network } from "@/lib/jobs/types";
import { useSession } from "./session";
import { AssertionsEditor } from "./AssertionsEditor";
import { ScheduleInput } from "./ScheduleInput";
import { StepsEditor } from "./StepsEditor";
import { MockBadge, MoneyNotice, NetworkBadge } from "./ui";
import { assertionErrors, blankStep, draftFromTemplate, stepErrors, toAssertion, toNewJob, type Draft } from "./draft";
import { describeSchedule, runsPerDay, scheduleError } from "./schedule";
import { depositPool, newPoolId, parseGen, poolContract, setReportedPoolAddress } from "./pool";
import { describeAssertion } from "./assert";
import { gen } from "./format";

const PAGES = ["Start", "Network", "Steps", "Schedule", "Assertions", "Funding", "Review"] as const;
type Page = (typeof PAGES)[number];

const SUBTITLE: Record<Page, string> = {
  Start: "A preset fills in steps, schedule and assertions you can then edit.",
  Network: "Where the job runs.",
  Steps: "What runs each slot, in order.",
  Schedule: "How often the job runs.",
  Assertions: "What counts as a passing run.",
  Funding: "The GEN pool that pays for runs on Bradbury.",
  Review: "Check everything, then create.",
};

function presetOk(p: Preset, n: Network) {
  if (p.networks && !p.networks.includes(n)) return { ok: false, reason: `${n === "studio" ? "Studio" : "Bradbury"} not supported` };
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
  else if (dep === 0n) e.deposit = "Deposit more than 0 GEN to create the pool.";
  if (run == null) e.perRun = "A GEN amount";
  if (day == null || day === 0n) e.perDay = "A GEN amount above 0";
  if (run != null && day != null && run > day) e.perRun = "The per-run cap cannot exceed the per-day cap.";
  return e;
}

/** A selectable card used for presets and networks. */
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

export function JobWizard() {
  const router = useRouter();
  const { me, signIn, busy: signingIn } = useSession();
  const nameId = useId();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("Start");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [poolId] = useState(() => (typeof crypto !== "undefined" ? newPoolId() : ""));
  const [poolAddr, setPoolAddr] = useState<string | null>(null);

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
        setPresetsError(e instanceof Error ? e.message : "Could not load presets.");
        setPresets([]);
      });
  }, []);

  const studioAllowed = !!me?.studioAllowed;
  const pages = useMemo(() => PAGES.filter((p) => p !== "Funding" || draft?.network !== "studio"), [draft?.network]);
  const at = pages.indexOf(page);

  function pick(p: Preset | null) {
    const net: Network = p && !presetOk(p, "bradbury").ok && studioAllowed ? "studio" : "bradbury";
    const d = p ? draftFromTemplate({ name: p.name, preset: p.id, ...p.template }, net) : draftFromTemplate({ name: "Untitled job" }, net);
    if (d.steps.length === 0) d.steps = [blankStep("write", [])];
    setDraft(d);
    setShowErrors(false);
    setCreatedId(null);
    setPage("Network");
  }

  function pageErrors(p: Page): string[] {
    if (!draft) return p === "Start" ? [] : ["Pick a preset or start blank."];
    switch (p) {
      case "Network":
        return draft.network === "studio" && !studioAllowed ? ["Studio is limited to Foundation and Labs wallets."] : [];
      case "Steps":
        if (!draft.steps.length) return ["Add at least one step."];
        return draft.steps.flatMap((s) => Object.values(stepErrors(s, draft.steps)).map((m) => `${s.id || "step"}: ${m}`));
      case "Schedule": {
        const e = scheduleError(draft.schedule);
        return e ? [e] : [];
      }
      case "Assertions":
        return draft.assertions.map((a) => assertionErrors(a, draft.steps)).filter((x): x is string => !!x);
      case "Funding":
        return Object.values(fundingErrors(draft));
      case "Review":
        return draft.name.trim() ? [] : ["Give the job a name."];
      default:
        return [];
    }
  }

  const errorsHere = pageErrors(page);
  const firstBad = pages.slice(1).find((p) => pageErrors(p).length > 0);

  function go(to: Page) {
    if (pages.indexOf(to) > at && errorsHere.length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setPage(to);
  }

  async function create() {
    if (!draft) return;
    if (firstBad) {
      setPage(firstBad);
      setShowErrors(true);
      return;
    }
    setSubmitError(null);
    let id = createdId;
    try {
      if (!id) {
        setSubmitting("Creating the job…");
        const job = await jobsApi.createJob(toNewJob(draft, poolId));
        id = job.id;
        setCreatedId(id);
      }
      if (draft.network === "bradbury" && poolAddr) {
        setSubmitting(JOBS_MOCK ? "Funding the pool (simulated)…" : "Confirm the deposit in your wallet…");
        await depositPool(
          poolId,
          parseGen(draft.funding.depositGen),
          { perRunWei: parseGen(draft.funding.perRunGen), perDayWei: parseGen(draft.funding.perDayGen) },
          me?.wallet ?? undefined,
        );
      }
      router.push(`/jobs/${encodeURIComponent(id)}`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      setSubmitError(id ? `The job was created, but funding failed: ${msg} You can fund it from the job page, or retry here.` : msg);
    } finally {
      setSubmitting(null);
    }
  }

  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  const rpd = draft ? runsPerDay(draft.schedule) : null;
  const txSteps = draft?.steps.filter((s) => s.kind !== "read").length ?? 0;
  const funded = draft?.network === "bradbury" && !!poolAddr;

  return (
    <PageContainer>
      <Link href="/jobs" className="mt-8 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground">
        <ArrowLeft className="h-3 w-3" aria-hidden />
        All jobs
      </Link>
      <PageHeader eyebrow="New job" title="Schedule a job." muted="Pick what runs, how often, and fund it." actions={<MockBadge />} />

      <nav aria-label="Wizard steps" className="mb-6 flex flex-wrap gap-1">
        {pages.map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            disabled={!draft && p !== "Start"}
            aria-current={p === page ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              p === page ? "bg-surface font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]",
                p === page ? "border-purple text-purple" : i < at ? "border-border bg-surface text-foreground" : "border-border",
              )}
            >
              {i + 1}
            </span>
            {p}
          </button>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={`Step ${at + 1} of ${pages.length} · ${page}`}
          subtitle={SUBTITLE[page]}
          actions={page === "Funding" || (page === "Review" && draft?.network === "bradbury") ? <MoneyNotice /> : undefined}
        />
        <CardBody>
          {page === "Start" && (
            <div className="grid gap-4">
              {presetsError && (
                <Alert tone="warn" title="Presets are unavailable">
                  {presetsError}. You can still start blank.
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Choice onClick={() => pick(null)}>
                  <span className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-purple" aria-hidden />
                    <span className="text-sm font-medium text-foreground">Blank job</span>
                  </span>
                  <span className="text-xs text-muted">Any write, deploy or read on any contract. You write the steps.</span>
                </Choice>
                {(presets ?? []).map((p) => {
                  const nets = (["bradbury", "studio"] as Network[]).filter((n) => presetOk(p, n).ok && (n !== "studio" || studioAllowed));
                  const disabled = nets.length === 0;
                  const reason = presetOk(p, "bradbury").reason ?? presetOk(p, "studio").reason ?? (studioAllowed ? undefined : "Studio only (allowlisted wallets)");
                  return (
                    <Choice key={p.id} disabled={disabled} onClick={() => pick(p)} title={disabled ? reason : undefined}>
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      {p.description && <span className="text-xs text-muted">{p.description}</span>}
                      <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        {disabled ? <Badge>{reason ?? "Unavailable"}</Badge> : nets.map((n) => <NetworkBadge key={n} network={n} />)}
                      </span>
                    </Choice>
                  );
                })}
              </div>
              {presets === null && <p className="text-xs text-muted">Loading presets…</p>}
            </div>
          )}

          {draft && page === "Network" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["bradbury", "studio"] as Network[]).map((n) => {
                const locked = n === "studio" && !studioAllowed;
                return (
                  <Choice key={n} selected={draft.network === n} disabled={locked} onClick={() => set({ network: n })}>
                    <span className="flex gap-1.5">
                      <NetworkBadge network={n} />
                      {n === "bradbury" && <Badge tone="warn">testnet</Badge>}
                    </span>
                    <span className="text-sm font-medium text-foreground">{n === "bradbury" ? "Testnet Bradbury" : "GenLayer Studio"}</span>
                    <span className="text-xs text-muted">
                      {n === "bradbury"
                        ? "Real validators. You fund a GEN pool from your wallet; the scheduler draws run costs within caps you set. Pause or withdraw any time."
                        : "Studionet. GEN is free here, so there is no pool. Limited to Foundation and Labs wallets."}
                    </span>
                    {locked && <span className="text-xs text-danger-fg">{me?.wallet ? "Your wallet is not on the Studio allowlist." : "Sign in to check Studio access."}</span>}
                  </Choice>
                );
              })}
            </div>
          )}

          {draft && page === "Steps" && <StepsEditor steps={draft.steps} onChange={(steps) => set({ steps })} showErrors={showErrors} />}

          {draft && page === "Schedule" && (
            <div className="grid gap-4">
              <ScheduleInput value={draft.schedule} onChange={(schedule) => set({ schedule })} />
              {rpd != null && (
                <p className="text-xs text-muted">
                  About {Math.round(rpd)} runs a day × {txSteps} transaction{txSteps === 1 ? "" : "s"} per run
                  {draft.steps.some((s) => s.ownSchedule) ? " (steps with their own schedule run on theirs)" : ""}.
                </p>
              )}
            </div>
          )}

          {draft && page === "Assertions" && (
            <AssertionsEditor assertions={draft.assertions} steps={draft.steps} onChange={(assertions) => set({ assertions })} showErrors={showErrors} />
          )}

          {draft && page === "Funding" && <FundingForm draft={draft} set={set} showErrors={showErrors} poolAddr={poolAddr} rpd={rpd} txSteps={txSteps} />}

          {draft && page === "Review" && (
            <div className="grid gap-6">
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="Name" htmlFor={nameId} error={showErrors && !draft.name.trim() ? "Give the job a name." : undefined}>
                  <Input id={nameId} value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted">Visibility</span>
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-purple" checked={draft.public} onChange={(e) => set({ public: e.target.checked })} />
                    Public: anyone can see it and its runs
                  </label>
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted">Network</dt>
                <dd>
                  <NetworkBadge network={draft.network} />
                </dd>
                <dt className="text-muted">Schedule</dt>
                <dd>{describeSchedule(draft.schedule)}</dd>
                <dt className="text-muted">Steps</dt>
                <dd className="grid gap-1">
                  {draft.steps.map((s) => (
                    <code key={s.uid} className="break-all text-xs">
                      {s.id}: {s.kind}{" "}
                      {s.kind === "deploy" ? (s.deploySource === "code" ? "(pasted source)" : s.preset) : `${s.contract}.${s.method}(${s.argsText})`}
                      {s.ownSchedule ? ` · ${describeSchedule(s.schedule)}` : ""}
                    </code>
                  ))}
                </dd>
                <dt className="text-muted">Assertions</dt>
                <dd className="grid gap-1">
                  {draft.assertions.length ? (
                    draft.assertions.map((a) => (
                      <code key={a.uid} className="text-xs">
                        {describeAssertion(toAssertion(a))}
                      </code>
                    ))
                  ) : (
                    <span className="text-muted">None: a run passes when every step is accepted.</span>
                  )}
                </dd>
                {draft.network === "bradbury" && (
                  <>
                    <dt className="text-muted">Funding</dt>
                    <dd>
                      {poolAddr ? (
                        <>
                          Deposit <span className="font-mono">{draft.funding.depositGen} GEN</span> · caps{" "}
                          <span className="font-mono">{draft.funding.perRunGen} GEN</span>/run, <span className="font-mono">{draft.funding.perDayGen} GEN</span>/day
                          <p className="mt-1 break-all font-mono text-xs text-muted">pool id {poolId}</p>
                        </>
                      ) : (
                        <span className="text-warn-fg">The pool contract is not deployed: the job is created unfunded.</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
              <details>
                <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Request JSON</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs">{JSON.stringify(toNewJob(draft, poolId), null, 2)}</pre>
              </details>
              {firstBad && showErrors && <Alert tone="danger" title={`Fix the ${firstBad} step first.`} />}
              {submitError && <Alert tone="danger" title="Could not finish">{submitError}</Alert>}
              {!me?.wallet && (
                <Alert tone="warn" title="Sign in to create the job">
                  <Button size="sm" className="mt-2" onClick={signIn} disabled={signingIn}>
                    {signingIn ? "Check your wallet…" : "Connect wallet & sign in"}
                  </Button>
                </Alert>
              )}
            </div>
          )}
        </CardBody>

        {draft && (
          <CardFooter className="justify-between">
            <Button variant="ghost" onClick={() => go(pages[Math.max(0, at - 1)])} disabled={at === 0 || !!submitting}>
              ← Back
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {showErrors && errorsHere.length > 0 && <span className="text-xs text-danger-fg">{errorsHere[0]}</span>}
              {page !== "Review" ? (
                <Button onClick={() => go(pages[at + 1])}>Continue →</Button>
              ) : (
                <Button onClick={create} disabled={!!submitting || !me?.wallet}>
                  {submitting ?? (funded ? (createdId ? "Retry funding" : "Create & fund") : "Create job")}
                </Button>
              )}
            </div>
          </CardFooter>
        )}
      </Card>
    </PageContainer>
  );
}

function FundingForm({
  draft,
  set,
  showErrors,
  poolAddr,
  rpd,
  txSteps,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  showErrors: boolean;
  poolAddr: string | null;
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
  const lasts = dep != null && day ? `${Number((dep * 100n) / day) / 100} days at the full daily cap` : undefined;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        Your wallet locks GEN in this job&apos;s own pool on the UptimePool contract. The scheduler pays run fees up front and draws them back from the pool, never more than
        the caps below. From the job page you can top up, pause charges, or withdraw everything at any time, even while paused.
      </p>
      {!poolAddr && (
        <Alert tone="warn" title="The UptimePool contract is not deployed yet">
          <code>NEXT_PUBLIC_UPTIME_POOL_BRADBURY</code> is unset. You can still create the job; it stays unfunded and does not run until a pool exists.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Deposit (GEN)" htmlFor={`${id}-dep`} error={e.deposit} help={lasts}>
          <Input id={`${id}-dep`} aria-invalid={!!e.deposit} className="font-mono" value={f.depositGen} onChange={(x) => setF({ depositGen: x.target.value })} />
        </Field>
        <Field label="Cap per run (GEN)" htmlFor={`${id}-run`} error={e.perRun} help="maxPerCharge: one run can never cost more">
          <Input id={`${id}-run`} aria-invalid={!!e.perRun} className="font-mono" value={f.perRunGen} onChange={(x) => setF({ perRunGen: x.target.value })} />
        </Field>
        <Field label="Cap per day (GEN)" htmlFor={`${id}-day`} error={e.perDay} help="periodAmount per 24 h, no carry-over">
          <Input id={`${id}-day`} aria-invalid={!!e.perDay} className="font-mono" value={f.perDayGen} onChange={(x) => setF({ perDayGen: x.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        {rpd != null ? `About ${Math.round(rpd)} runs/day, ${Math.round(rpd * txSteps)} transactions/day. ` : ""}
        The fee per transaction on Bradbury Phase 2 has not been measured yet, so there is no cost estimate: set caps you are fine losing on a testnet.
        {run != null && rpd ? ` At the per-run cap every run would be ${gen(run * BigInt(Math.ceil(rpd)))} a day, before the daily cap stops it.` : ""}
      </p>
      <p className="text-xs text-muted">
        Your wallet signs <code className="text-foreground">deposit(uptimeId, [scheduler], [terms])</code> with the deposit as value when you create the job. Later, from the
        job page: <code className="text-foreground">topUp</code>, <code className="text-foreground">withdraw</code>, <code className="text-foreground">setPaused</code>.
      </p>
    </div>
  );
}
