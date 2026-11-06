"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Coins, Download, Pause, Play, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardGrid, CardHeader, EmptyRow, PageContainer, PageHeader, Section, Segmented, Stat, StatusDot, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { JOBS_MOCK, jobsApi } from "@/lib/jobs/client";
import type { Job, Run } from "@/lib/jobs/types";
import { jobPhase, nextRunLabel, PHASE, runVerdict, type JobAction } from "@/lib/jobs/display";
import { readPool } from "./pool";
import { useSession } from "./session";
import { ErrorAlert, Loading, MockBadge, NetworkBadge, SignInGate, StepStatus } from "./ui";
import { describeAssertion, evaluate } from "./assert";
import { dateTime, download, pct, passRate, runLatencyMs, runsSince, seconds, shortHex, timeAgo, timeUntil } from "./format";
import { describeSchedule, nextRun } from "./schedule";
import { RunCharts } from "./RunCharts";
import { PoolPanel } from "./PoolPanel";
import { JobAlerts } from "@/components/alerts/JobAlerts";

const WINDOWS = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
] as const;

function failedAssertions(job: Job, run: Run): string[] {
  const by = new Map(run.steps.map((s) => [s.stepId, s]));
  return job.assertions.filter((a) => by.has(a.step) && !evaluate(a, by.get(a.step)!.result)).map(describeAssertion);
}

