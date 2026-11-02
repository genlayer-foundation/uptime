import { NextResponse } from "next/server";
import { isStudioAllowed } from "@/lib/jobs/allowlist";
import { NONCE_TTL_SEC, SESSION_TTL_SEC, requestHost, sessionCookie, signSession, verifySiwe } from "@/lib/jobs/auth/session";
import { getRepo } from "@/lib/jobs/repo";
import { jsonError, readJson, ready, sameOrigin } from "@/lib/jobs/server";

export const dynamic = "force-dynamic";

// { message: <EIP-4361 text>, signature: 0x… } → session cookie.
export async function POST(request: Request) {
  const notReady = ready();
  if (notReady) return notReady;
  if (!sameOrigin(request)) return jsonError(403, "cross-site request refused");
  const body = await readJson(request);
  const message = typeof body?.message === "string" ? body.message : "";
  const signature = typeof body?.signature === "string" ? (body.signature as `0x${string}`) : null;
  if (!message || !signature?.startsWith("0x")) return jsonError(400, "message and signature are required");

  const repo = getRepo();
  let wallet: string;
  try {
    wallet = await verifySiwe({
      message,
      signature,
      host: requestHost(request),
      consumeNonce: (n) => repo.consumeNonce(n, NONCE_TTL_SEC),
    });
  } catch (e) {
    return jsonError(401, e instanceof Error ? e.message : "sign-in failed");
  }
  await repo.upsertUser(wallet);
  const token = signSession({ wallet, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC });
  const res = NextResponse.json({ wallet, studioAllowed: isStudioAllowed(wallet) });
  res.headers.set("set-cookie", sessionCookie(token, new URL(request.url).protocol === "https:"));
  return res;
}
