"use client";

// Sign-in state: wallet connect + SIWE (EIP-4361). A module-level store
// (useSyncExternalStore), not a React context, so the header's SignInButton
// and the jobs pages share one session without a provider in the root layout.
// The server verifies the signature and sets the session cookie; this only
// builds the message and asks the wallet to sign it. Under the dev mock,
// sign-in uses a fixed sample address and never asks a real wallet.

import { useSyncExternalStore } from "react";
import { createSiweMessage } from "viem/siwe";
import type { Address } from "viem";
import { JOBS_MOCK, jobsApi, type Me } from "@/lib/jobs/client";
import { bradburyEvm, onAccountsChanged, requestAccount, signMessage } from "./wallet";

const MOCK_WALLET = "0x5afe00000000000000000000000000000000beef" as Address;

export type SessionState = { me: Me | null; loading: boolean; busy: boolean; error: string | null };

let state: SessionState = { me: null, loading: true, busy: false, error: null };
const SERVER_STATE: SessionState = state;
const listeners = new Set<() => void>();
let started = false;
let unwatch: (() => void) | null = null;

function setState(p: Partial<SessionState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export async function refreshSession() {
  try {
    const me = await jobsApi.me();
    setState({ me, loading: false, error: null });
  } catch (e) {
    setState({ me: { ready: false, wallet: null, studioAllowed: false }, loading: false, error: e instanceof Error ? e.message : "Could not reach the server." });
  }
  // Switching accounts in the wallet ends the session for the old one.
  unwatch?.();
  unwatch = onAccountsChanged((accounts) => {
    const w = state.me?.wallet;
    if (w && accounts[0]?.toLowerCase() !== w.toLowerCase()) void signOut();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started) {
    started = true;
    void refreshSession();
  }
  return () => listeners.delete(l);
}

export async function signIn() {
  setState({ busy: true, error: null });
  try {
    const useMockWallet = JOBS_MOCK; // the mock never touches a real wallet
    const address = useMockWallet ? MOCK_WALLET : await requestAccount();
    const nonce = await jobsApi.nonce();
    const message = createSiweMessage({
      domain: window.location.host,
      address,
      statement: "Sign in to Uptime by GenLayer. This signature costs nothing and sends no transaction.",
      uri: window.location.origin,
      version: "1",
      chainId: bradburyEvm.id,
      nonce,
      issuedAt: new Date(),
    });
    const signature = useMockWallet ? ("0xmock" as `0x${string}`) : await signMessage(address, message);
    await jobsApi.verify(message, signature);
    await refreshSession();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: /rejected|denied/i.test(msg) ? "Signature request was rejected." : msg.split("\n")[0] });
  } finally {
    setState({ busy: false });
  }
}

export async function signOut() {
  setState({ busy: true });
  try {
    await jobsApi.logout();
  } catch {
    /* the cookie may already be gone */
  } finally {
    setState({ busy: false });
    await refreshSession();
  }
}

export function useSession() {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE
  );
  return { ...s, signIn, signOut, refresh: refreshSession };
}
