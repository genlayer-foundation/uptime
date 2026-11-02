// Flat rows for Grafana (Infinity), spreadsheets and the jobs UI: one row per
// step run. Each row carries BOTH the jobs UI's RunRow fields (camelCase, see
// lib/jobs/client.ts) and the GET /api/heartbeat?format=rows fields (time in
// ms, status, latency_sec, rounds, votes_*, answer, tx, error).

import { formatEther } from "viem";
import type { RunRow } from "./internal";

export interface ExportRow {
  // jobs UI RunRow
  runId: string;
  jobId: string;
  startedAt: string; // ISO
  pass: boolean | null; // the run's verdict; null while running
  stepId: string;
  status: string;
  txHash?: string;
  timeToAcceptedMs?: number;
  gasGen?: string;
  error?: string;
  // heartbeat-style, for Grafana
  time: number; // ms, when the step was submitted (or the run started)
  slot: number; // unix seconds
  kind: string;
  chain_status: string;
  pass_num: number | null; // 1 / 0 / null
  latency_sec: number | null; // time to ACCEPTED
  rounds: number | null;
  votes_agree: number | null;
  votes_disagree: number | null;
  votes_timeout: number | null;
  answer: string; // the step's recorded result, as JSON text
  tx: string;
}

export function toRows(runs: RunRow[]): ExportRow[] {
  const out: ExportRow[] = [];
  for (const r of runs) {
    const steps = r.steps.length
      ? r.steps
      : [{ idx: 0, stepId: r.group, kind: "skipped", status: "ERROR", submittedAt: null, resolvedAt: null } as unknown as RunRow["steps"][number]];
    for (const s of steps) {
      const error = s.error ?? (r.state === "SKIPPED" ? `skipped: ${r.error ?? ""}` : undefined);
      out.push({
        runId: r.id,
        jobId: r.jobId,
        startedAt: new Date(r.startedAt * 1000).toISOString(),
        pass: r.pass,
        stepId: s.stepId,
        status: s.status,
        ...(s.txHash ? { txHash: s.txHash } : {}),
        ...(s.timeToAcceptedMs !== undefined ? { timeToAcceptedMs: s.timeToAcceptedMs } : {}),
        ...(s.gasWei ? { gasGen: formatEther(BigInt(s.gasWei)) } : {}),
        ...(error ? { error } : {}),
        time: (s.submittedAt ?? r.startedAt) * 1000,
        slot: r.scheduledFor,
        kind: s.kind,
        chain_status: s.chainStatus ?? "",
        pass_num: r.pass === null ? null : r.pass ? 1 : 0,
        latency_sec: s.timeToAcceptedMs !== undefined ? s.timeToAcceptedMs / 1000 : null,
        rounds: s.rounds ?? null,
        votes_agree: s.votes?.agree ?? null,
        votes_disagree: s.votes?.disagree ?? null,
        votes_timeout: s.votes?.timeout ?? null,
        answer: s.result === undefined ? "" : typeof s.result === "string" ? s.result : JSON.stringify(s.result).slice(0, 2000),
        tx: s.txHash ?? "",
      });
    }
  }
  return out;
}
