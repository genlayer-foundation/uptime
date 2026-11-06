import { ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader, type Tone } from "@/components/ui";
import { APPEAL_EVERY, probeDef } from "@/lib/heartbeat/probes";
import type { HeartbeatData, ProbeRecord } from "./types";
import { duration } from "./format";

// "One run, step by step": the newest run's five actions and the
// every-5th-run appeal, each naming the contract it touches and what it
// checks. Results come from GET /api/heartbeat `latestRun`.

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function result(r: ProbeRecord | undefined): { label: string; tone: Tone } {
  if (!r) return { label: "Not sent", tone: "neutral" };
  if (!r.status) return { label: "Waiting for validators", tone: "neutral" };
  if (r.status === "SUBMIT_FAILED") return { label: "Missed (our side)", tone: "warn" };
  if (r.kind === "appeal") {
    if (r.outcome === "upheld") return { label: "Upheld", tone: "success" };
    if (r.outcome === "overturned") return { label: "Overturned", tone: "danger" };
    if (r.outcome === "withdrawn") return { label: "No new round", tone: "neutral" };
    return { label: "Waiting for validators", tone: "neutral" };
  }
  if (r.grade === "correct") return { label: `Pass${r.latencySec !== undefined ? ` · ${duration(r.latencySec)}` : ""}`, tone: "success" };
  if (r.grade === "wrong" || r.grade === "injected") return { label: r.grade === "injected" ? "Fail · followed the hidden line" : "Fail · wrong answer", tone: "danger" };
  if (r.status === "UNDETERMINED") return { label: "No agreement", tone: "danger" };
  if (r.status.includes("TIMEOUT") || r.status === "CANCELED") return { label: "Timed out", tone: "danger" };
  if (r.error) return { label: "Error", tone: "danger" };
  return { label: "Decided, not graded yet", tone: "neutral" };
}

function ContractLink({ explorer, address, label }: { explorer: string; address: string; label: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-muted transition-colors hover:text-foreground"
      href={`${explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      <span>
        {label} <span className="font-mono text-xs">{short(address)}</span>
      </span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  );
}

interface Row {
  n: string;
  action: string;
  contract: React.ReactNode;
  checks: string;
  rec?: ProbeRecord;
  note?: string;
}

export function RunSteps({ data }: { data: HeartbeatData | null }) {
  const run = data?.latestRun ?? null;
  const explorer = data?.explorerUrl ?? "";
  const hb = data?.contract ?? null;
  const heartbeat = hb ? <ContractLink explorer={explorer} address={hb} label="Heartbeat" /> : <span className="text-muted">Heartbeat</span>;
  const by = (kind: ProbeRecord["kind"]) => run?.actions.filter((a) => a.kind === kind) ?? [];
  const deploy = by("deploy")[0];
  const asks = by("llm");
  const appeal = run?.lastAppeal ?? null;
  // An appeal is sent once action 4 of every 5th run is decided.
  const thisRunDue = !!run && run.tick % APPEAL_EVERY === 0 && appeal?.tick !== run.tick;
  const nextAppeal = run ? (thisRunDue ? run.tick : (Math.floor(run.tick / APPEAL_EVERY) + 1) * APPEAL_EVERY) : null;
  const appealNote = [appeal ? `Last appeal: run #${appeal.tick}` : null, nextAppeal ? `Next: run #${nextAppeal}` : null].filter(Boolean).join(" · ");

  const rows: Row[] = [
    {
      n: "1",
      action: "Deploy a contract",
      contract: deploy?.address ? (
        <ContractLink explorer={explorer} address={deploy.address} label="Canary (new)" />
      ) : (
        <span className="text-muted">Canary (new)</span>
      ),
      checks: "Deploys and holds the run number",
      rec: deploy,
    },
    { n: "2", action: "Call bump", contract: heartbeat, checks: "A plain write lands", rec: by("write")[0] },
    { n: "3", action: "Call probe_status", contract: heartbeat, checks: "Fetches a known page exactly", rec: by("fetch")[0] },
    ...[0, 1].map((i): Row => {
      const r = asks[i];
      const def = probeDef(r?.qid);
      return {
        n: String(4 + i),
        action: "Call probe",
        contract: heartbeat,
        checks: def ? def.title : "A rotating test question",
        rec: r,
      };
    }),
    {
      n: "↳",
      action: `Appeal #4, every ${APPEAL_EVERY}th run`,
      contract: heartbeat,
      checks: "A new round keeps the right answer",
      rec: appeal ?? undefined,
      note: appealNote || undefined,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="One run"
        subtitle={
          run
            ? `Latest run #${run.tick} · ${new Date(run.submittedAt * 1000).toUTCString().slice(17, 22)} UTC`
            : undefined
        }
      />
      <div className="hidden grid-cols-[2rem_1.1fr_1.2fr_1.6fr_11rem] gap-4 border-b border-border bg-surface px-5 py-3 text-xs font-medium text-muted md:grid">
        <span>#</span>
        <span>Action</span>
        <span>Contract</span>
        <span>Checks</span>
        <span>This run</span>
      </div>
      <ol>
        {rows.map((r) => {
          const res = r.n === "↳" && !r.rec ? null : result(r.rec);
          return (
            <li
              key={r.n}
              className="grid gap-x-4 gap-y-1 border-b border-border/50 px-5 py-3 text-sm last:border-0 md:grid-cols-[2rem_1.1fr_1.2fr_1.6fr_11rem]"
            >
              <span className="font-mono text-xs text-muted md:text-sm">{r.n}</span>
              <span className="font-medium text-foreground">{r.action}</span>
              <span className="text-sm">{r.contract}</span>
              <span className="text-xs leading-relaxed text-muted md:text-sm">{r.checks}</span>
              <span className="flex flex-col items-start gap-1 pt-1 md:pt-0">
                {res ? (
                  <Badge tone={res.tone} title={r.rec?.error}>
                    {res.label}
                  </Badge>
                ) : null}
                {r.note ? <span className="text-xs text-muted">{r.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
