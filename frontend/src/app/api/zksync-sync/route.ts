import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ZKSYNC_RPC = "https://zksync-os-testnet-genlayer.zksync.dev";

async function getLatestBlock(): Promise<{
  number: number;
  timestamp: number;
}> {
  const res = await fetch(ZKSYNC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
  });
  const data = await res.json();
  const block = data.result;
  return {
    number: parseInt(block.number, 16),
    timestamp: parseInt(block.timestamp, 16),
  };
}

export async function GET() {
  try {
    const latest = await getLatestBlock();
    const now = Math.floor(Date.now() / 1000);
    const secondsBehind = Math.max(0, now - latest.timestamp);

    return NextResponse.json({
      rpcBlock: latest.number,
      blockTimestamp: latest.timestamp,
      currentTime: now,
      secondsBehind,
    });
  } catch (error) {
    return NextResponse.json(
      {
        rpcBlock: null,
        blockTimestamp: null,
        currentTime: null,
        secondsBehind: null,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
