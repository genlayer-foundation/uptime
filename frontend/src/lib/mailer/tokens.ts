// HMAC tokens for the two links an email carries. Both use MAILER_TOKEN_SECRET,
// separated by a versioned domain prefix so one can never be replayed as the other.
//
// - Unsubscribe: HMAC("unsubscribe:v1:" + email). Stateless and scoped to ONE
//   address, so a link in an old email keeps working, survives a DB restore, and
//   a token for a@x cannot act on b@x (the Deckard design, email.md §4.2).
// - Confirmation: HMAC("verify:v1:" + id + email + wallet + exp). Bound to the
//   recipient row, the address AND the owner wallet, and it expires.

import { createHmac, timingSafeEqual } from "node:crypto";

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function unsubscribeToken(secret: string, email: string): string {
  return mac(secret, `unsubscribe:v1:${email}`);
}

export function checkUnsubscribeToken(secret: string, email: string, token: string): boolean {
  return typeof token === "string" && same(unsubscribeToken(secret, email), token);
}

export function verifyToken(secret: string, id: number, email: string, wallet: string, exp: number): string {
  return mac(secret, `verify:v1:${id}:${email}:${wallet}:${exp}`);
}

export function checkVerifyToken(
  secret: string,
  r: { id: number; email: string; ownerWallet: string },
  exp: number,
  token: string,
  nowSec: number
): boolean {
  if (!Number.isFinite(exp) || exp <= nowSec || typeof token !== "string") return false;
  return same(verifyToken(secret, r.id, r.email, r.ownerWallet, exp), token);
}

export function unsubscribeUrl(base: string, secret: string, email: string): string {
  const q = new URLSearchParams({ e: email, t: unsubscribeToken(secret, email) });
  return `${base}/api/alerts/unsubscribe?${q.toString()}`;
}

export function verifyUrl(base: string, secret: string, id: number, email: string, wallet: string, exp: number): string {
  const q = new URLSearchParams({ r: String(id), x: String(exp), t: verifyToken(secret, id, email, wallet, exp) });
  return `${base}/api/alerts/verify?${q.toString()}`;
}
