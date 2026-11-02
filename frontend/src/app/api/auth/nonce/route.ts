import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { getRepo } from "@/lib/jobs/repo";
import { ready } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// Single-use SIWE nonce, valid 10 minutes. POST is the contract; GET kept as
// an alias for simple clients.
export async function POST() {
  const notReady = ready();
  if (notReady) return notReady;
  const nonce = generateSiweNonce();
  await getRepo().createNonce(nonce);
  return NextResponse.json({ nonce });
}

export const GET = POST;
