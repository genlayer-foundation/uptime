import { NextResponse } from "next/server";
import { runTick } from "@/lib/heartbeat/runner";
import { authorized } from "@/lib/heartbeat/auth";
import { hasDatabase } from "@/lib/jobs/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Legacy hourly tick. Once Postgres is configured the Heartbeat is a system
// uptime scheduled by /api/cron/dispatch, and this route stands down so a
// tick is never submitted twice. Without a database it behaves as before.
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (hasDatabase()) {
    return NextResponse.json({ skipped: "scheduled by /api/cron/dispatch" });
  }
  try {
    const probes = await runTick();
    return NextResponse.json({ probes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
