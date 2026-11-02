import { NextResponse } from "next/server";
import { getContractAddress, NETWORK } from "@/lib/genlayer/client";
import { getPending, getResults } from "@/lib/heartbeat/store";
import { summarize } from "@/lib/heartbeat/summary";

export const dynamic = "force-dynamic";

// Public, read-only. Two shapes:
//   /api/heartbeat?hours=168              summary + hourly series + recent
//   /api/heartbeat?hours=168&format=rows  one flat row per probe (Grafana)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 168, 1), 24 * 90);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const [results, pending] = await Promise.all([getResults(since), getPending()]);

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
      }))
    );
  }

  return NextResponse.json({
    network: NETWORK.name,
    contract: getContractAddress() ?? null,
    explorerUrl: NETWORK.explorerUrl,
    generatedAt: Math.floor(Date.now() / 1000),
    hours,
    ...summarize(results),
    pending: pending.length,
    recent: results.slice(-50).reverse(),
  });
}
