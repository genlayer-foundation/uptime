import { NextResponse } from "next/server";
import { getContractAddress, NETWORK } from "@/lib/genlayer/client";
import { DEMO_CONTRACT, demoSnapshot } from "@/lib/heartbeat/demo";
import {
  PRODUCTION_ENDPOINT,
  SOURCE_PARAM,
  resolveSource,
  sourceSwitchAllowed,
  type DataSource,
} from "@/lib/heartbeat/source";
import { getPending, getResults, type ProbeRecord } from "@/lib/heartbeat/store";
import { summarize } from "@/lib/heartbeat/summary";

export const dynamic = "force-dynamic";

const SOURCE_HEADER = "X-Heartbeat-Source";
const PROXY_TIMEOUT_MS = 10_000;

// Dev only (resolveSource returns "local" in any deployed build): forward the
// same query to the public endpoint and pass its JSON through untouched.
async function proxyProduction(url: URL): Promise<NextResponse> {
  const params = new URLSearchParams(url.searchParams);
  params.delete(SOURCE_PARAM);
  const target = `${PRODUCTION_ENDPOINT}?${params}`;
  const host = new URL(PRODUCTION_ENDPOINT).host;
  const fail = (detail: string) =>
    NextResponse.json(
      { error: `Production source (${host}) is unavailable: ${detail}`, source: "production" },
      { status: 502, headers: { [SOURCE_HEADER]: "production" } }
    );
  let res: Response;
  try {
    res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) return fail(`it answered ${res.status}${res.status === 404 ? " (not deployed yet?)" : ""}.`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail("it did not return JSON.");
  }
  const out = Array.isArray(body) ? body : { ...(body as object), source: "production" };
  return NextResponse.json(out, { headers: { [SOURCE_HEADER]: "production" } });
}

// Public, read-only. Two shapes:
//   /api/heartbeat?hours=168              summary + hourly series + recent
//   /api/heartbeat?hours=168&format=rows  one flat row per probe (Grafana)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const source: DataSource = resolveSource(request);
  if (source === "production") return proxyProduction(url);

  const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 168, 1), 24 * 90);
  const nowSec = Math.floor(Date.now() / 1000);
  const since = nowSec - hours * 3600;

  let results: ProbeRecord[];
  let pending: ProbeRecord[];
  if (source === "demo") {
    ({ results, pending } = demoSnapshot(since, nowSec));
  } else if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    // Not configured on this server yet: say so instead of an empty 500.
    return NextResponse.json(
      { error: "Bradbury Heartbeat is not recording on this server yet (no results store configured)." },
      { status: 503 }
    );
  } else {
    [results, pending] = await Promise.all([getResults(since), getPending()]);
  }
  // Only a dev server labels its responses; the deployed JSON is unchanged.
  const headers = sourceSwitchAllowed() ? { [SOURCE_HEADER]: source } : undefined;

  if (url.searchParams.get("format") === "rows") {
    return NextResponse.json(
      results.map((r) => ({
        time: r.submittedAt * 1000,
        tick: r.tick,
        kind: r.kind,
        qid: r.qid ?? "",
        qkind: r.qkind ?? "",
        status: r.status ?? "",
        grade: r.grade ?? "",
        correct: r.grade === "correct" ? 1 : 0,
        injected: r.grade === "injected" ? 1 : 0,
        upheld: r.upheld ? 1 : 0,
        latency_sec: r.latencySec ?? null,
        rounds: r.rounds ?? null,
        votes_agree: r.votes?.agree ?? null,
        votes_disagree: r.votes?.disagree ?? null,
        votes_timeout: r.votes?.timeout ?? null,
        answer: r.answer ?? "",
        tx: r.txHash ?? "",
        error: r.error ?? "",
      })),
      { headers }
    );
  }

  return NextResponse.json(
    {
      network: NETWORK.name,
      contract: source === "demo" ? DEMO_CONTRACT : (getContractAddress() ?? null),
      explorerUrl: NETWORK.explorerUrl,
      generatedAt: nowSec,
      hours,
      ...summarize(results),
      pending: pending.length,
      recent: results.slice(-50).reverse(),
      ...(headers ? { source } : {}),
    },
    { headers }
  );
}
