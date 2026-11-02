import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/jobs/allowlist";
import { toJob, toStatus } from "@/lib/jobs/internal";
import { pauseJob } from "@/lib/jobs/service";
import { idParam, jsonError, requireUser, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// Stops scheduling at once. Owner, or an operator (UPTIME_ADMIN_WALLETS) for any job.
// (Pausing the POOL on-chain is the owner's own tx.)
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const wallet = auth.session.wallet;
  const out = await pauseJob(await serviceDeps(), wallet, await idParam(ctx), { admin: isAdmin(wallet) });
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ job: toJob(out.value), status: toStatus(out.value) });
}
