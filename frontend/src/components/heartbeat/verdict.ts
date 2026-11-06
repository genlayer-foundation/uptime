// The one-line answer to "is it working?", shared by the home page's live
// strip and the Heartbeat page. Built only from GET /api/heartbeat's `runs`,
// which keeps runs WE failed to send apart from runs the network got wrong.
import type { RunsSummary } from "@/lib/heartbeat/summary";
import type { Tone } from "@/components/ui";

export interface Verdict {
  tone: Tone;
  text: string; // without the "last run …" tail, which is rendered live
}

export function verdict(runs: RunsSummary | null | undefined): Verdict | null {
  if (!runs || runs.runs === 0) return null;
  const last = runs.lastCompleted;
  if (!last) return { tone: "neutral", text: "First run waiting for validators" };
  if (last.outcome === "passed") return { tone: "success", text: "All checks passing" };
  if (last.outcome === "failed")
    return { tone: "danger", text: `Last run failed ${last.notCorrect} of ${last.actions} checks` };
  return { tone: "warn", text: "Last run missed on our side: not every action was sent" };
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(sec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}
