import { NextResponse } from "next/server";
import { isStudioAllowed } from "@/lib/jobs/allowlist";
import { getSession, sessionSecret } from "@/lib/jobs/auth/session";
import { relayerAddress } from "@/lib/jobs/chain";
import { hasDatabase } from "@/lib/jobs/db";
import { poolAddress } from "@/lib/pool/abi";

export const dynamic = "force-dynamic";

// Who is signed in, and what the server will let them do.
//   ready          sign-in is possible at all (DATABASE_URL + SESSION_SECRET)
//   studioAllowed  the server accepts Studio jobs from this wallet
//   relayers       the address each network's runs are signed by ({{relayer}}),
//                  which owner-gated contracts must authorize
//   pool           the Bradbury UptimePool address (null = not deployed yet)
export async function GET(request: Request) {
  const ok = hasDatabase() && !!sessionSecret();
  const s = ok ? getSession(request) : null;
  return NextResponse.json({
    ready: ok,
    wallet: s?.wallet ?? null,
    studioAllowed: s ? isStudioAllowed(s.wallet) : false,
    relayers: { studio: relayerAddress("studio"), bradbury: relayerAddress("bradbury") },
    pool: { bradbury: poolAddress() },
  });
}
