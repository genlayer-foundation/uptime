import { NextResponse } from "next/server";
import { authorized } from "@/lib/heartbeat/auth";
import { hasDatabase } from "@/lib/jobs/db";
import { settle } from "@/lib/jobs/pool/pool";
import { getRepo } from "@/lib/jobs/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly: one batched `charge` (scheduler role 1) on the Bradbury pool for
// every unsettled step run. A no-op unless POOL_CHARGING_ENABLED=1.
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ enabled: false, reason: "DATABASE_URL not configured" });
  try {
    return NextResponse.json(await settle(getRepo(), Math.floor(Date.now() / 1000)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
