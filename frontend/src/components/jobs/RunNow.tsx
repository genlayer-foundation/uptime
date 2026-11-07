"use client";

// "Run now": one button + one cost line. Anyone can trigger one extra run,
// signed and paid by their own wallet (manualRun.ts, lib/jobs/manual.ts).

import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui";
import { approxDepositWei, manualBlocker, signableCount } from "@/lib/jobs/manualPlan";
import type { Network, Schedule, Step } from "@/lib/jobs/types";
import { formatGen } from "@/lib/pricing";
import { runNow } from "./manualRun";

type JobLike = { id: string; network: Network; steps: Step[]; schedule: Schedule; preset?: string };

export function RunNow({ job, heartbeat = false, onDone }: { job: JobLike; heartbeat?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const blocker = manualBlocker(job, heartbeat);
  if (blocker) return null;
  const txs = signableCount(job, heartbeat);
  const cost =
    job.network === "studio"
      ? "Studio: allowlisted wallets only, free."
      : `Signed from your wallet: ${txs} tx, about ${formatGen(approxDepositWei(job.network, txs), 3)} deposit, unused part refunded.`;

  async function go() {
    setBusy(true);
    setBad(false);
    setLine("Confirm in your wallet…");
    try {
      const r = await runNow(
        job.id,
        (s) =>
          setLine(
            s.phase === "sign"
              ? `Confirm step ${s.n} of ${s.of} in your wallet…`
              : s.phase === "submitted"
                ? `Step ${s.n} of ${s.of} sent, checking it on-chain…`
                : "Waiting for consensus…"
          ),
        txs
      );
      setBad(r.pass === false);
      setLine(r.pass === false ? `Run recorded: fail${r.error ? `, ${r.error}` : ""}` : "Run recorded.");
      onDone?.();
    } catch (e) {
      setBad(true);
      setLine(e instanceof Error ? e.message : String(e));
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      <Button variant="secondary" size="sm" onClick={go} disabled={busy}>
        <Play className="h-3.5 w-3.5" aria-hidden /> {busy ? "Running…" : "Run now"}
      </Button>
      <p className={`text-xs ${bad ? "text-danger-fg" : "text-muted"}`} aria-live="polite">
        {line ?? cost}
      </p>
    </div>
  );
}
