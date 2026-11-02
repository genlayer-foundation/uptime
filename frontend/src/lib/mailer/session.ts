// Read the SIWE session the backend issues (cookie `uptime_session`, HMAC with
// SESSION_SECRET). Same format as the backend branch's
// lib/uptime/auth/session.ts `readSessionToken`; when that lands on main,
// replace this file's body with a re-export of `getSession`.
// Fail closed: no SESSION_SECRET (>= 32 chars) => nobody is signed in.

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "uptime_session";

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The signed-in wallet (lowercased), or null. */
export function sessionWallet(request: Request, nowSec = Math.floor(Date.now() / 1000)): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const token = cookieValue(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(createHmac("sha256", secret).update(payload).digest("base64url"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as { wallet?: unknown; exp?: unknown };
    if (typeof s.wallet !== "string" || typeof s.exp !== "number" || s.exp <= nowSec) return null;
    const w = s.wallet.toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(w) ? w : null;
  } catch {
    return null;
  }
}
