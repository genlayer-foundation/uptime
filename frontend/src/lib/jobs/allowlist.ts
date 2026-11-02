// Studio allowlist: a fixed, committed file (config/studio-allowlist.json).
// Fail closed — a missing, malformed or empty list allows nobody.
// Checked server-side at create/edit/resume AND by the scheduler before
// every Studio run; the UI only mirrors it.

import file from "../../../config/studio-allowlist.json";

export interface AllowlistEntry {
  address: string;
  name?: string;
  org?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseAllowlist(raw: unknown): Set<string> {
  const wallets = (raw as { wallets?: unknown } | null)?.wallets;
  if (!Array.isArray(wallets)) return new Set();
  const out = new Set<string>();
  for (const w of wallets) {
    const a = typeof w === "string" ? w : (w as AllowlistEntry | null)?.address;
    if (typeof a === "string" && ADDRESS.test(a)) out.add(a.toLowerCase());
  }
  return out;
}

export const STUDIO_ALLOWLIST: ReadonlySet<string> = parseAllowlist(file);

export function isStudioAllowed(wallet: string, list: ReadonlySet<string> = STUDIO_ALLOWLIST): boolean {
  return list.has(wallet.toLowerCase());
}

// Per-wallet quota on Studio: the Foundation pays for every LLM call there.
export function studioMaxJobs(): number {
  const n = Number(process.env.STUDIO_MAX_JOBS_PER_WALLET);
  return Number.isInteger(n) && n > 0 ? n : 10;
}
