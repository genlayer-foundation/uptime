// Who may spend what. One function, used by BOTH the API (create, update,
// resume) and the scheduler (before every run), so removing a wallet from the
// Studio allowlist takes effect on its very next run, not only on new jobs.

import { isStudioAllowed } from "./allowlist";
import type { JobRow } from "./internal";

export interface GateDeps {
  allowlist: ReadonlySet<string>;
  // Bradbury only: can this job's pool cover the next run? Injected so the
  // pool contract stays behind one seam (pool/pool.ts).
  funding: (j: JobRow) => Promise<FundingCheck>;
}

export interface FundingCheck {
  ok: boolean;
  reason?: string;
  // The owner paused the pool or the scheduler's allowance on-chain.
  paused?: boolean;
  // The pool is owned by another wallet (ids are first-come): never run.
  foreign?: boolean;
}

export type GateResult =
  | { ok: true }
  // fatal: the job cannot run until a human changes something.
  // state: what the job becomes ("paused" mirrors an on-chain pause).
  | { ok: false; fatal: boolean; reason: string; state?: "paused" | "errored" };

export function studioGate(wallet: string, allowlist: ReadonlySet<string>): GateResult {
  return isStudioAllowed(wallet, allowlist)
    ? { ok: true }
    : { ok: false, fatal: true, reason: "This wallet is not on the Studio allowlist", state: "errored" };
}

export async function runGate(j: JobRow, deps: GateDeps): Promise<GateResult> {
  if (j.system) return { ok: true };
  if (j.network === "studio") return studioGate(j.owner, deps.allowlist);
  const f = await deps.funding(j);
  if (f.ok) return { ok: true };
  const reason = f.reason ?? "Pool cannot cover the next run";
  if (f.foreign) return { ok: false, fatal: true, reason, state: "errored" };
  if (f.paused) return { ok: false, fatal: true, reason, state: "paused" };
  return { ok: false, fatal: false, reason };
}
