// Wallet lists from env, read at call time (no committed list).
//
//   STUDIO_ALLOWLIST      comma-separated wallets (GenLayer Labs + Foundation)
//                         allowed to run jobs on Studio
//   UPTIME_ADMIN_WALLETS  comma-separated operator wallets: may view every job
//                         and pause any job
//
// Both FAIL CLOSED: unset, empty or malformed entries allow nobody. Addresses
// are normalized to lowercase; anything that is not 0x + 40 hex is ignored.
// The Studio list is checked server-side at create/edit/resume AND by the
// scheduler before every run; the UI only mirrors it.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseWalletList(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const a = part.trim();
    if (ADDRESS.test(a)) out.add(a.toLowerCase());
  }
  return out;
}

export function studioAllowlist(): ReadonlySet<string> {
  return parseWalletList(process.env.STUDIO_ALLOWLIST);
}

export function adminWallets(): ReadonlySet<string> {
  return parseWalletList(process.env.UPTIME_ADMIN_WALLETS);
}

export function isStudioAllowed(wallet: string, list: ReadonlySet<string> = studioAllowlist()): boolean {
  return list.has(wallet.toLowerCase());
}

export function isAdmin(wallet: string | null | undefined, list: ReadonlySet<string> = adminWallets()): boolean {
  return !!wallet && list.has(wallet.toLowerCase());
}

// Per-wallet quota on Studio: the Foundation pays for every LLM call there.
export function studioMaxJobs(): number {
  const n = Number(process.env.STUDIO_MAX_JOBS_PER_WALLET);
  return Number.isInteger(n) && n > 0 ? n : 10;
}
