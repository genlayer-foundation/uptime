"use client";

import { Button, StatusDot } from "@/components/ui";
import { useSession } from "@/components/jobs/session";
import { shortHex } from "@/components/jobs/format";

// Wallet connect + SIWE sign-in, and the signed-in state. The session lives
// in components/jobs/session.ts so the jobs pages share it. The header
// renders <SignInButton /> and nothing else, so keep the export name.
export function SignInButton() {
  const { me, loading, busy, error, signIn, signOut } = useSession();
  if (loading) {
    return (
      <Button variant="secondary" size="sm" disabled>
        <StatusDot pulse /> Sign in
      </Button>
    );
  }
  if (me?.wallet) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 font-mono text-xs text-foreground" title={me.wallet}>
          <StatusDot tone="success" />
          {shortHex(me.wallet, 4)}
        </span>
        <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
          Sign out
        </Button>
      </div>
    );
  }
  const notReady = me?.ready === false;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={signIn}
      disabled={busy || notReady}
      title={notReady ? "Sign-in is not configured on this server yet" : (error ?? "Connect a wallet and sign a message (no transaction)")}
    >
      {error && !busy ? <StatusDot tone="danger" /> : null}
      {busy ? "Check your wallet…" : "Sign in"}
    </Button>
  );
}
