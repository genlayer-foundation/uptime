// The one place that decides which private key signs GenLayer txs for a
// network. Used by the job executor (lib/jobs/chain.ts) and the Heartbeat
// runner (lib/genlayer/client.ts), so both sign as the same scheduler wallet.
//
//   studio    RELAYER_KEY_STUDIO
//   bradbury  RELAYER_KEY_BRADBURY, else PRIVATE_KEY (deprecated legacy
//             wallet; a warning is logged once per process)
//
// Never logs or returns anything but the key itself to its caller.

export type SignerNetwork = "studio" | "bradbury";

type Env = Record<string, string | undefined>;

let warnedLegacy = false;

function clean(v: string | undefined): string | null {
  const k = v?.trim();
  return k ? k : null;
}

export function signingKey(n: SignerNetwork, env: Env = process.env): `0x${string}` | null {
  if (n === "studio") return clean(env.RELAYER_KEY_STUDIO) as `0x${string}` | null;
  const relayer = clean(env.RELAYER_KEY_BRADBURY);
  if (relayer) return relayer as `0x${string}`;
  const legacy = clean(env.PRIVATE_KEY);
  if (legacy && !warnedLegacy) {
    warnedLegacy = true;
    console.warn("[signer] RELAYER_KEY_BRADBURY unset; signing Bradbury with deprecated PRIVATE_KEY");
  }
  return legacy as `0x${string}` | null;
}

/** Test hook: re-arm the once-only deprecation warning. */
export function resetSignerWarning(): void {
  warnedLegacy = false;
}
