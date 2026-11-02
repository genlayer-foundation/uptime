import { NextResponse } from "next/server";
import { toJob, toStatus } from "@/lib/jobs/internal";
import { pauseJob } from "@/lib/jobs/service";
import { idParam, jsonError, requireUser, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// Stops scheduling at once. (Pausing the POOL on-chain is the owner's own tx.)
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const out = await pauseJob(await serviceDeps(), auth.session.wallet, await idParam(ctx));
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ job: toJob(out.value), status: toStatus(out.value) });
}
