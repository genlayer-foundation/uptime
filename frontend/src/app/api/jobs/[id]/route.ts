import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/jobs/allowlist";
import { getSession } from "@/lib/jobs/auth/session";
import { hasDatabase } from "@/lib/jobs/db";
import { toJob, toStatus } from "@/lib/jobs/internal";
import { deleteJob, editJob } from "@/lib/jobs/service";
import { idParam, jsonError, readJson, requireUser, serviceDeps } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Owner, an operator, or anyone when the job is public. { job, status, owner }
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabase()) return jsonError(503, "DATABASE_URL not configured");
  const id = await idParam(ctx);
  const { repo } = await serviceDeps();
  const j = id ? await repo.getJob(id) : null;
  const viewer = getSession(request)?.wallet;
  if (!j || (!j.public && j.owner !== viewer && !isAdmin(viewer))) return jsonError(404, "job not found");
  return NextResponse.json({ job: toJob(j), status: toStatus(j), owner: j.owner === viewer });
}

// Any of { name, schedule, steps, assertions, public, perRunCapWei }.
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (!body) return jsonError(400, "JSON body required");
  const out = await editJob(await serviceDeps(), auth.session.wallet, await idParam(ctx), body);
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ job: toJob(out.value), status: toStatus(out.value) });
}

// Soft delete: the job stops and disappears; its run history is kept.
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const out = await deleteJob(await serviceDeps(), auth.session.wallet, await idParam(ctx));
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json({ ok: true });
}