export function JobDetail({ id }: { id: string }) {
  const router = useRouter();
  const { me, loading: sessionLoading } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<{ status?: number; msg: string } | null>(null);
  const [busy, setBusy] = useState<null | "pause" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [days, setDays] = useState<number>(7);
  const [shown, setShown] = useState(50);
  const [now, setNow] = useState(() => Date.now());
  // Never-started Bradbury job: can its pool already cover a run? (Draft vs Ready)
  const [funded, setFunded] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [j, r] = await Promise.all([jobsApi.getJob(id), jobsApi.listRuns(id, 2000)]);
      setJob(j);
      setRuns(r);
      if (j.state === "draft" && j.poolId) {
        const p = await readPool(j.poolId).catch(() => null);
        setFunded(!!p && !p.paused && p.owner.toLowerCase() === j.owner.toLowerCase() && p.availableToSchedulerWei > BigInt(0));
      }
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setError({ status: (e as { status?: number }).status, msg: e instanceof Error ? e.message : "Could not load the job." });
    }
  }, [id]);

  useEffect(() => {
    if (sessionLoading) return;
     
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load, sessionLoading, me?.wallet]);

  const isOwner = !!(job && me?.wallet && job.owner.toLowerCase() === me.wallet.toLowerCase());

  async function act(action: JobAction) {
    if (!job) return;
    if (action === "fund" || action === "top-up") {
      document.getElementById("funding")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setBusy("pause");
    setActionError(null);
    try {
      setJob(action === "pause" ? await jobsApi.pauseJob(job.id) : await jobsApi.resumeJob(job.id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!job) return;
    setBusy("delete");
    setActionError(null);
    try {
      await jobsApi.deleteJob(job.id);
      router.push("/jobs");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function exportRuns(format: "json" | "rows") {
    const body = format === "rows" ? await jobsApi.listRunRows(id, 2000) : await jobsApi.listRuns(id, 2000);
    download(`${id}-runs-${format}.json`, JSON.stringify(body, null, 2));
  }

  const back = (
    <Link href="/jobs" className="mt-8 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground">
      <ArrowLeft className="h-3 w-3" aria-hidden />
      All jobs
    </Link>
  );

  if (error) {
    return (
      <PageContainer>
        {back}
        <PageHeader eyebrow="Job" title={<span className="break-all font-mono text-2xl sm:text-3xl">{id}</span>} />
        {error.status === 401 ? (
          <SignInGate what="see this job" />
        ) : error.status === 404 ? (
          <Alert tone="warn" title="Job not found">
            It may have been deleted.
          </Alert>
        ) : error.status === 403 ? (
          <Alert tone="warn" title="This job belongs to another wallet" />
        ) : (
          <ErrorAlert error={error.msg} />
        )}
      </PageContainer>
    );
  }
  if (!job || !runs) {
    return (
      <PageContainer>
        {back}
        <Loading />
      </PageContainer>
    );
  }

  const windowRuns = runsSince(runs, days * 86_400_000, now);
  const rate = passRate(windowRuns);
  const last = runs[0];
  const lats = windowRuns.map(runLatencyMs).filter((x): x is number => x != null).sort((a, b) => a - b);
  const p50 = lats.length ? lats[Math.floor(lats.length / 2)] : null;
  const phase = jobPhase(job, funded);
  const ph = PHASE[phase];
  const notRunning = nextRunLabel(phase);
  const next = job.paused ? null : nextRun(job.schedule, new Date(now));
  const rowsUrl = jobsApi.runsUrl(job.id, { format: "rows", limit: 1000 });

  return (
    <PageContainer>
      {back}
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Job <NetworkBadge network={job.network} />
            <Badge tone={ph.tone}>{ph.label}</Badge>
            {job.public && <Badge>public</Badge>}
            <MockBadge />
          </span>
        }
        title={job.name}
        lede={
          <>
            {describeSchedule(job.schedule)} · {job.steps.length} step{job.steps.length === 1 ? "" : "s"} · created {timeAgo(job.createdAt, now)}
            {!isOwner && <span className="text-subtle"> · owned by {shortHex(job.owner, 4)}</span>}
          </>
        }
        actions={
          isOwner ? (
            <>
              <Button variant={ph.action === "pause" ? "secondary" : "primary"} onClick={() => act(ph.action)} disabled={!!busy} title={job.stateReason}>
                {ph.action === "pause" ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                ) : ph.action === "fund" || ph.action === "top-up" ? (
                  <Coins className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden />
                )}
                {busy === "pause" ? "…" : ph.actionLabel}
              </Button>
              {phase === "out-of-gen" && (
                <Button variant="secondary" onClick={() => act("pause")} disabled={!!busy}>
                  <Pause className="h-3.5 w-3.5" aria-hidden /> {busy === "pause" ? "…" : "Pause"}
                </Button>
              )}
              {confirmDelete ? (
                <>
                  <Button variant="danger" onClick={remove} disabled={!!busy}>
                    {busy === "delete" ? "Deleting…" : "Delete for good"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={!!busy}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete job">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="grid gap-10">
        {actionError && <ErrorAlert error={actionError} />}
        {confirmDelete && job.poolId && (
          <Alert tone="warn" title="Deleting the job does not touch its pool">
            Withdraw the balance below first; the pool stays on-chain and withdrawable by your wallet either way.
          </Alert>
        )}

        <div className="grid gap-4">
          <div className="flex justify-end">
            <Segmented label="Window" value={days} options={WINDOWS} onChange={(v) => setDays(v)} />
          </div>
          <CardGrid className="grid-cols-2 sm:grid-cols-4">
            <Stat label={`Pass rate ${days === 1 ? "24h" : `${days}d`}`} value={pct(rate)} sub={`${windowRuns.filter((r) => r.pass !== null).length} decided runs`} empty={rate == null} />
            <Stat
              label="Last run"
              value={last ? runVerdict(last).label : "—"}
              sub={last ? timeAgo(last.startedAt, now) : "never"}
              empty={!last}
            />
            <Stat label="Time to accepted p50" value={seconds(p50)} sub="slowest step per run" empty={p50 == null} />
            <Stat label="Next run" value={notRunning ?? (next ? timeUntil(next, now) : "—")} sub={next ? dateTime(next) : undefined} empty={!next} />
          </CardGrid>
          <RunCharts runs={windowRuns} />
        </div>

        {job.network === "bradbury" && (
          <Section id="funding" title="Funding" subtitle="This job's GEN pool on GenLayer Testnet Bradbury. Only the owner's wallet can move it.">
            {job.poolId ? (
              <PoolPanel poolId={job.poolId} isOwner={isOwner} wallet={me?.wallet ?? null} />
            ) : (
              <Alert tone="warn" title="No pool id">
                This job was created without a pool, so the scheduler has nothing to charge.
              </Alert>
            )}
          </Section>
        )}

        {isOwner && (
          <Section id="alerts" title="Alerts" subtitle="Email when this job fails, an assertion fails or it recovers, plus an optional daily digest. Your limits, your addresses.">
            <JobAlerts job={job} wallet={me?.wallet ?? null} />
          </Section>
        )}

        <Section title="Configuration">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Steps" subtitle={`Job schedule: ${describeSchedule(job.schedule)}`} />
              <CardBody className="grid gap-3">
                {job.steps.map((s, i) => (
                  <div key={s.id} className="grid gap-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">#{i + 1}</span>
                      <span className="font-mono">{s.id}</span>
                      <Badge>{s.kind}</Badge>
                      {s.schedule && <Badge tone="purple">{describeSchedule(s.schedule)}</Badge>}
                    </p>
                    <code className="break-all text-xs text-muted">
                      {s.kind === "deploy"
                        ? `deploy ${s.preset ?? "(pasted source)"}(${JSON.stringify(s.args).slice(1, -1)})`
                        : `${s.contract}.${s.method}(${JSON.stringify(s.args).slice(1, -1)})${s.kind === "write" && s.value ? ` value ${s.value} GEN` : ""}`}
                    </code>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Assertions" subtitle="A run passes when every step succeeded and all of these hold" />
              <CardBody className="grid gap-2">
                {job.assertions.length ? (
                  job.assertions.map((a, i) => (
                    <code key={i} className="text-xs">
                      {describeAssertion(a)}
                    </code>
                  ))
                ) : (
                  <p className="text-sm text-muted">None: a run passes when every step is accepted.</p>
                )}
              </CardBody>
            </Card>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Job JSON</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs">{JSON.stringify(job, null, 2)}</pre>
          </details>
        </Section>

        <Section
          title="Runs"
          subtitle={`${runs.length} recorded, newest first`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => exportRuns("json")}>
                <Download className="h-3.5 w-3.5" aria-hidden /> JSON
              </Button>
              <Button size="sm" variant="secondary" onClick={() => exportRuns("rows")}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Rows
              </Button>
            </div>
          }
        >
          <Table bordered minWidth={820}>
            <THead>
              <tr>
                <Th>Started</Th>
                <Th>Result</Th>
                <Th>Steps</Th>
                <Th num>Time to accepted</Th>
                <Th num>Gas (GEN)</Th>
                <Th>Tx</Th>
              </tr>
            </THead>
            <TBody>
              {runs.length === 0 && (
                <EmptyRow colSpan={6}>
                  {phase === "draft" || phase === "ready"
                    ? "No runs yet. Start the job to schedule its first run."
                    : notRunning
                      ? "No runs yet."
                      : "No runs yet. The first one starts at the next slot."}
                </EmptyRow>
              )}
              {runs.slice(0, shown).map((r) => {
                const failed = r.pass === false ? failedAssertions(job, r) : [];
                const verdict = runVerdict(r);
                const gas = r.steps.reduce((acc, s) => acc + (s.gasGen ? Number(s.gasGen) : 0), 0);
                const errs = r.steps.filter((s) => s.error).map((s) => `${s.stepId}: ${s.error}`);
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <span title={r.startedAt}>{dateTime(r.startedAt)}</span>
                      <p className="text-xs text-muted">{timeAgo(r.startedAt, now)}</p>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <StatusDot tone={verdict.tone} pulse={verdict.pulse} />
                        {verdict.label}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap">
                        {r.steps.map((s) => (
                          <StepStatus key={s.stepId} s={s} />
                        ))}
                      </div>
                      {errs.length > 0 && <p className="mt-1 text-xs text-danger-fg">{errs[0]}</p>}
                      {failed.length > 0 && errs.length === 0 && <p className="mt-1 text-xs text-danger-fg">failed: {failed.join(", ")}</p>}
                    </Td>
                    <Td num>{seconds(runLatencyMs(r))}</Td>
                    <Td num>{gas ? gas.toFixed(6) : "—"}</Td>
                    <Td>
                      <div className="grid gap-0.5">
                        {r.steps
                          .filter((s) => s.txHash)
                          .map((s) => (
                            <button
                              key={s.stepId}
                              type="button"
                              className="text-left font-mono text-xs text-muted hover:text-purple"
                              title={`${s.txHash} (click to copy)`}
                              onClick={() => navigator.clipboard?.writeText(s.txHash!)}
                            >
                              {shortHex(s.txHash, 4)}
                            </button>
                          ))}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          {runs.length > shown && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => setShown(shown + 100)}>
                Show more ({runs.length - shown} older)
              </Button>
            </div>
          )}
          <p className="mt-4 break-all text-xs text-muted">
            Flat rows for Grafana (Infinity): <code className="text-foreground">{rowsUrl}</code>
            {job.public ? " (public job: no sign-in needed)" : " (needs your session cookie; make the job public to read it from Grafana)"}
            {JOBS_MOCK ? ". In mock mode this route is served in the browser only; use the Rows button." : "."}
          </p>
        </Section>
      </div>
    </PageContainer>
  );
}
