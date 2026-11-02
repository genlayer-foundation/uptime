// Email address handling. An address is personal data: never log it unmasked.

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lowercase + trim. Returns null for anything that is not a plain, sendable address. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  const at = e.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  return EMAIL_RE.test(e) ? e : null;
}

export function isValidEmail(input: unknown): boolean {
  return normalizeEmail(input) !== null;
}

/** "ivan@genlayer.foundation" -> "i***n@genlayer.foundation". For logs only. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const head = local[0];
  const tail = local.length > 2 ? local[local.length - 1] : "";
  return `${head}***${tail}${email.slice(at)}`;
}

export function normalizeWallet(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const w = input.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(w) ? w : null;
}
