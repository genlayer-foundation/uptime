import { NextResponse } from "next/server";
import { toJob, toStatus } from "@/lib/jobs/internal";
import { resumeJob } from "@/lib/jobs/service";
import { idParam, jsonError, requireUser, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// Resume a paused job, or activate a Bradbury draft once its pool is funded.
// Runs the same gate as the scheduler: 403 off the Studio allowlist, 409 when
// the pool is missing, foreign, paused or short. Missed slots are skipped.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const out = await resumeJob(await serviceDeps(), auth.session.wallet, await idParam(ctx));
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ job: toJob(out.value), status: toStatus(out.value) });
}
