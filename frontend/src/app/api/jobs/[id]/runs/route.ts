import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/jobs/allowlist";
import { getSession } from "@/lib/jobs/auth/session";
import { hasDatabase } from "@/lib/jobs/db";
import { toPublicRun } from "@/lib/jobs/executor";
import { toRows } from "@/lib/jobs/export";
import { idParam, jsonError, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// Newest first. Owner, an operator, or anyone when the job is public.
//   ?format=json (default)  { runs: Run[] }
//   ?format=rows            one flat row per step run (Grafana Infinity)
//   ?limit=1..1000          default 100
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return jsonError(503, "DATABASE_URL not configured");
  const id = await idParam(ctx);
  const { repo } = await serviceDeps();
  const j = id ? await repo.getJob(id) : null;
  const viewer = getSession(request)?.wallet;
  if (!j || (!j.public && j.owner !== viewer && !isAdmin(viewer))) return jsonError(404, "job not found");
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 1000);
  const runs = await repo.listRuns(j.id, limit);
  if (url.searchParams.get("format") === "rows") return NextResponse.json(toRows(runs));
  return NextResponse.json({ runs: runs.map(toPublicRun) });
}
