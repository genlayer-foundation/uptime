// The one place that decides which private key signs GenLayer txs for a
// network. Used by the job executor (lib/jobs/chain.ts) and the Heartbeat
// runner (lib/genlayer/client.ts), so both sign as the same scheduler wallet.
//
//   studio    RELAYER_KEY_STUDIO
//   bradbury  RELAYER_KEY_BRADBURY
//
// Never logs or returns anything but the key itself to its caller.

export type SignerNetwork = "studio" | "bradbury";

type Env = Record<string, string | undefined>;

function clean(v: string | undefined): string | null {
  const k = v?.trim();
  return k ? k : null;
}

export function signingKey(n: SignerNetwork, env: Env = process.env): `0x${string}` | null {
  const key = n === "studio" ? env.RELAYER_KEY_STUDIO : env.RELAYER_KEY_BRADBURY;
  return clean(key) as `0x${string}` | null;
}
