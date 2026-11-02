import { NextResponse } from "next/server";
import { runReconcile } from "@/lib/heartbeat/runner";
import { authorized } from "@/lib/heartbeat/auth";
import { hasDatabase } from "@/lib/jobs/db";
import { reconcile } from "@/lib/jobs/executor";
import { executorDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// Two reconcilers, independent so one failing never blocks the other: the
// Bradbury Heartbeat's own (KV: grading, appeals; response shape unchanged)
// and the generic job executor (Postgres), reported under `jobs`.
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [heartbeat, jobs] = await Promise.all([
    runReconcile().catch((e) => ({ error: msg(e) })),
    hasDatabase()
      ? executorDeps()
          .then((d) => reconcile({ ...d, budgetMs: 25_000 }))
          .catch((e) => ({ error: msg(e) }))
      : Promise.resolve({ skipped: "DATABASE_URL not configured" }),
  ]);
  return NextResponse.json({ ...heartbeat, jobs }, { status: "error" in heartbeat ? 500 : 200 });
}
