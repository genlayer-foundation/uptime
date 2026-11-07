import { NextResponse } from "next/server";
import { getSession } from "@/lib/jobs/auth/session";
import { hasDatabase } from "@/lib/jobs/db";
import { pollManual, reportManual, startManual } from "@/lib/jobs/manual";
import { idParam, jsonError, manualDeps, readJson, sameOrigin } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// "Run now" for any public job, signed and paid by the visitor's own wallet.
// No sign-in: every transaction is verified on-chain before it is recorded
// (lib/jobs/manual.ts). Private jobs answer 404 unless the viewer may see them.
//   POST {runner}                 start: the first tx to sign + a run token
//   POST {token|runId, txHash}    report a signed tx; returns the next one, or done
//   GET  ?run=<runId>             poll: measures pending txs
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return jsonError(503, "DATABASE_URL not configured");
  if (!sameOrigin(request)) return jsonError(403, "cross-site request refused");
  const body = await readJson(request);
  if (!body) return jsonError(400, "JSON body required");
  const id = await idParam(ctx);
  const viewer = getSession(request)?.wallet ?? null;
  const out =
    body.txHash !== undefined
      ? await reportManual(manualDeps(), id, body, viewer)
      : await startManual(manualDeps(), id, body.runner, viewer);
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json(out.value);
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return jsonError(503, "DATABASE_URL not configured");
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(runId)) return jsonError(400, "?run=<runId> required");
  const out = await pollManual(manualDeps(), await idParam(ctx), runId, getSession(request)?.wallet ?? null);
  if (!out.ok) return jsonError(out.status, out.error);
  return NextResponse.json(out.value);
}
