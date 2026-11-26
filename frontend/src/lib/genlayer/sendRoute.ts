// Server-only: send signed transactions to a different host than the GenLayer node RPC.
//
// genlayer-js 2.x sends every JSON-RPC call of a client, eth_sendRawTransaction included, to the
// chain's single `rpcUrls.default` URL through the global fetch, and has no option to split them.
// On Bradbury Phase 3 no public host serves both (checked 2026-11-25): the GenLayer node RPC
// (https://rpc.bradbury.genlayer.com) serves gen_* and the eth_* reads but answers
// eth_sendRawTransaction "method not found"; the chain RPC accepts sends but serves no gen_*.
//
// rerouteRawSends(from, to) wraps the global fetch once: a single (non-batch) JSON-RPC
// eth_sendRawTransaction POSTed to `from` goes to `to` instead. Every other request, and every
// other host, passes through untouched. Idempotent; a later call adds or replaces a route.

import type { Deployment } from "../chains";

type Fetch = typeof globalThis.fetch;

const MARK = "__uptimeSendRoute";
const routes = new Map<string, string>();

const norm = (u: string) => u.trim().replace(/\/+$/, "");

function urlOf(input: Parameters<Fetch>[0]): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null; // a Request object: genlayer-js never passes one
}

function isRawSend(body: unknown): boolean {
  if (typeof body !== "string" || !body.includes("eth_sendRawTransaction")) return false;
  try {
    const j = JSON.parse(body);
    return !Array.isArray(j) && j?.method === "eth_sendRawTransaction";
  } catch {
    return false;
  }
}

/** Where a request to `url` with `body` should go, or null to leave it alone. */
export function rawSendTarget(url: string, body: unknown): string | null {
  const to = routes.get(norm(url));
  return to && isRawSend(body) ? to : null;
}

export function rerouteRawSends(from: string, to: string): void {
  if (!from?.trim() || !to?.trim() || norm(from) === norm(to)) return;
  routes.set(norm(from), to.trim());
  const current = globalThis.fetch as Fetch & Record<string, unknown>;
  if (current[MARK]) return;
  const wrapped = ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = urlOf(input);
    const target = url ? rawSendTarget(url, init?.body) : null;
    return current(target ?? input, init);
  }) as Fetch & Record<string, unknown>;
  // Keep Next's markers (__nextPatched, _nextOriginalFetch) so it does not patch over us.
  for (const k of Object.keys(current)) wrapped[k] = current[k];
  wrapped[MARK] = true;
  globalThis.fetch = wrapped;
}

/** Send a deployment's signed transactions to its `sendRpc`, if it names one. */
export function routeDeploymentSends(d: Pick<Deployment, "genlayerRpc" | "sendRpc">): void {
  if (d.sendRpc) rerouteRawSends(d.genlayerRpc, d.sendRpc);
}

/** Tests only. */
export function _clearRoutesForTests(): void {
  routes.clear();
}
