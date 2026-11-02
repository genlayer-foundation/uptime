// Wallet sign-in (EIP-4361 / SIWE) and the session cookie that follows it.
//
// Flow: GET /api/auth/nonce issues a single-use nonce (stored in Postgres);
// the browser builds a SIWE message with it, the wallet signs it, and
// POST /api/auth/verify checks domain, nonce, expiry and the signature, then
// sets an HMAC-signed, httpOnly cookie. No passwords, no email.
//
// Fail closed: without SESSION_SECRET (>= 32 chars) no session can be issued
// or read, so every user route answers 401/503.

import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";

export const SESSION_COOKIE = "uptime_session";
export const SESSION_TTL_SEC = 7 * 24 * 3600;
export const NONCE_TTL_SEC = 10 * 60;

export interface Session {
  wallet: string; // lowercased
  exp: number; // unix seconds
}

export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function b64(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(s: Session, secret = sessionSecret()): string {
  if (!secret) throw new Error("SESSION_SECRET not configured");
  const payload = b64(JSON.stringify(s));
  return `${payload}.${mac(payload, secret)}`;
}

export function readSessionToken(token: string | undefined, nowSec: number, secret = sessionSecret()): Session | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.wallet !== "string" || typeof s.exp !== "number" || s.exp <= nowSec) return null;
    return { wallet: s.wallet.toLowerCase(), exp: s.exp };
  } catch {
    return null;
  }
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined; // malformed cookie: not signed in
      }
    }
  }
  return undefined;
}

export function getSession(request: Request, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  return readSessionToken(cookieValue(request.headers.get("cookie"), SESSION_COOKIE), nowSec);
}

// The signed-in wallet (lowercased, 0x + 40 hex), or null. The one session
// check other modules (e.g. lib/mailer) re-export.
export function sessionWallet(request: Request, nowSec = Math.floor(Date.now() / 1000)): string | null {
  const w = getSession(request, nowSec)?.wallet ?? null;
  return w && /^0x[0-9a-f]{40}$/.test(w) ? w : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SEC}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// The host the browser used, which the SIWE message's domain must match.
export function requestHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
}

export interface SiweCheck {
  message: string;
  signature: `0x${string}`;
  host: string;
  consumeNonce: (nonce: string) => Promise<boolean>;
}

// Returns the signing wallet (lowercased) or throws with a safe message.
// EOA signatures only (ERC-1271 smart wallets would need an RPC call).
export async function verifySiwe({ message, signature, host, consumeNonce }: SiweCheck): Promise<string> {
  const fields = parseSiweMessage(message);
  if (!fields.address || !fields.nonce) throw new Error("Not a sign-in message");
  if (fields.domain !== host) throw new Error("Sign-in message is for a different site");
  if (!validateSiweMessage({ message: fields, domain: host, time: new Date() })) {
    throw new Error("Sign-in message is expired or malformed");
  }
  const ok = await verifyMessage({ address: fields.address, message, signature });
  if (!ok) throw new Error("Signature does not match the wallet");
  // Consume last: a bad signature must not burn someone's nonce.
  if (!(await consumeNonce(fields.nonce))) throw new Error("Sign-in nonce is unknown, used or expired");
  return fields.address.toLowerCase();
}
