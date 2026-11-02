import { NextResponse } from "next/server";
import { getContractAddress, getWriteClient } from "@/lib/genlayer/client";
import { authorized } from "@/lib/heartbeat/auth";
import { hasDatabase } from "@/lib/jobs/db";
import { dispatchDue, ensureHeartbeatJob } from "@/lib/jobs/executor";
import { executorDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function heartbeatOwner(): string | null {
  try {
    return getWriteClient().account?.address ?? null;
  } catch {
    return null;
  }
}

// Every 5 minutes: find due jobs and start their runs. Never waits on
// consensus. The Bradbury Heartbeat example job is created here on first use
// (owner = the PRIVATE_KEY wallet) and ticks hourly at :00.
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  try {
    const deps = await executorDeps();
    await ensureHeartbeatJob(deps.repo, heartbeatOwner(), getContractAddress() ?? null, deps.nowSec()).catch(() => null);
    return NextResponse.json(await dispatchDue(deps));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
