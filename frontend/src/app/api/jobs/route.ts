import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/jobs/allowlist";
import { hasDatabase } from "@/lib/jobs/db";
import { toPublicRun } from "@/lib/jobs/executor";
import { toJob, toStatus, type JobRow } from "@/lib/jobs/internal";
import type { Repo } from "@/lib/jobs/repo";
import { createJob } from "@/lib/jobs/service";
import { jsonError, readJson, requireUser, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

async function withMeta(repo: Repo, rows: JobRow[]) {
  const meta: Record<string, unknown> = {};
  for (const j of rows) {
    const [last] = await repo.listRuns(j.id, 1);
    meta[String(j.id)] = { status: toStatus(j), lastRun: last ? toPublicRun(last) : null };
  }
  return { jobs: rows.map(toJob), meta };
}

// GET            the signed-in wallet's jobs
// GET ?public=1  public example jobs, no sign-in needed
// GET ?all=1     every job (operators in UPTIME_ADMIN_WALLETS only; 403 otherwise)
// Response: { jobs: Job[], meta: { [id]: { status, lastRun: Run | null } } }
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("public") === "1") {
    if (!hasDatabase()) return NextResponse.json({ jobs: [], meta: {} });
    const { repo } = await serviceDeps();
    return NextResponse.json(await withMeta(repo, await repo.listPublicJobs()));
  }
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const { repo } = await serviceDeps();
  if (new URL(request.url).searchParams.get("all") === "1") {
    if (!isAdmin(auth.session.wallet)) return jsonError(403, "operators only");
    return NextResponse.json(await withMeta(repo, await repo.listAllJobs(500)));
  }
  return NextResponse.json(await withMeta(repo, await repo.listJobs(auth.session.wallet)));
}

// Body: { name, network, schedule, steps, assertions?, public?, preset?, perRunCapWei? }
// → 201 { job, status }. Studio needs an allowlisted wallet (403 otherwise).
// Bradbury jobs start as drafts (paused) until their pool is funded and resumed.
export async function POST(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (!body) return jsonError(400, "JSON body required");
  const out = await createJob(await serviceDeps(), auth.session.wallet, body);
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ job: toJob(out.value), status: toStatus(out.value) }, { status: 201 });
}
