import { NextResponse } from "next/server";
import { getWriteClient, NETWORKS, type NetworkId } from "@/lib/genlayer/client";
import { storeTxHash, setLatestTxHash } from "@/lib/cache/kv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const results: Record<string, { success: boolean; error?: string }> = {};

  const networkId = (process.env.DEPLOY_NETWORK || "studionet") as NetworkId;
  const network = NETWORKS[networkId];

  if (!network?.contractAddress) {
    return NextResponse.json(
      { error: `No contract address for ${networkId}` },
      { status: 500 }
    );
  }

  try {
    const client = getWriteClient(networkId);
    const txHash = await client.writeContract({
      address: network.contractAddress,
      functionName: "run_checks",
      args: [timestamp],
      value: 0n,
    });

    // Wait for the transaction to reach a decided state
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        retries: 30,
        interval: 2000,
      });
    } catch {
      // waitForTransactionReceipt throws on non-ACCEPTED — fetch receipt manually
      receipt = await client.getTransaction({ hash: txHash });
    }
    const txStatus = String(
      receipt?.statusName ?? receipt?.status ?? ""
    );
    const isSuccess =
      txStatus === "ACCEPTED" ||
      txStatus === "FINALIZED" ||
      txStatus === "5" ||
      txStatus === "7";
    results[networkId] = {
      success: isSuccess,
      ...(!isSuccess && { error: `status=${txStatus}` }),
    };

    // Store txHash in KV for on-chain verification links
    if (txHash) {
      try {
        await storeTxHash(networkId, Number(timestamp), txHash);
        await setLatestTxHash(networkId, txHash, Number(timestamp));
      } catch (kvError) {
        console.warn("Failed to store txHash in KV:", kvError);
      }
    }
  } catch (error) {
    results[networkId] = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return NextResponse.json({
    timestamp: Number(timestamp),
    results,
  });
}
