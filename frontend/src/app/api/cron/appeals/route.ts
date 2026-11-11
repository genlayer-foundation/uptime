import { NextResponse } from "next/server";
import { authorized } from "@/lib/heartbeat/auth";
import { runAppealWatch } from "@/lib/heartbeat/runner";
import { storeConfigured } from "@/lib/heartbeat/store";

export const dynamic = "force-dynamic";
// Longer than the one-minute cron on purpose: consecutive calls overlap, so a
// probe waiting for its appeal is read every few seconds with no gap.
export const maxDuration = 120;

// Every minute: the Bradbury Heartbeat's appeal watch (lib/heartbeat/runner.ts).
// An appeal can only be filed between a decision and its finalization, about a
// minute on Bradbury, so the 10-minute reconcile could never file one. Returns
// at once unless an appeal-due probe (every 5th tick) is still undecided.
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!storeConfigured()) return NextResponse.json({ skipped: "no Heartbeat store configured" });
  try {
    return NextResponse.json(await runAppealWatch());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
